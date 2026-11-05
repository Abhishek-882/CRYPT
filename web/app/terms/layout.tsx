import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service & Quant Governance",
  description:
    "Institutional terms of service, Section 2 Data Protection Clause, and high-frequency trading liability disclosures.",
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
