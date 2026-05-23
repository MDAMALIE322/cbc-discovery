import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CBC GenAI Discovery Assistant",
  description: "Editorial-grade GenAI discovery, governed under CEAIRF v1.0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
