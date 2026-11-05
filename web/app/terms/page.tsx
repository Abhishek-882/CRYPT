"use client";

import React from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import {
  ShieldCheck,
  Scale,
  AlertTriangle,
  Lock,
  FileText,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  HelpCircle,
} from "lucide-react";
import { GRIEVANCE_OFFICER_INFO, DPDP_NOTICE_VERSION } from "@/lib/complianceConstants";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-mono selection:bg-accent-amber/20 selection:text-accent-amber">
      <Navbar />

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 md:p-10 pb-24 sm:pb-10 space-y-8">
        {/* Compliance Header */}
        <div className="space-y-3 border-b border-border pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-accent-amber text-[11px] font-bold flex items-center space-x-1.5">
              <Scale className="w-3.5 h-3.5" />
              <span>INSTITUTIONAL TERMS OF SERVICE & DATA PROTECTION CLAUSE</span>
            </span>
            <span className="px-2.5 py-1 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[11px] font-bold">
              [LEGAL REVIEW REQUIRED]
            </span>
            <span className="text-[11px] text-zinc-500 font-mono">
              Version: 2.4-DPDP • Effective Date: October 2026
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight uppercase text-zinc-100">
            Terms of Service & Platform Governance
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-3xl">
            These Terms of Service govern your access to and use of the <strong>SafeCoiner</strong> developed by
            Safecoiner. By registering an account or configuring exchange keys, you enter into a legally binding agreement
            incorporating the statutory provisions of the <strong>Digital Personal Data Protection Act, 2023 (India)</strong>.
          </p>
        </div>

        {/* Legal Disclaimer Box */}
        <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 text-[11px] leading-relaxed text-amber-200/90 space-y-1.5">
          <div className="flex items-center space-x-2 font-bold text-amber-400 text-xs uppercase tracking-wide">
            <AlertTriangle className="w-4 h-4 text-accent-amber shrink-0" />
            <span>Notice for Institutional Legal Counsel</span>
          </div>
          <p>
            This draft document contains mandatory statutory data-protection clauses under Section 6, 8, 15, and 16
            of the Digital Personal Data Protection Act, 2023. These terms must undergo qualified formal legal review prior to production signing.
          </p>
        </div>

        {/* Section 1: Algorithmic Execution Scope */}
        <section className="space-y-3 text-xs leading-relaxed text-zinc-400">
          <h2 className="text-base font-bold text-zinc-100 flex items-center space-x-2">
            <span>1. Scope of Platform & Algorithmic Tooling</span>
          </h2>
          <p>
            The SafeCoiner provides automated mathematical telemetry and algorithmic order routing between
            Binance USD-M Futures and Bitget Unified Trading Account (UTA V3) Perpetuals. The platform operates
            exclusively as a quantitative tool and non-custodial software executor. It does not provide portfolio management,
            brokerage, investment advice, custody of funds, or financial advisory services.
          </p>
        </section>

        {/* Section 2: Statutory Data Protection Clause (DPDP Act 2023) */}
        <section className="p-6 rounded-2xl bg-[#121215] border border-accent-amber/40 space-y-5 text-xs leading-relaxed">
          <div className="flex items-center space-x-2.5 pb-3 border-b border-zinc-800">
            <ShieldCheck className="w-5 h-5 text-accent-amber shrink-0" />
            <div>
              <h2 className="text-base font-bold text-zinc-100 uppercase tracking-wide">
                2. Data Protection Clause (DPDP Act 2023, India)
              </h2>
              <span className="text-[11px] text-zinc-500 font-mono">
                Mandatory Statutory Terms under Chapter II & Chapter III, DPDP Act 2023
              </span>
            </div>
          </div>

          <div className="space-y-3 text-zinc-300">
            <h3 className="font-bold text-accent-amber text-xs uppercase tracking-wider">
              2.1 Grounds for Processing & Affirmative Consent
            </h3>
            <p>
              In accordance with Section 4 and Section 6 of the DPDP Act 2023, the Data Fiduciary processes your digital
              personal data (including account identifiers, cryptographically salted passhashes, and exchange API credentials)
              solely based on your <strong>free, specific, informed, unconditional, and unambiguous affirmative opt-in consent</strong>.
            </p>
          </div>

          <div className="space-y-3 text-zinc-300">
            <h3 className="font-bold text-accent-amber text-xs uppercase tracking-wider">
              2.2 Mechanism and Consequences of Consent Withdrawal
            </h3>
            <p>
              Under Section 6(4) of the DPDP Act 2023, you have the unfettered right to withdraw your consent at any time:
            </p>
            <ul className="list-disc list-inside text-zinc-400 space-y-1 text-[11px] pl-2">
              <li>
                <strong>Withdrawal Channel:</strong> You may revoke consent instantaneously via our self-service
                <Link href="/data-rights" className="text-accent-amber underline hover:text-amber-300 ml-1">
                  Data Rights Portal (/data-rights)
                </Link> or by written communication to the Grievance Redressal Officer.
              </li>
              <li>
                <strong>Technical Consequence:</strong> If you withdraw consent for exchange API processing (PURPOSE_EXCHANGE_DISPATCH),
                the platform will immediately disarm live execution, cease signing new orders, and purge active API keys from the server vault.
              </li>
              <li>
                <strong>No Retroactive Invalidation:</strong> Consent withdrawal does not affect the lawfulness of processing
                undertaken prior to such withdrawal.
              </li>
            </ul>
          </div>

          <div className="space-y-3 text-zinc-300">
            <h3 className="font-bold text-accent-amber text-xs uppercase tracking-wider">
              2.3 Cross-Border Data Transfer Undertaking (Section 16)
            </h3>
            <p>
              By entering exchange credentials and activating delta-neutral trading, you expressly authorize and consent to
              the cross-border transmission of cryptographically signed order payloads to external matching engine clusters
              operated by Binance and Bitget situated outside the territory of India, in strict adherence to Section 16 of the DPDP Act 2023.
            </p>
          </div>

          <div className="space-y-3 text-zinc-300">
            <h3 className="font-bold text-accent-amber text-xs uppercase tracking-wider">
              2.4 Statutory Duties of the Data Principal (Section 15)
            </h3>
            <p>
              In compliance with Section 15 of the DPDP Act 2023, the Data Principal agrees to:
            </p>
            <ul className="list-disc list-inside text-zinc-400 space-y-1 text-[11px] pl-2">
              <li>Not impersonate any other individual while creating accounts or providing credentials.</li>
              <li>Not suppress any material information while furnishing personal data for statutory compliance.</li>
              <li>Not file false or frivolous grievances before the Grievance Redressal Officer or the Data Protection Board of India.</li>
              <li>Furnish only authentic, verifiably accurate information when exercising the right to correction or erasure.</li>
            </ul>
          </div>
        </section>

        {/* Section 3: Risk Allocation & Execution Disclaimers */}
        <section className="space-y-3 text-xs leading-relaxed text-zinc-400">
          <h2 className="text-base font-bold text-zinc-100 flex items-center space-x-2">
            <span>3. Market Risks & Limitation of Liability</span>
          </h2>
          <p>
            Delta-neutral basis capture relies on concurrent execution across two separate exchanges. Inherent execution risks
            include slippage during volatile bursts, exchange-side downtime or API maintenance, WebSocket transport drops,
            asymmetric liquidation risk, and adverse funding rate flips. The platform authors and Safecoiner shall not be liable for
            trading losses incurred during autonomous or manual execution.
          </p>
        </section>

        {/* Section 4: Grievance Redressal Mechanism */}
        <section className="space-y-3 text-xs leading-relaxed text-zinc-400">
          <h2 className="text-base font-bold text-zinc-100 flex items-center space-x-2">
            <span>4. Grievance Redressal & Governing Law</span>
          </h2>
          <p>
            Any dispute or grievance regarding data protection shall first be submitted to our designated Grievance Redressal
            Officer at <a href={`mailto:${GRIEVANCE_OFFICER_INFO.email}`} className="text-accent-cyan underline">{GRIEVANCE_OFFICER_INFO.email}</a>.
            The Officer shall resolve complaints within {GRIEVANCE_OFFICER_INFO.responseWindowDays} calendar days.
            These Terms are governed by the laws of India, and subject to the jurisdiction of courts in Mumbai, Maharashtra.
          </p>
        </section>

        {/* Navigation Actions */}
        <div className="pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between text-xs gap-3">
          <Link href="/" className="text-zinc-400 hover:text-accent-amber transition-colors">
            ← Back to Platform
          </Link>
          <div className="flex items-center space-x-4">
            <Link href="/privacy" className="text-zinc-400 hover:text-accent-amber transition-colors">
              Privacy Notice
            </Link>
            <Link href="/data-rights" className="text-accent-amber font-semibold hover:underline">
              Exercise Data Rights →
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
