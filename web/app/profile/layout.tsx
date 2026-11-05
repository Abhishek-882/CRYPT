import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Quant Profile & API Vault",
  description:
    "Manage encrypted API vault credentials, custom exchange endpoints, and DPDP compliance preferences.",
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
