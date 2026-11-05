"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import {
  ShieldCheck,
  FileText,
  UserCheck,
  RefreshCw,
  Trash2,
  Scale,
  Mail,
  CheckCircle2,
  AlertCircle,
  Download,
  ArrowRight,
  Clock,
  Send,
} from "lucide-react";
import { GRIEVANCE_OFFICER_INFO, DataRightType } from "@/lib/complianceConstants";

export default function DataRightsPortalPage() {
  const [email, setEmail] = useState("");
  const [requestType, setRequestType] = useState<DataRightType>("ACCESS_SUMMARY");
  const [details, setDetails] = useState("");
  const [nomineeName, setNomineeName] = useState("");
  const [nomineeContact, setNomineeContact] = useState("");
  const [isAffirmed, setIsAffirmed] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportedData, setExportedData] = useState<any | null>(null);

  // Check if session user is available to prefill
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.user?.email) {
          setEmail(d.user.email);
        }
      })
      .catch(() => {});
  }, []);

  const handleExportData = async () => {
    if (!email) {
      setErrorMsg("Please enter your registered institutional email to export personal data.");
      return;
    }
    setIsExporting(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/compliance/data-rights?export=true&email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (data.success && data.export) {
        setExportedData(data.export);
        // Trigger file download
        const blob = new Blob([JSON.stringify(data.export, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `data_principal_export_${email.replace(/[^a-zA-Z0-9]/g, "_")}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        setErrorMsg(data.error || "Failed to generate personal data export package.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Network error exporting data.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes("@")) {
      setErrorMsg("Please provide a valid Data Principal institutional email address.");
      return;
    }

    if (details.trim().length < 5) {
      setErrorMsg("Please provide detailed justification (minimum 5 characters) for your statutory request.");
      return;
    }

    if (!isAffirmed) {
      setErrorMsg("You must affirm under Section 15 of the DPDP Act 2023 that the information provided is authentic.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/compliance/data-rights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          requestType,
          details: details.trim(),
          nomineeName: nomineeName.trim() || undefined,
          nomineeContact: nomineeContact.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.success && data.request) {
        setSubmittedRef(data.request.requestId);
        setSuccessMsg(data.message);
        setDetails("");
        setNomineeName("");
        setNomineeContact("");
        setIsAffirmed(false);
      } else {
        setErrorMsg(data.error || "Failed to submit statutory data rights request.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Network error submitting request.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-mono selection:bg-accent-amber/20 selection:text-accent-amber">
      <Navbar />

      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 md:p-10 pb-24 sm:pb-10 space-y-8">
        {/* Header */}
        <div className="space-y-3 border-b border-border pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 rounded bg-accent-amber/10 border border-accent-amber/30 text-accent-amber text-[11px] font-bold flex items-center space-x-1.5">
              <Scale className="w-3.5 h-3.5" />
              <span>STATUTORY DATA PRINCIPAL RIGHTS PORTAL (DPDP ACT 2023)</span>
            </span>
            <span className="px-2.5 py-1 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[11px] font-bold">
              [LEGAL REVIEW REQUIRED]
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight uppercase text-zinc-100">
            Exercise Your Data Protection Rights
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-2xl">
            Under Chapter III (Sections 11–14) of the Digital Personal Data Protection Act, 2023, you have statutory rights
            to access, correct, erase your personal data, withdraw consent, nominate representatives, or submit grievances.
          </p>
        </div>

        {/* Instant Access Summary Action Card */}
        <div className="p-5 rounded-2xl bg-surface border border-accent-cyan/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-xs font-bold text-accent-cyan uppercase">
              <Download className="w-4 h-4" />
              <span>Right to Access Summary (Section 11) - Instant Portability</span>
            </div>
            <p className="text-[11px] text-zinc-400 max-w-xl leading-relaxed">
              Instantly generate and download your verified machine-readable JSON data portability package
              containing your account metadata, encrypted key vault status, trade records, and consent audit trail.
            </p>
          </div>

          <button
            type="button"
            onClick={handleExportData}
            disabled={isExporting}
            className="px-4 py-2.5 rounded-xl bg-accent-cyan hover:bg-cyan-400 text-zinc-950 font-bold text-xs shrink-0 transition-colors flex items-center space-x-2 shadow-lg shadow-cyan-500/10"
          >
            <Download className="w-4 h-4" />
            <span>{isExporting ? "Exporting Data..." : "Download Data Package"}</span>
          </button>
        </div>

        {/* Feedback alerts */}
        {errorMsg && (
          <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-5 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs space-y-2">
            <div className="flex items-center space-x-2 font-bold text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Request Successfully Registered</span>
            </div>
            <p className="text-[11px] text-emerald-200/90">{successMsg}</p>
            {submittedRef && (
              <div className="pt-2 text-[10px] font-mono text-zinc-400">
                Tracking Reference: <strong className="text-zinc-200">{submittedRef}</strong>
              </div>
            )}
          </div>
        )}

        {/* Main Request Form */}
        <div className="bg-[#121215] border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-zinc-100 uppercase tracking-wide">
              Submit Statutory Rights Request
            </h2>
            <p className="text-xs text-zinc-500">
              Handled directly by the designated Grievance Redressal Officer within {GRIEVANCE_OFFICER_INFO.responseWindowDays} calendar days.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                Registered Trader Email / Data Principal Handle
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="trader@quantfunds.io"
                className="w-full px-3.5 py-2.5 text-xs bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-accent-amber"
                required
              />
            </div>

            {/* Right Type Selector */}
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                Select Statutory Right (DPDP Act Chapter III)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <label className={`p-3 rounded-xl border flex items-start space-x-2.5 cursor-pointer transition-colors ${
                  requestType === "ACCESS_SUMMARY" ? "bg-amber-500/10 border-amber-500/50 text-zinc-200" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}>
                  <input
                    type="radio"
                    name="requestType"
                    checked={requestType === "ACCESS_SUMMARY"}
                    onChange={() => setRequestType("ACCESS_SUMMARY")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-bold text-xs text-zinc-200">Right to Access Summary (Sec 11)</div>
                    <div className="text-[10px] text-zinc-400">Request formal disclosure of all personal data held and shared.</div>
                  </div>
                </label>

                <label className={`p-3 rounded-xl border flex items-start space-x-2.5 cursor-pointer transition-colors ${
                  requestType === "CORRECTION" ? "bg-amber-500/10 border-amber-500/50 text-zinc-200" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}>
                  <input
                    type="radio"
                    name="requestType"
                    checked={requestType === "CORRECTION"}
                    onChange={() => setRequestType("CORRECTION")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-bold text-xs text-zinc-200">Right to Correction (Sec 12(1))</div>
                    <div className="text-[10px] text-zinc-400">Update inaccurate profile details or exchange keys.</div>
                  </div>
                </label>

                <label className={`p-3 rounded-xl border flex items-start space-x-2.5 cursor-pointer transition-colors ${
                  requestType === "ERASURE" ? "bg-rose-500/10 border-rose-500/50 text-zinc-200" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}>
                  <input
                    type="radio"
                    name="requestType"
                    checked={requestType === "ERASURE"}
                    onChange={() => setRequestType("ERASURE")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-bold text-xs text-rose-300">Right to Erasure (Sec 12(2))</div>
                    <div className="text-[10px] text-zinc-400">Permanently erase account, API keys, and order logs.</div>
                  </div>
                </label>

                <label className={`p-3 rounded-xl border flex items-start space-x-2.5 cursor-pointer transition-colors ${
                  requestType === "WITHDRAW_ALL_CONSENT" ? "bg-amber-500/10 border-amber-500/50 text-zinc-200" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}>
                  <input
                    type="radio"
                    name="requestType"
                    checked={requestType === "WITHDRAW_ALL_CONSENT"}
                    onChange={() => setRequestType("WITHDRAW_ALL_CONSENT")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-bold text-xs text-zinc-200">Right to Withdraw Consent (Sec 6(4))</div>
                    <div className="text-[10px] text-zinc-400">Immediately revoke all voluntary processing consents.</div>
                  </div>
                </label>

                <label className={`p-3 rounded-xl border flex items-start space-x-2.5 cursor-pointer transition-colors ${
                  requestType === "NOMINATION" ? "bg-purple-500/10 border-purple-500/50 text-zinc-200" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}>
                  <input
                    type="radio"
                    name="requestType"
                    checked={requestType === "NOMINATION"}
                    onChange={() => setRequestType("NOMINATION")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-bold text-xs text-zinc-200">Right to Nominate (Sec 14)</div>
                    <div className="text-[10px] text-zinc-400">Nominate legal successor in event of incapacity.</div>
                  </div>
                </label>

                <label className={`p-3 rounded-xl border flex items-start space-x-2.5 cursor-pointer transition-colors ${
                  requestType === "GRIEVANCE" ? "bg-amber-500/10 border-amber-500/50 text-zinc-200" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}>
                  <input
                    type="radio"
                    name="requestType"
                    checked={requestType === "GRIEVANCE"}
                    onChange={() => setRequestType("GRIEVANCE")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-bold text-xs text-zinc-200">Grievance Redressal (Sec 13)</div>
                    <div className="text-[10px] text-zinc-400">Lodge formal complaint to the Grievance Officer.</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Nominee details if nomination selected */}
            {requestType === "NOMINATION" && (
              <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-500/30 space-y-3">
                <div className="text-xs font-bold text-purple-300">Nominee Information (Section 14 DPDP Act 2023)</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1 uppercase">Full Name of Nominee</label>
                    <input
                      type="text"
                      value={nomineeName}
                      onChange={(e) => setNomineeName(e.target.value)}
                      placeholder="e.g. Legal Representative Name"
                      className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-400"
                      required={requestType === "NOMINATION"}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1 uppercase">Nominee Email / Contact</label>
                    <input
                      type="text"
                      value={nomineeContact}
                      onChange={(e) => setNomineeContact(e.target.value)}
                      placeholder="nominee@contact.com"
                      className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-400"
                      required={requestType === "NOMINATION"}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Request Details */}
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                Detailed Request Description / Justification
              </label>
              <textarea
                rows={4}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Specify the exact nature of your request, specific data records to correct or erase, or grievance details..."
                className="w-full px-3.5 py-2.5 text-xs bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-accent-amber"
                required
              />
            </div>

            {/* Statutory Affirmation under Section 15 */}
            <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 text-[11px] text-zinc-400 space-y-2">
              <label className="flex items-start space-x-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAffirmed}
                  onChange={(e) => setIsAffirmed(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-700 text-accent-amber focus:ring-0"
                />
                <span className="leading-relaxed">
                  I hereby affirm under <strong>Section 15 of the DPDP Act 2023</strong> that I am the authentic Data Principal
                  (or legally authorized representative), that this request is neither false nor frivolous, and that all information
                  submitted herein is true and accurate.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isLoading || !isAffirmed}
              className={`w-full py-3 rounded-xl font-bold text-xs transition-colors flex items-center justify-center space-x-2 ${
                isLoading || !isAffirmed
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                  : "bg-accent-amber hover:bg-amber-400 text-zinc-950 shadow-lg shadow-amber-500/10"
              }`}
            >
              <Send className="w-4 h-4" />
              <span>{isLoading ? "Submitting Request..." : "Submit Statutory Data Rights Request"}</span>
            </button>
          </form>
        </div>

        {/* Grievance Redressal Direct Info Box */}
        <div className="p-5 rounded-2xl bg-[#121215] border border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
          <div>
            <div className="font-bold text-zinc-200 text-sm">Need Direct Escalation to the Grievance Officer?</div>
            <p className="text-[11px] text-zinc-400">
              {GRIEVANCE_OFFICER_INFO.name ? `Contact ${GRIEVANCE_OFFICER_INFO.name} (${GRIEVANCE_OFFICER_INFO.designation})` : "Statutory redressal portal according to DPDP Act 2023 regulations."}
            </p>
          </div>
          <Link
            href="/privacy#grievance-contact"
            className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold shrink-0 text-xs transition-colors"
          >
            Grievance Redressal Protocol →
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
