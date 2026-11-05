import fs from "fs";
import path from "path";
import crypto from "crypto";
import { readDataFile, saveDataFile, resolveDataFilePath, resolveUserStoragePath } from "./storagePath";
import { findUserByEmail, findUserById, deleteUserAccount, purgeUserApiKeys } from "./userStore";

/**
 * Compliance Store for Digital Personal Data Protection Act (DPDP Act 2023, India)
 * Manages verifiable consent audit trails, Data Principal rights requests,
 * and data portability summaries.
 */

export {
  DPDP_NOTICE_VERSION,
  GRIEVANCE_OFFICER_INFO,
  type ConsentPurpose,
  type ConsentRecord,
  type DataRightType,
  type DataRightsRequest,
} from "./complianceConstants";
import {
  DPDP_NOTICE_VERSION,
  GRIEVANCE_OFFICER_INFO,
  ConsentPurpose,
  ConsentRecord,
  DataRightType,
  DataRightsRequest,
} from "./complianceConstants";

const CONSENT_FILE = "compliance_consent_records.json";
const DATA_RIGHTS_FILE = "compliance_data_rights_requests.json";

/**
 * Record a single consent event with immutable timestamp and version
 */
export function recordConsent(
  userEmail: string,
  purpose: ConsentPurpose,
  status: "GRANTED" | "WITHDRAWN",
  options: { userId?: string; ipAddress?: string; userAgent?: string; version?: string } = {}
): ConsentRecord {
  const consents = readDataFile<ConsentRecord[]>(CONSENT_FILE, []);
  
  const record: ConsentRecord = {
    id: `cst_${crypto.randomBytes(8).toString("hex")}`,
    userId: options.userId,
    userEmail: userEmail.toLowerCase().trim(),
    purpose,
    status,
    version: options.version || DPDP_NOTICE_VERSION,
    timestamp: new Date().toISOString(),
    ipAddress: options.ipAddress || "127.0.0.1",
    userAgent: options.userAgent || "Unknown",
  };

  consents.push(record);
  saveDataFile(CONSENT_FILE, consents);
  return record;
}

/**
 * Record a batch of consent decisions (e.g., at registration or consent banner submission)
 */
export function recordBatchConsents(
  userEmail: string,
  purposes: { purpose: ConsentPurpose; status: "GRANTED" | "WITHDRAWN" }[],
  options: { userId?: string; ipAddress?: string; userAgent?: string } = {}
): ConsentRecord[] {
  const consents = readDataFile<ConsentRecord[]>(CONSENT_FILE, []);
  const records: ConsentRecord[] = [];

  const now = new Date().toISOString();
  for (const item of purposes) {
    const record: ConsentRecord = {
      id: `cst_${crypto.randomBytes(8).toString("hex")}`,
      userId: options.userId,
      userEmail: userEmail.toLowerCase().trim(),
      purpose: item.purpose,
      status: item.status,
      version: DPDP_NOTICE_VERSION,
      timestamp: now,
      ipAddress: options.ipAddress || "127.0.0.1",
      userAgent: options.userAgent || "Unknown",
    };
    records.push(record);
    consents.push(record);
  }

  saveDataFile(CONSENT_FILE, consents);
  return records;
}

/**
 * Get active consents for a specific user
 */
export function getUserActiveConsents(userEmail: string): Record<ConsentPurpose, boolean> {
  const consents = readDataFile<ConsentRecord[]>(CONSENT_FILE, []);
  const cleanEmail = userEmail.toLowerCase().trim();

  const userConsents = consents.filter((c) => c.userEmail === cleanEmail);

  // Purpose defaults
  const active: Record<ConsentPurpose, boolean> = {
    PURPOSE_AUTH_AND_EXECUTION: false,
    PURPOSE_EXCHANGE_DISPATCH: false,
    PURPOSE_DIAGNOSTICS_TELEMETRY: false,
    PURPOSE_MARKET_CACHE: false,
  };

  // Process in chronological order so later WITHDRAWN or GRANTED overrides earlier
  userConsents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const c of userConsents) {
    active[c.purpose] = c.status === "GRANTED";
  }

  return active;
}

/**
 * Get full consent audit history for a user
 */
export function getUserConsentHistory(userEmail: string): ConsentRecord[] {
  const consents = readDataFile<ConsentRecord[]>(CONSENT_FILE, []);
  const cleanEmail = userEmail.toLowerCase().trim();
  return consents.filter((c) => c.userEmail === cleanEmail).reverse();
}

/**
 * Create a formal Data Rights request under DPDP Act 2023
 */
