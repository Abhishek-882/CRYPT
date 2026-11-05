import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Arbitrage Terminal",
  description:
    "Real-time dual-venue 453-coin funding rate scanner, directional spread calculations, and simultaneous dual-order execution cockpit.",
};

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
