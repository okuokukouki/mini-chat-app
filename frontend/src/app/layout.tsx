// アプリ全体のレイアウト。メタデータとグローバルスタイルを設定する。

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mini Chat App',
  description: 'Strands Agents + Amazon Bedrock チャットアプリ',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
