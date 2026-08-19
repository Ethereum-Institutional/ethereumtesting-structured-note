import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Meridian Custody — Permissioned RWA Console",
  description: "ERC-3643 asset servicing and permissioned Uniswap v4 trading",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
