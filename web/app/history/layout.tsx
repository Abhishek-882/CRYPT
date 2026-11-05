import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Execution Audit Ledger & Analytics",
  description:
    "Institutional trade records, execution latency benchmarks, realized basis harvest returns, and immutable audit logs.",
};

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
