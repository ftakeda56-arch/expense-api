# Mobile Test Agent — Cloudflare Workers 移植仕様書

バージョン: 1.0
作成日: 2026-03-07
対象環境: Cloudflare Workers (Paid Plan)

---

## 1. 概要

現在 Next.js (Node.js ランタイム) で実装されているモバイルアプリ向けテスト専用 AI エージェントを、Cloudflare Workers 上で動作するよう再設計する。

### 目的

- エッジコンピューティングによる低レイテンシ配信
- Cloudflare Workers の SSE ストリーミングを活用したリアルタイム応答
- Durable Objects によるユーザーセッション単位の会話履歴永続化
- グローバル分散デプロイによる可用性向上

### スコープ外

- フロントエンド UI の変更（Chat.tsx はそのまま利用可能）
- Anthropic モデルの変更
- テストツールの追加・削除

---

## 2. システム構成図

```
クライアント (ブラウザ / モバイルアプリ)
        │  POST /api/mobile-test  (SSE)
        ▼
┌───────────────────────────────────────┐
│         Cloudflare Workers            │
│  src/index.ts                         │
│  ・リクエスト検証                     │
│  ・Durable Object スタブ取得          │
│  ・SSE ReadableStream 生成            │
│  ・@anthropic-ai/sdk 呼び出し         │
└───────────────┬───────────────────────┘
                │ stub.fetch()
                ▼
┌───────────────────────────────────────┐
│    Durable Object: ConversationStore  │
│  (ユーザーセッションごとに 1 インスタンス)  │
│  ・SQLite で会話履歴を永続化          │
│  ・セッション有効期限管理 (alarm)     │
└───────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│  Anthropic API (直接接続)             │
│  claude-opus-4-6 + adaptive thinking  │
│  ※ AI Gateway は使用しない (後述)    │
└───────────────────────────────────────┘
```

---

## 3. 使用する Cloudflare プロダクト

| プロダクト | 用途 | プラン要件 |
|---|---|---|
| **Workers** | メイン API ハンドラー、SSE ストリーミング | Free / Paid |
| **Durable Objects** | 会話履歴の永続化（強整合性） | **Paid のみ** |
| **Workers KV** | レスポンスキャッシュ（任意） | Free / Paid |
| **Wrangler CLI** | ローカル開発・デプロイ | — |

### AI Gateway を使用しない理由

Cloudflare AI Gateway には **既知のバグ** がある（2026年3月時点未解決）。

> Anthropic API のストリーミングレスポンスを AI Gateway 経由でプロキシすると、**マルチバイト UTF-8 文字（日本語・絵文字等）が破損する。**

本エージェントは日本語での応答をサポートするため、Anthropic API へ **直接接続** する。

---

## 4. 現行実装との差分（移植ポイント）

### 4-1. ランタイムの違い

| 項目 | Next.js (現行) | Cloudflare Workers (移植後) |
|---|---|---|
| ランタイム | Node.js | V8 Isolate (Workers Runtime) |
| `runtime` 設定 | `"nodejs"` | 不要（Workers はデフォルト） |
| `dynamic` 設定 | `"force-dynamic"` | 不要 |
| `process` オブジェクト | 利用可 | **利用不可** |
| Node.js 組み込みモジュール | 利用可 | **利用不可**（`node:` プレフィックス付き一部を除く） |
| ファイルシステムアクセス | 可 | **不可** |

### 4-2. @anthropic-ai/sdk の互換性

`@anthropic-ai/sdk` は Cloudflare Workers ランタイムを **公式サポート** している。
現行コードの SDK 呼び出しは原則そのまま動作する。

```toml
# wrangler.toml に追加
compatibility_flags = ["nodejs_compat"]
```

`nodejs_compat` フラグにより、SDK 内部で使用される一部の Node.js 互換 API が有効になる。

### 4-3. betaZodTool の扱い

`betaZodTool` および Zod はバンドル時に問題なく動作する。
ただし Wrangler はデフォルトで esbuild を使用するため、ビルド設定の調整が必要。

### 4-4. 環境変数の取得方法

```typescript
// Next.js (現行)
const client = new Anthropic(); // process.env.ANTHROPIC_API_KEY を自動参照

// Cloudflare Workers (移植後)
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
};
```

### 4-5. SSE ストリーミングの実装

Workers は `ReadableStream` をネイティブサポートしており、現行の実装パターンはそのまま使える。
`TransformStream` を使った実装に切り替えると、より Workers らしい書き方になる。

---

## 5. API 設計

### エンドポイント

```
POST /api/mobile-test
Content-Type: application/json
```

### リクエストボディ

```typescript
interface RequestBody {
  message: string;               // 必須: ユーザーメッセージ
  session_id?: string;           // 任意: 既存セッションID（省略時は新規生成）
}
```

