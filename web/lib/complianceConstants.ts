/**
 * Client-safe constants and types for DPDP Act 2023 compliance
 * (Zero Node.js 'fs' dependencies - safe to import in client and server components)
 */

export const DPDP_NOTICE_VERSION = "v1.0-2026-DPDP";

export const GRIEVANCE_OFFICER_INFO = {
  name: "",
  designation: "Data Protection Officer & Grievance Redressal Officer",
  organization: "",
  email: "",
  dpoEmail: "",
  jurisdiction: "Mumbai, Maharashtra, India",
  responseWindowDays: 30,
  escalationBody: "Data Protection Board of India (DPBI)",
};

export type ConsentPurpose =
  | "PURPOSE_AUTH_AND_EXECUTION"
  | "PURPOSE_EXCHANGE_DISPATCH"
  | "PURPOSE_DIAGNOSTICS_TELEMETRY"
  | "PURPOSE_MARKET_CACHE";

export interface ConsentRecord {
  id: string;
  userId?: string;
  userEmail: string;
  purpose: ConsentPurpose;
  status: "GRANTED" | "WITHDRAWN";
  version: string;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
}

export type DataRightType =
  | "ACCESS_SUMMARY"
  | "CORRECTION"
  | "ERASURE"
  | "WITHDRAW_ALL_CONSENT"
  | "NOMINATION"
  | "GRIEVANCE";

export interface DataRightsRequest {
  requestId: string;
  userEmail: string;
  userId?: string;
  requestType: DataRightType;
  details: string;
  nomineeName?: string;
  nomineeContact?: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED";
  submittedAt: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  ipAddress?: string;
}
