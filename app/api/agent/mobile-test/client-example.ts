/**
 * Example: how to call the mobile-app test agent from a client.
 *
 * Run with:  npx ts-node app/api/agent/mobile-test/client-example.ts
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

async function askMobileTestAgent(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = []
) {
  const res = await fetch(`${BASE_URL}/api/agent/mobile-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));

      switch (event.type) {
        case "text":
          process.stdout.write(event.delta);
          fullText += event.delta;
          break;
        case "tools_used":
          console.log("\n\n[Tools invoked]");
          for (const t of event.tools) {
            console.log(`  • ${t.name}`, JSON.stringify(t.input, null, 2));
          }
          break;
        case "done":
          console.log(
            `\n\n[Done] stop_reason=${event.stop_reason}`,
            `input_tokens=${event.usage?.input_tokens}`,
            `output_tokens=${event.usage?.output_tokens}`
          );
          break;
        case "error":
          console.error("\n[Error]", event.message);
          break;
      }
    }
  }

  return fullText;
}

// ── Demo ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log("=== Mobile App Test Agent Demo ===\n");

  await askMobileTestAgent(
    `以下のReact Nativeコンポーネントのユニットテストを生成してください。

\`\`\`typescript
// LoginForm.tsx
import React, { useState } from "react";
import { View, TextInput, TouchableOpacity, Text } from "react-native";

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
}

export function LoginForm({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email || !password) {
      setError("メールとパスワードを入力してください");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onLogin(email, password);
    } catch (e) {
      setError("ログインに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View>
      <TextInput testID="email-input" value={email} onChangeText={setEmail} />
      <TextInput testID="password-input" value={password} onChangeText={setPassword} secureTextEntry />
      {error && <Text testID="error-message">{error}</Text>}
      <TouchableOpacity testID="login-button" onPress={handleSubmit} disabled={loading}>
        <Text>{loading ? "ログイン中..." : "ログイン"}</Text>
      </TouchableOpacity>
    </View>
  );
}
\`\`\`
`
  );
})();
