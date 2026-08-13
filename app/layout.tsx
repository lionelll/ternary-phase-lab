import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "材科基 · 三元相图3D可视化实验室",
  description:
    "面向材料科学教学的三元相图 3D 交互可视化平台，支持等温切片、爆炸视图、相区高亮与成分点分析。",
  icons: {
    icon: "/brand-logo.png?v=3",
    shortcut: "/brand-logo.png?v=3",
    apple: "/brand-logo.png?v=3",
  },
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
