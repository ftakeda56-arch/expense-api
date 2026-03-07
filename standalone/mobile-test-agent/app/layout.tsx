import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mobile Test Agent",
  description: "AI-powered test generator for mobile applications",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0f0f0f", color: "#f0f0f0" }}>
        {children}
      </body>
    </html>
  );
}
