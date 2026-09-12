import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'softie · 软乎乎。',
  description:
    '一只可以揉捏、提起、回弹的软乎乎史莱姆。用 WebGPU 留一点空间，放轻松。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
