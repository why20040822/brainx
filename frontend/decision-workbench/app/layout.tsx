import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geist = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "B-tex · 职位决策工作台",
  description: "面向猎头顾问的职位优先级决策工作台前端原型",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={`${geist.variable} ${mono.variable}`}>
        {children}
        <Script
          defer
          strategy="afterInteractive"
          src="https://cdn.eazo.ai/branding/eazo-brand-banner.js"
          data-eazo-app-id="iV1ADpn7uxkl4kFC"
        />
      </body>
    </html>
  );
}