> **Note:** 現行実装の `history` フィールドは廃止する。
> 会話履歴は Durable Objects に保存されるため、クライアントからの送信が不要になる。

### レスポンス (SSE ストリーム)

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

```
data: {"type":"session","session_id":"<uuid>"}

data: {"type":"text","delta":"## LoginForm テスト\n\n"}

data: {"type":"tools_used","tools":[{"name":"generate_unit_tests","input":{...}}]}

data: {"type":"done","stop_reason":"end_turn","usage":{"input_tokens":1234,"output_tokens":567}}
```

| イベント | 説明 |
|---|---|
| `session` | セッションIDを返す（最初のみ） |
| `text` | テキストデルタ（ストリーミング） |
| `tools_used` | 使用したツール一覧 |
| `done` | 完了（使用トークン数含む） |
| `error` | エラー詳細 |

---

## 6. Durable Objects 設計

### ConversationStore

ユーザーセッションごとに 1 インスタンスを作成する。
インスタンスの識別子は `session_id`（UUID v4）を使用する。

#### 保存データ構造

```typescript
// Durable Object 内部の SQLite テーブル
CREATE TABLE IF NOT EXISTS messages (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  role     TEXT NOT NULL,   -- 'user' | 'assistant'
  content  TEXT NOT NULL,
  created_at INTEGER NOT NULL  -- Unix timestamp (ms)
);
```

#### メソッド

```typescript
class ConversationStore {
  // 会話履歴を取得（最大 N 件）
  async getHistory(limit: number): Promise<Anthropic.MessageParam[]>

  // メッセージを追記
  async appendMessages(messages: Array<{ role: string; content: string }>): Promise<void>

  // セッションを削除（有効期限切れ）
  async destroy(): Promise<void>
}
```

#### セッション有効期限

Durable Objects の **alarm** を使い、最終アクセスから **24 時間** でセッションを自動削除する。

```typescript
async alarm() {
  // alarm 発火時に全データを削除してインスタンスを終了
  await this.ctx.storage.deleteAll();
}
```

---

## 7. ディレクトリ構成（移植後）

```
mobile-test-agent-worker/
├── src/
│   ├── index.ts                  # Worker エントリーポイント（fetch ハンドラー）
│   ├── agent.ts                  # Claude 呼び出し・ツール定義
│   ├── durable-objects/
│   │   └── ConversationStore.ts  # 会話履歴 Durable Object
│   └── types.ts                  # 共通型定義 (Env など)
├── public/                       # 静的アセット（Chat UI）
│   └── index.html                # チャット UI（React → 純粋 HTML/JS に変換 or Workers Static Assets）
├── wrangler.jsonc                 # Wrangler 設定
├── package.json
├── tsconfig.json
└── .dev.vars                     # ローカル開発用シークレット（git 管理外）
```

---

## 8. 設定ファイル仕様

### wrangler.jsonc

```jsonc
{
  "name": "mobile-test-agent",
  "main": "src/index.ts",
  "compatibility_date": "2026-03-07",
  "compatibility_flags": ["nodejs_compat"],

  // Durable Objects の登録
  "durable_objects": {
    "bindings": [
      {
        "name": "CONVERSATION_STORE",
        "class_name": "ConversationStore"
      }
    ]
  },

  // Durable Objects のマイグレーション（初回デプロイ時）
  "migrations": [
    {
      "tag": "v1",
      "new_classes": ["ConversationStore"]
    }
  ],

  // KV（レスポンスキャッシュ、任意）
  "kv_namespaces": [
    {
      "binding": "RESPONSE_CACHE",
      "id": "<YOUR_KV_NAMESPACE_ID>"
    }
  ],

  // ローカル開発用設定
  "dev": {
    "port": 8787
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "WebWorker"],
    "strict": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts"]
}
```

### package.json（最小構成）

```json
{
  "name": "mobile-test-agent-worker",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev":    "wrangler dev",
    "deploy": "wrangler deploy",
    "types":  "wrangler types"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.78.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.3.0",
    "wrangler": "^3.0.0"
  }
}
```

---

## 9. 環境変数・シークレット

| 変数名 | 種別 | 値 | 設定方法 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **Secret** | Anthropic API キー | `wrangler secret put ANTHROPIC_API_KEY` |
| `ALLOWED_ORIGINS` | Env Var | CORS 許可オリジン（カンマ区切り） | `wrangler.jsonc` の `vars` |

### ローカル開発（.dev.vars）

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
ALLOWED_ORIGINS=http://localhost:8787
```

### 型定義（src/types.ts）

```typescript
export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGINS: string;
  CONVERSATION_STORE: DurableObjectNamespace;
  RESPONSE_CACHE: KVNamespace;
}
```

---

## 10. データフロー

```
1. クライアント → POST /api/mobile-test
   { message: "...", session_id?: "..." }

