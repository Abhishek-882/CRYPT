import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Statutory Privacy Notice",
  description:
    "Digital Personal Data Protection Act (DPDP Act 2023, India) statutory notice, processing purposes, and grievance coordinates.",
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
