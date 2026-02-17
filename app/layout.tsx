export const metadata = {
  title: '経費申請アプリ API',
  description: 'Expense Request Application API Server',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