2. Worker (src/index.ts)
   ├─ session_id がなければ UUID v4 を生成
   ├─ CONVERSATION_STORE.get(session_id) で DO スタブ取得
   └─ SSE ReadableStream を開始

3. DO (ConversationStore)
   ├─ SQLite から過去の会話履歴を取得
   └─ alarm を 24h 後にリセット

4. Worker → Anthropic API
   ├─ 過去履歴 + 新規メッセージを送信
   ├─ streaming tool runner で応答をストリーミング
   └─ ツール呼び出しを自動実行

5. Worker → クライアント (SSE)
   ├─ text デルタを逐次送信
   ├─ tools_used を送信
   └─ done イベントを送信

6. Worker → DO (ConversationStore)
   └─ ユーザーメッセージ + アシスタント応答を SQLite に保存
```

---

## 11. Workers リソース制限と本エージェントへの影響

| 制限項目 | 値 | 本エージェントへの影響 |
|---|---|---|
| CPU 時間 / リクエスト | 最大 5 分（Paid） | ツール呼び出しのループは ~5 秒以内に収まるため問題なし |
| メモリ | 128 MB | 会話履歴の全件インメモリ展開は避ける（DO から必要な件数だけ取得） |
| リクエスト継続時間 | 制限なし（クライアント接続中） | SSE ストリーミングは長時間接続可 |
| サブリクエスト数 | 1,000 / リクエスト | ツール呼び出し数が多い場合は注意 |
| Worker 起動時間 | 1 秒以内 | グローバルスコープの初期化は最小限に |

---

## 12. コスト見積もり（参考）

**前提:** 月間 10,000 リクエスト、平均 1 リクエストあたり 500ms CPU 時間

| 項目 | 計算 | 月額 |
|---|---|---|
| Workers Paid プラン | 基本料金 | $5.00 |
| Workers リクエスト | 10,000 / month（無料枠内） | $0.00 |
| CPU 時間 | 10,000 × 500ms = 5,000,000 CPU-ms（無料枠内） | $0.00 |
| Durable Objects | ~1,000 インスタンス × $0.0000002/req | 〜$0.01 |
| Anthropic API | claude-opus-4-6 $5/M input + $25/M output | 別途 |
| **合計（Cloudflare 分）** | | **〜$5.01/月** |

---

## 13. デプロイ手順

```bash
# 1. 依存関係インストール
npm install

# 2. Durable Objects KV ネームスペース作成（初回のみ）
wrangler kv namespace create RESPONSE_CACHE

# 3. wrangler.jsonc の KV ID を更新（手順 2 の出力を反映）

# 4. シークレット登録
wrangler secret put ANTHROPIC_API_KEY
# → プロンプトに API キーを入力

# 5. ローカル開発
wrangler dev

# 6. 本番デプロイ
wrangler deploy
```

---

## 14. 注意事項・既知の問題

### AI Gateway の UTF-8 バグ（重要）

> **Cloudflare AI Gateway 経由での Anthropic ストリーミングは、日本語などのマルチバイト文字を破損させるバグがある（2026年3月時点未解決）。**
> 本仕様では AI Gateway を使用せず、Anthropic API に直接接続する設計とする。

### Durable Objects は Paid プラン必須

無料プランでは Durable Objects が利用できない。
会話履歴が不要なステートレス用途であれば無料プランでも動作するが、マルチターン対話の品質が大きく低下する。

### betaZodTool の Workers 互換性

`@anthropic-ai/sdk/helpers/beta/zod` は Workers ランタイムで動作するが、
Wrangler のバンドルで問題が発生する場合は `external_modules` の設定が必要になることがある。

### KV の結果整合性

KV はグローバル伝播に最大 60 秒かかる場合がある。
会話履歴の保存には使用せず、Durable Objects を使用すること。

---

## 15. 移植作業の優先順位

| Priority | タスク | 難易度 |
|---|---|---|
| P0 | `src/index.ts` — Workers fetch ハンドラー作成 | 低 |
| P0 | `src/agent.ts` — ツール定義を Next.js から移植 | 低 |
| P0 | `wrangler.jsonc` 設定 | 低 |
| P1 | `ConversationStore` Durable Object 実装 | 中 |
| P1 | セッション管理（UUID 生成・DO スタブ取得） | 低 |
| P1 | SSE ストリーミング実装（ReadableStream） | 低 |
| P2 | Chat UI を Workers Static Assets に移植 | 中 |
| P2 | CORS 設定 | 低 |
| P3 | KV レスポンスキャッシュ（任意） | 低 |
| P3 | alarm によるセッション自動削除 | 低 |
