import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Autonomous Multi-Bot Engine",
  description:
    "24/7 autonomous background server hedge bot with custom .set presets, dynamic spread sniping, and automated settlement harvesting.",
};

export default function BotLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
