import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "./ui/shell";

export const metadata: Metadata = {
  title: "研知台 · Agent 知识探索",
  description: "看懂 Agent 如何发现工具、规划行动、完成任务。知识、学习路径，以及可逐步查看的调用过程。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
