"use client";

import React from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import {
  ShieldCheck,
  Lock,
  FileText,
  AlertTriangle,
  Mail,
  UserCheck,
  Trash2,
  RefreshCw,
  ExternalLink,
  Scale,
  Clock,
  Server,
  Database,
  ArrowRight,
} from "lucide-react";
import { GRIEVANCE_OFFICER_INFO, DPDP_NOTICE_VERSION } from "@/lib/complianceConstants";

export default function PrivacyNoticePage() {
  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-mono selection:bg-accent-amber/20 selection:text-accent-amber">
      <Navbar />

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 md:p-10 pb-24 sm:pb-10 space-y-8">
        {/* Compliance Header Banner */}
        <div className="space-y-3 border-b border-border pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-accent-amber text-[11px] font-bold flex items-center space-x-1.5">
              <Scale className="w-3.5 h-3.5" />
              <span>STATUTORY COMPLIANCE • SECTION 5 DPDP ACT 2023 (INDIA)</span>
            </span>
            <span className="px-2.5 py-1 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[11px] font-bold">
              [LEGAL REVIEW REQUIRED]
            </span>
            <span className="text-[11px] text-zinc-500 font-mono">
              Notice Version: {DPDP_NOTICE_VERSION} • Effective Date: October 2026
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight uppercase text-zinc-100">
            Privacy Notice & Data Protection Charter
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-3xl">
            This Statutory Notice is provided by <strong>Safecoiner</strong> (&ldquo;Data Fiduciary&rdquo;) in compliance with
            Section 5 of the Digital Personal Data Protection Act, 2023 (&ldquo;DPDP Act&rdquo;, Act No. 22 of 2023, India).
            It informs you (&ldquo;Data Principal&rdquo;) of the specific categories of personal data collected, processing
            purposes, retention policies, third-party disclosures, your statutory rights, and our Grievance Redressal mechanism.
          </p>
        </div>

        {/* Legal Disclaimer Box */}
        <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 text-[11px] leading-relaxed text-amber-200/90 space-y-1.5">
          <div className="flex items-center space-x-2 font-bold text-amber-400 text-xs uppercase tracking-wide">
            <AlertTriangle className="w-4 h-4 text-accent-amber shrink-0" />
            <span>Statutory Legal Review Disclaimer</span>
          </div>
          <p>
            This draft document has been structured to meet the baseline obligations of Section 5 (Notice), Section 6 (Consent),
            Section 8 (General Obligations of Data Fiduciary), and Sections 11–14 (Rights of Data Principal) of the DPDP Act 2023.
            Final deployment copy must be formally reviewed and approved by qualified legal counsel prior to institutional live production.
          </p>
        </div>

        {/* Table of Contents Quick Nav */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <a href="#data-collected" className="p-2.5 rounded-lg bg-surface border border-border hover:border-accent-amber/50 transition-colors">
            1. Personal Data Collected
          </a>
          <a href="#purposes" className="p-2.5 rounded-lg bg-surface border border-border hover:border-accent-amber/50 transition-colors">
            2. Purpose of Processing
          </a>
          <a href="#retention" className="p-2.5 rounded-lg bg-surface border border-border hover:border-accent-amber/50 transition-colors">
            3. Data Retention & Deletion
          </a>
          <a href="#third-parties" className="p-2.5 rounded-lg bg-surface border border-border hover:border-accent-amber/50 transition-colors">
            4. Third Parties & Transfers
          </a>
          <a href="#principal-rights" className="p-2.5 rounded-lg bg-surface border border-border hover:border-accent-amber/50 transition-colors">
            5. Your Statutory Rights
          </a>
          <a href="#grievance-contact" className="p-2.5 rounded-lg bg-surface border border-border hover:border-accent-amber/50 transition-colors">
            6. Grievance Officer & Redressal
          </a>
        </div>

        {/* Section 1: Data Collected */}
        <section id="data-collected" className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center space-x-2 text-zinc-100 font-bold text-base sm:text-lg">
            <Database className="w-4 h-4 text-accent-cyan" />
            <h2>1. Categories of Personal Data Collected (Section 5(1))</h2>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            The SafeCoiner processes digital personal data strictly on a need-to-know basis to furnish institutional delta-neutral arbitrage telemetry:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
              <span className="font-bold text-zinc-200 text-xs flex items-center space-x-1.5">
                <UserCheck className="w-3.5 h-3.5 text-accent-amber" />
                <span>Account Identity & Credentials</span>
              </span>
              <ul className="list-disc list-inside text-zinc-400 space-y-1 text-[11px]">
                <li>Trader username / identifier.</li>
                <li>Email address (used as unique login credential and communication handle).</li>
                <li>Cryptographically salted and hashed passwords (PBKDF2/SHA-256). Plaintext passwords are never stored.</li>
                <li>Session tokens & role identifiers (&ldquo;admin&rdquo; vs &ldquo;user&rdquo;).</li>
              </ul>
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
              <span className="font-bold text-zinc-200 text-xs flex items-center space-x-1.5">
                <Lock className="w-3.5 h-3.5 text-accent-emerald" />
                <span>Exchange API Credentials (At-Rest Encrypted)</span>
              </span>
              <ul className="list-disc list-inside text-zinc-400 space-y-1 text-[11px]">
                <li>Binance Futures API Key and Secret.</li>
                <li>Bitget UTA API Key, Secret, and Passphrase.</li>
                <li>Designated API endpoints and demo/mainnet environment indicators.</li>
                <li>
                  <strong className="text-zinc-300">Security Safeguard:</strong> All API secrets are encrypted at rest with AES-256-GCM.
                </li>
              </ul>
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
              <span className="font-bold text-zinc-200 text-xs flex items-center space-x-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-accent-cyan" />
                <span>Trading Telemetry & Execution Records</span>
              </span>
              <ul className="list-disc list-inside text-zinc-400 space-y-1 text-[11px]">
                <li>Executed pair orders, trade sizes, order IDs, and fill timestamps.</li>
                <li>Real-time position allocations, entry prices, and mark prices.</li>
                <li>Simulated virtual wallet balance and paper trade histories.</li>
                <li>Automated bot parameter profiles (.set preset files).</li>
              </ul>
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
              <span className="font-bold text-zinc-200 text-xs flex items-center space-x-1.5">
                <Server className="w-3.5 h-3.5 text-purple-400" />
                <span>Technical & Network Metadata</span>
              </span>
              <ul className="list-disc list-inside text-zinc-400 space-y-1 text-[11px]">
                <li>Client IP address and User-Agent headers (logged for rate-limiting and intrusion audit).</li>
                <li>Request timestamps and API latency metrics.</li>
                <li>Audit trail logs of automated bot actions and error diagnostics.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Section 2: Purpose of Processing */}
        <section id="purposes" className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center space-x-2 text-zinc-100 font-bold text-base sm:text-lg">
            <FileText className="w-4 h-4 text-accent-amber" />
            <h2>2. Specified Purposes of Processing (Section 5(1)(a))</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border border-border rounded-xl overflow-hidden">
              <thead className="bg-zinc-900 text-zinc-300 font-bold border-b border-border">
                <tr>
                  <th className="p-3">Purpose ID</th>
                  <th className="p-3">Purpose Description</th>
                  <th className="p-3">Data Used</th>
                  <th className="p-3">Processing Basis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-zinc-400 text-[11px]">
                <tr>
                  <td className="p-3 font-mono text-zinc-300">PURPOSE_AUTH_AND_EXECUTION</td>
                  <td className="p-3">User account provisioning, session authentication, and delta-neutral terminal dashboard access.</td>
                  <td className="p-3">Email, Username, Passhash, Session token</td>
                  <td className="p-3 text-accent-emerald font-semibold">Consent (Section 6)</td>
                </tr>
                <tr>
                  <td className="p-3 font-mono text-zinc-300">PURPOSE_EXCHANGE_DISPATCH</td>
                  <td className="p-3">Signing and dispatching delta-neutral basis orders to Binance USD-M and Bitget UTA APIs.</td>
                  <td className="p-3">Encrypted API Keys & Secrets, Order parameters</td>
                  <td className="p-3 text-accent-emerald font-semibold">Consent (Section 6)</td>
                </tr>
                <tr>
                  <td className="p-3 font-mono text-zinc-300">PURPOSE_DIAGNOSTICS_TELEMETRY</td>
                  <td className="p-3">Real-time WebSocket latency tracking, bot heartbeat monitoring, and error remediation.</td>
                  <td className="p-3">IP address, latency timestamps, client error traces</td>
                  <td className="p-3 text-amber-400 font-semibold">Voluntary Opt-in Consent</td>
                </tr>
                <tr>
                  <td className="p-3 font-mono text-zinc-300">PURPOSE_MARKET_CACHE</td>
                  <td className="p-3">Locally caching funding rate spreads and watchlist filter preferences.</td>
                  <td className="p-3">Client preferences, cookie cache</td>
                  <td className="p-3 text-cyan-400 font-semibold">Legitimate Use / Essential UI</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 3: Data Retention & Deletion */}
        <section id="retention" className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center space-x-2 text-zinc-100 font-bold text-base sm:text-lg">
            <Clock className="w-4 h-4 text-accent-emerald" />
            <h2>3. Data Retention & Erasure Standards (Section 8(7))</h2>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Under Section 8(7) of the DPDP Act 2023, the Data Fiduciary shall erase personal data upon the Data Principal withdrawing consent or as soon as it is reasonable to assume that the specified purpose is no longer being served:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-surface border border-border space-y-1.5">
              <span className="font-bold text-zinc-200 text-xs">API Vault Credentials</span>
              <p className="text-[11px] text-zinc-400">
                Retained only while actively configured. Overwritten immediately upon user deletion or account erasure request.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-surface border border-border space-y-1.5">
              <span className="font-bold text-zinc-200 text-xs">Execution & Order Logs</span>
              <p className="text-[11px] text-zinc-400">
                Retained for trading telemetry and user history. Purged within 14 business days upon verified erasure request.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-surface border border-border space-y-1.5">
              <span className="font-bold text-zinc-200 text-xs">Consent Audit Records</span>
              <p className="text-[11px] text-zinc-400">
                Retained as immutable statutory proof of compliance under Section 6(3) for the duration required by applicable Indian law.
              </p>
            </div>
          </div>
        </section>

        {/* Section 4: Third Parties & Cross-Border Transfers */}
        <section id="third-parties" className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center space-x-2 text-zinc-100 font-bold text-base sm:text-lg">
            <ExternalLink className="w-4 h-4 text-purple-400" />
            <h2>4. Third-Party Data Processors & Cross-Border Transfers (Section 16)</h2>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            To execute cross-exchange delta-neutral basis orders, the platform communicates directly with external trading venues and infrastructure providers:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
              <span className="font-bold text-amber-400 text-xs">Binance (USD-M Futures)</span>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Orders and HMAC-SHA256 signatures are dispatched to Binance infrastructure (fapi.binance.com / testnet) to place basis hedge legs.
              </p>
              <div className="text-[10px] text-zinc-500 font-mono">Location: Global Cloud Infrastructure</div>
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
              <span className="font-bold text-cyan-400 text-xs">Bitget (UTA V3 Perpetuals)</span>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Orders and HMAC-SHA256 signatures are dispatched to Bitget infrastructure (api.bitget.com) to execute matching counter-legs.
              </p>
              <div className="text-[10px] text-zinc-500 font-mono">Location: Global Cloud Infrastructure</div>
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
              <span className="font-bold text-zinc-300 text-xs">Cloudflare, Inc.</span>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Provides edge tunneling (cloudflared), DDoS mitigation, and TLS encryption for inbound web access.
              </p>
              <div className="text-[10px] text-zinc-500 font-mono">Location: Global Anycast Network</div>
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-400">
            <strong className="text-zinc-200">Cross-Border Transfer Notice:</strong> Under Section 16 of the DPDP Act 2023,
            personal data is transferred only to countries and territories not restricted by the Central Government of India.
            By providing your exchange credentials, you acknowledge cross-border transit necessary to execute trades on international exchanges.
          </div>
        </section>

        {/* Section 5: Data Principal Rights */}
        <section id="principal-rights" className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center space-x-2 text-zinc-100 font-bold text-base sm:text-lg">
            <ShieldCheck className="w-4 h-4 text-accent-emerald" />
            <h2>5. Your Statutory Rights as a Data Principal (Sections 11–14)</h2>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            As a Data Principal residing in India, you are endowed with non-derogable rights under Chapter III of the DPDP Act:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-4 rounded-xl bg-surface border border-border space-y-1.5">
              <span className="font-bold text-zinc-200 flex items-center space-x-1.5">
                <FileText className="w-3.5 h-3.5 text-accent-amber" />
                <span>Right to Access Summary (Section 11)</span>
              </span>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Request a comprehensive summary of all digital personal data processed by us, including active consents, account metadata, and identities of all third parties with whom data has been shared.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border space-y-1.5">
              <span className="font-bold text-zinc-200 flex items-center space-x-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-accent-cyan" />
                <span>Right to Correction & Updating (Section 12(1))</span>
              </span>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Request correction of misleading, incomplete, or inaccurate personal data, or updating of personal exchange keys stored in your account vault.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border space-y-1.5">
              <span className="font-bold text-zinc-200 flex items-center space-x-1.5">
                <Trash2 className="w-3.5 h-3.5 text-accent-rose" />
                <span>Right to Erasure (Section 12(2))</span>
              </span>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Request permanent erasure of your personal data when the processing purpose is completed, or upon withdrawing consent, subject to statutory retention obligations under Indian law.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border space-y-1.5">
              <span className="font-bold text-zinc-200 flex items-center space-x-1.5">
                <Scale className="w-3.5 h-3.5 text-purple-400" />
                <span>Right to Nominate (Section 14)</span>
              </span>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Nominate any individual who, in the event of your death or incapacity, shall exercise your Data Principal rights on your behalf.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between p-4 rounded-xl bg-accent-amber/10 border border-accent-amber/30 text-xs gap-3">
            <div>
              <div className="font-bold text-accent-amber">Want to exercise your statutory rights immediately?</div>
              <p className="text-[11px] text-zinc-400">Use our self-service Data Rights Request portal to access, correct, or erase data.</p>
            </div>
            <Link
              href="/data-rights"
              className="px-4 py-2 rounded-lg bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold shrink-0 transition-colors flex items-center space-x-1.5"
            >
              <span>Submit Data Rights Request</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </section>

        {/* Section 6: Grievance Redressal Officer Contact */}
        <section id="grievance-contact" className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center space-x-2 text-zinc-100 font-bold text-base sm:text-lg">
            <Mail className="w-4 h-4 text-accent-amber" />
            <h2>6. Grievance Redressal Officer & Escalation (Section 13)</h2>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            In compliance with Section 8(9) and Section 13 of the DPDP Act 2023, the Data Fiduciary has designated a Grievance Redressal Officer to address all inquiries, consent withdrawals, and complaints:
          </p>

          <div className="p-5 rounded-xl bg-[#121215] border border-zinc-800 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-[10px] text-zinc-500 uppercase font-semibold">Designated Officer</span>
                <div className="font-bold text-zinc-100 text-sm">{GRIEVANCE_OFFICER_INFO.name}</div>
                <div className="text-accent-amber text-[11px]">{GRIEVANCE_OFFICER_INFO.designation}</div>
              </div>

              <div>
                <span className="text-[10px] text-zinc-500 uppercase font-semibold">Organization / Fiduciary</span>
                <div className="font-bold text-zinc-100 text-sm">{GRIEVANCE_OFFICER_INFO.organization}</div>
                <div className="text-zinc-400 text-[11px]">Jurisdiction: {GRIEVANCE_OFFICER_INFO.jurisdiction}</div>
              </div>

              <div>
                <span className="text-[10px] text-zinc-500 uppercase font-semibold">Direct Grievance Contact</span>
                <div className="font-mono text-accent-cyan text-xs">
                  <a href={`mailto:${GRIEVANCE_OFFICER_INFO.email}`} className="hover:underline">
                    {GRIEVANCE_OFFICER_INFO.email}
                  </a>
                </div>
                <div className="font-mono text-zinc-400 text-[11px]">
                  DPO: <a href={`mailto:${GRIEVANCE_OFFICER_INFO.dpoEmail}`} className="hover:underline">{GRIEVANCE_OFFICER_INFO.dpoEmail}</a>
                </div>
              </div>

              <div>
                <span className="text-[10px] text-zinc-500 uppercase font-semibold">Statutory Response Window</span>
                <div className="font-bold text-emerald-400 text-xs">
                  Within {GRIEVANCE_OFFICER_INFO.responseWindowDays} Calendar Days
                </div>
                <div className="text-zinc-500 text-[10px]">
                  Rule 13, Digital Personal Data Protection Rules
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-zinc-800/80 text-[11px] text-zinc-400 leading-relaxed space-y-1.5">
              <strong className="text-zinc-200">Statutory Escalation to the Data Protection Board of India:</strong>
              <p>
                If your grievance is not resolved by our Grievance Redressal Officer within the statutory period of {GRIEVANCE_OFFICER_INFO.responseWindowDays} days, or if you are dissatisfied with the resolution provided, you have the statutory right under Section 13(3) of the DPDP Act 2023 to file a formal complaint before the <strong>{GRIEVANCE_OFFICER_INFO.escalationBody}</strong>.
              </p>
            </div>
          </div>
        </section>

        {/* Bottom Back Button */}
        <div className="pt-6 border-t border-border flex items-center justify-between text-xs">
          <Link href="/" className="text-zinc-400 hover:text-accent-amber transition-colors flex items-center space-x-1.5">
            <span>← Return to Platform Home</span>
          </Link>
          <Link href="/terms" className="text-zinc-400 hover:text-accent-amber transition-colors">
            View Terms of Service →
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