export function createDataRightsRequest(params: {
  userEmail: string;
  userId?: string;
  requestType: DataRightType;
  details: string;
  nomineeName?: string;
  nomineeContact?: string;
  ipAddress?: string;
}): DataRightsRequest {
  const requests = readDataFile<DataRightsRequest[]>(DATA_RIGHTS_FILE, []);

  const randCode = Math.floor(100000 + Math.random() * 900000);
  const requestId = `DPR-${new Date().getFullYear()}-${randCode}`;

  const request: DataRightsRequest = {
    requestId,
    userEmail: params.userEmail.toLowerCase().trim(),
    userId: params.userId,
    requestType: params.requestType,
    details: params.details.trim(),
    nomineeName: params.nomineeName?.trim(),
    nomineeContact: params.nomineeContact?.trim(),
    status: "PENDING",
    submittedAt: new Date().toISOString(),
    ipAddress: params.ipAddress || "127.0.0.1",
  };

  // If request is WITHDRAW_ALL_CONSENT, automatically log withdrawal and purge API keys
  if (params.requestType === "WITHDRAW_ALL_CONSENT") {
    recordBatchConsents(
      params.userEmail,
      [
        { purpose: "PURPOSE_AUTH_AND_EXECUTION", status: "WITHDRAWN" },
        { purpose: "PURPOSE_EXCHANGE_DISPATCH", status: "WITHDRAWN" },
        { purpose: "PURPOSE_DIAGNOSTICS_TELEMETRY", status: "WITHDRAWN" },
        { purpose: "PURPOSE_MARKET_CACHE", status: "WITHDRAWN" },
      ],
      { userId: params.userId, ipAddress: params.ipAddress }
    );
    purgeUserApiKeys(params.userEmail);
    request.status = "COMPLETED";
    request.resolvedAt = new Date().toISOString();
    request.resolutionNotes = "All voluntary consents successfully revoked; exchange API keys purged from vault.";
  }

  // If request is ERASURE, execute permanent deletion under Section 12(2) DPDP Act 2023
  if (params.requestType === "ERASURE") {
    executeErasureRequest(params.userEmail, params.userId);
    request.status = "COMPLETED";
    request.resolvedAt = new Date().toISOString();
    request.resolutionNotes = "Account record, encrypted API vault keys, and tenant data directories permanently erased under Section 12(2) DPDP Act 2023.";
  }

  requests.push(request);
  saveDataFile(DATA_RIGHTS_FILE, requests);
  return request;
}

/**
 * Execute actual permanent erasure of personal data under Section 12(2) DPDP Act 2023
 */
export function executeErasureRequest(userEmail: string, requestingUserId?: string): { success: boolean; message: string } {
  const cleanEmail = userEmail.toLowerCase().trim();
  const user = findUserByEmail(cleanEmail);

  // 1. Purge exchange API keys
  purgeUserApiKeys(cleanEmail);

  // 2. Permanently delete user account and tenant storage directory
  deleteUserAccount(cleanEmail);

  // 3. Record statutory erasure in compliance audit ledger
  recordBatchConsents(
    cleanEmail,
    [
      { purpose: "PURPOSE_AUTH_AND_EXECUTION", status: "WITHDRAWN" },
      { purpose: "PURPOSE_EXCHANGE_DISPATCH", status: "WITHDRAWN" },
      { purpose: "PURPOSE_DIAGNOSTICS_TELEMETRY", status: "WITHDRAWN" },
      { purpose: "PURPOSE_MARKET_CACHE", status: "WITHDRAWN" },
    ],
    { userId: requestingUserId || user?.id, ipAddress: "127.0.0.1", userAgent: "Statutory Erasure Engine" }
  );

  return {
    success: true,
    message: `Personal data for ${cleanEmail} has been permanently erased from the platform.`,
  };
}

/**
 * List Data Rights requests for a user
 */
export function getUserDataRightsRequests(userEmail: string): DataRightsRequest[] {
  const requests = readDataFile<DataRightsRequest[]>(DATA_RIGHTS_FILE, []);
  const cleanEmail = userEmail.toLowerCase().trim();
  return requests.filter((r) => r.userEmail === cleanEmail).reverse();
}

/**
 * Generate personal data portability package under Section 11 of DPDP Act
 */
export function exportUserDataSummary(userEmail: string) {
  const cleanEmail = userEmail.toLowerCase().trim();
  const user = findUserByEmail(cleanEmail);

  const consents = getUserConsentHistory(cleanEmail);
  const activeConsents = getUserActiveConsents(cleanEmail);
  const rightsRequests = getUserDataRightsRequests(cleanEmail);

  // Load real trading history summary if user directory exists
  let tradeHistorySummary: any = { totalTrades: 0, records: [] };
  if (user?.id) {
    try {
      const tradesPath = resolveUserStoragePath(user.id, "hedge_trades_history.json");
      if (fs.existsSync(tradesPath)) {
        const rawTrades = JSON.parse(fs.readFileSync(tradesPath, "utf-8"));
        if (Array.isArray(rawTrades)) {
          tradeHistorySummary = {
            totalTrades: rawTrades.length,
            records: rawTrades.slice(-20),
          };
        }
      }
    } catch {}
  }

  return {
    complianceNotice: "Data Principal Personal Data Summary (Section 11, DPDP Act 2023, India)",
    exportedAt: new Date().toISOString(),
    dataFiduciary: {
      name: GRIEVANCE_OFFICER_INFO.organization,
      grievanceOfficer: GRIEVANCE_OFFICER_INFO.name,
      contactEmail: GRIEVANCE_OFFICER_INFO.email,
    },
    dataPrincipal: {
      id: user?.id || "N/A",
      email: cleanEmail,
      username: user?.username || "N/A",
      role: user?.role || "user",
      accountCreated: user?.createdAt || "N/A",
      lastLogin: user?.lastLogin || "N/A",
    },
    identity: {
      id: user?.id || "N/A",
      email: cleanEmail,
      username: user?.username || "N/A",
      role: user?.role || "user",
    },
    apiKeysVaultStatus: {
      hasBinanceKeyConfigured: Boolean(user?.apiKeys?.binanceKey),
      binanceKeyPreview: user?.apiKeys?.binanceKey
        ? `${user.apiKeys.binanceKey.slice(0, 4)}••••••••`
        : "None",
      binanceEndpoint: user?.apiKeys?.binanceEndpoint || "None",
      hasBitgetKeyConfigured: Boolean(user?.apiKeys?.bitgetKey),
      bitgetKeyPreview: user?.apiKeys?.bitgetKey
        ? `${user.apiKeys.bitgetKey.slice(0, 4)}••••••••`
        : "None",
      bitgetEnvironment: user?.apiKeys?.bitgetEnv || "None",
    },
    tradingTelemetrySummary: tradeHistorySummary,
    activeConsents,
    consentAuditTrail: consents,
    dataRightsRequests: rightsRequests,
  };
}
