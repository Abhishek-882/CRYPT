import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Access Authentication",
  description:
    "Institutional quant login and registration portal with affirmative opt-in consent verification.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
