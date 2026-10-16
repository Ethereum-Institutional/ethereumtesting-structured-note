import type { Metadata } from "next";
import "./globals.css";
import { TableLabels } from "./TableLabels";

// A step that sends a transaction waits for it to be mined: on Ethereum Sepolia that can take
// minutes for a large one, so every page may run for up to five (ADR 0103).
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "Structured Note Technical PoC",
  description: "Access is by registration and approval.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Literata:opsz,wght@7..72,300..600&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        {children}
        <TableLabels />
      </body>
    </html>
  );
}
