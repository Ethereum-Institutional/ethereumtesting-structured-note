import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Meridian Custody — Permissioned RWA Console",
  description: "ERC-3643 asset servicing and permissioned Uniswap v4 trading",
  icons: { icon: "/brand/OZ-Logo-FavIconColor.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
