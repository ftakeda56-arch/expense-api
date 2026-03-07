"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
}

const EXAMPLES = [
  "LoginFormのユニットテストをJestで生成してください",
  "React Nativeの決済フロー用E2EテストをDetoxで作成して",
  "Userモデルのモックデータを10件生成してください",
  "このコードのカバレッジを分析してください",
];

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMessage: Message = { role: "user", content: text };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    const assistantMessage: Message = { role: "assistant", content: "", toolsUsed: [] };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const res = await fetch("/api/mobile-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "text") {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: updated[updated.length - 1].content + event.delta,
                };
                return updated;
              });
            }
            if (event.type === "tools_used") {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  toolsUsed: event.tools.map((t: { name: string }) => t.name),
                };
                return updated;
              });
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: `エラーが発生しました: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #222", background: "#111" }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
          📱 Mobile Test Agent
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#888" }}>
          React Native · Flutter · iOS · Android のテスト自動生成
        </p>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#555", marginTop: 40 }}>
            <p style={{ fontSize: 15, marginBottom: 24 }}>テストの生成・分析を開始しましょう</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => sendMessage(ex)}
                  style={{
                    padding: "8px 14px",
                    background: "#1a1a1a",
                    border: "1px solid #333",
                    borderRadius: 8,
                    color: "#aaa",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "12px 16px",
                borderRadius: 12,
                background: msg.role === "user" ? "#1d4ed8" : "#1a1a1a",
                border: msg.role === "assistant" ? "1px solid #2a2a2a" : "none",
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {msg.content}
              {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #333", display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {msg.toolsUsed.map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 11,
                        background: "#0f2a1a",
                        color: "#4ade80",
                        border: "1px solid #1a4a2a",
                        borderRadius: 4,
                        padding: "2px 6px",
                      }}
                    >
                      🔧 {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && messages[messages.length - 1]?.content === "" && (
          <div style={{ color: "#555", fontSize: 14 }}>考え中...</div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "16px 24px", borderTop: "1px solid #222", background: "#111", display: "flex", gap: 12 }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="テストを生成したいコードや機能を説明してください… (Shift+Enter で改行)"
          rows={3}
          style={{
            flex: 1,
            background: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: 8,
            color: "#f0f0f0",
            padding: "10px 14px",
            fontSize: 14,
            resize: "none",
            outline: "none",
          }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
          style={{
            padding: "0 20px",
            background: loading || !input.trim() ? "#333" : "#1d4ed8",
            color: loading || !input.trim() ? "#666" : "#fff",
            border: "none",
            borderRadius: 8,
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          送信
        </button>
      </div>
    </div>
  );
}
