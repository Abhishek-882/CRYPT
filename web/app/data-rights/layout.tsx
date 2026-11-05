import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data Principal Rights Portal",
  description:
    "Self-service data rights request portal to access, export, correct, or erase personal data under DPDP Act 2023.",
};

export default function DataRightsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
