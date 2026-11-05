import type { Metadata, Viewport } from "next";
import "./globals.css";
import AOSProvider from "@/components/AOSProvider";
import ConsentBanner from "@/components/ConsentBanner";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://shown-enhanced-organizational-potentially.trycloudflare.com"),
  title: {
    default: "SafeCoiner | Institutional Delta-Neutral Arbitrage Terminal",
    template: "%s | SafeCoiner",
  },
  description:
    "Institutional delta-neutral basis trading terminal capturing cross-exchange funding rate disparities across 453+ mutual contracts on Binance USD-M and Bitget UTA V3 Perpetuals.",
  keywords: [
    "funding rate arbitrage",
    "delta-neutral trading",
    "basis trading",
    "crypto futures",
    "binance usd-m",
    "bitget uta v3",
    "quantitative hedge",
  ],
  authors: [{ name: "Safecoiner Technologies" }],
  creator: "Safecoiner",
  publisher: "Safecoiner Technologies",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "SafeCoiner",
    title: "SafeCoiner | Institutional Delta-Neutral Arbitrage",
    description:
      "Dual-venue high-frequency funding rate basis trading terminal across Binance USD-M and Bitget UTA V3 Perpetuals.",
    images: [
      {
        url: "/og-preview.svg",
        width: 1200,
        height: 630,
        alt: "SafeCoiner Institutional Trading Preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "SafeCoiner | Institutional Delta-Neutral Arbitrage",
    description:
      "Dual-venue high-frequency funding rate basis trading terminal across Binance USD-M and Bitget UTA V3 Perpetuals.",
    images: ["/og-preview.svg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-zinc-100 min-h-screen antialiased selection:bg-accent-amber/20 selection:text-accent-amber">
        <AOSProvider>{children}</AOSProvider>
        <ConsentBanner />
      </body>
    </html>
  );
}
