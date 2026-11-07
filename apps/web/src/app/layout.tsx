import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Inter, Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { SiteHeader } from "@/components/SiteHeader";

/* Manrope carries the editorial headings, Inter the reading text, Geist Mono every
   hash, account id and amount, so numbers always align in a column. */
const display = Manrope({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-display", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "TRUSTORA — Trust, made programmable",
  description:
    "Programmable trust infrastructure for human and AI-driven work: USDC milestone escrow on Arc, advisory AI evaluation, and independently verifiable evidence.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased text-ink">
        <Providers>
          <SiteHeader />
          <main id="main" className="mx-auto w-full max-w-content px-5 pb-20 pt-8 sm:px-8 sm:pt-12">
            {children}
          </main>
          <footer className="mx-auto w-full max-w-content px-5 pb-14 sm:px-8">
            <div className="rule-t pt-6">
              <div className="flex flex-col gap-3 text-xs text-ink-3 sm:flex-row sm:items-baseline sm:justify-between">
                <p className="font-medium text-ink-2">TRUSTORA</p>
                <p className="mono">Arc Testnet · chain 5042002</p>
                <p className="max-w-sm">
                  AI evaluation is advisory only and can never release escrow funds.
                </p>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
