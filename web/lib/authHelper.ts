import { NextRequest } from "next/server";
import {
  findUserById,
  findUserByEmail,
  isUserAdminRole,
  verifySessionToken,
  SYSTEM_DEFAULT_BINANCE_KEY,
  SYSTEM_DEFAULT_BINANCE_SECRET,
  SYSTEM_DEFAULT_BITGET_KEY,
  SYSTEM_DEFAULT_BITGET_SECRET,
  SYSTEM_DEFAULT_BITGET_PASSPHRASE,
  SYSTEM_DEFAULT_COINDCX_KEY,
  SYSTEM_DEFAULT_COINDCX_SECRET,
  SYSTEM_DEFAULT_BYBIT_KEY,
  SYSTEM_DEFAULT_BYBIT_SECRET,
  UserAccount,
} from "./userStore";
import { decryptVaultSecret, isMaskedSecret } from "./cryptoVault";

export interface ResolvedCredentials {
  authorized: boolean;
  isAdmin: boolean;
  user: UserAccount | null;
  binanceKey: string;
  binanceSecret: string;
  binanceEndpoint: string;
  bitgetKey: string;
  bitgetSecret: string;
  bitgetPassphrase: string;
  bitgetEnv: string;
  coindcxKey: string;
  coindcxSecret: string;
  bybitKey: string;
  bybitSecret: string;
  bybitProxy?: string;
  bybitBaseUrl?: string;
  bybitBackupProxy?: string;
  bybitBackupBaseUrl?: string;
  error?: string;
}

const DEFAULT_BINANCE_ENDPOINT = "https://testnet.binancefuture.com";

function resolveSecret(headerVal: string | null | undefined, storedVal: string | null | undefined, defaultVal: string): string {
  const h = headerVal?.trim() || "";
  if (h && !isMaskedSecret(h)) {
    return decryptVaultSecret(h);
  }
  const s = storedVal?.trim() || "";
  if (s && !isMaskedSecret(s)) {
    return decryptVaultSecret(s);
  }
  return defaultVal ? decryptVaultSecret(defaultVal) : "";
}

export function resolveCallerCredentials(req: NextRequest): ResolvedCredentials {
  const cookieHeader = req.headers.get("cookie") || "";
  const authCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("auth_session="));
  const rawSession = authCookie ? decodeURIComponent(authCookie.replace("auth_session=", "").trim()) : "";

  let user: UserAccount | null = null;
  if (rawSession) {
    const verifiedUserId = verifySessionToken(rawSession);
    if (verifiedUserId) {
      user = findUserById(verifiedUserId) || null;
    }
  }

  const isAdmin = user ? isUserAdminRole(user) : false;

  // Header-provided keys (e.g. from user's vault settings in localStorage)
  const headerBinanceKey = req.headers.get("x-binance-key")?.trim() || "";
  const headerBinanceSecret = req.headers.get("x-binance-secret")?.trim() || "";
  const rawHeaderEndpoint = req.headers.get("x-binance-endpoint")?.trim() || "";
  const headerBinanceEndpoint =
    rawHeaderEndpoint && rawHeaderEndpoint !== "auto" && rawHeaderEndpoint.startsWith("http")
      ? rawHeaderEndpoint
      : DEFAULT_BINANCE_ENDPOINT;

  const headerBitgetKey = req.headers.get("x-bitget-key")?.trim() || "";
  const headerBitgetSecret = req.headers.get("x-bitget-secret")?.trim() || "";
  const headerBitgetPassphrase = req.headers.get("x-bitget-passphrase")?.trim() || "";
  const headerBitgetEnv = req.headers.get("x-bitget-env")?.trim() || "demo";

  const headerCoindcxKey = req.headers.get("x-coindcx-key")?.trim() || "";
  const headerCoindcxSecret = req.headers.get("x-coindcx-secret")?.trim() || "";

  const headerBybitKey = req.headers.get("x-bybit-key")?.trim() || "";
  const headerBybitSecret = req.headers.get("x-bybit-secret")?.trim() || "";
  const headerBybitProxy = req.headers.get("x-bybit-proxy")?.trim() || "";
  const headerBybitBaseUrl = req.headers.get("x-bybit-base-url")?.trim() || "";
  const headerBybitBackupProxy = req.headers.get("x-bybit-backup-proxy")?.trim() || "";
  const headerBybitBackupBaseUrl = req.headers.get("x-bybit-backup-base-url")?.trim() || "";

  // Case 1: Caller is Admin (or admin credentials explicitly used)
  if (isAdmin || (user && user.role === "admin")) {
    const binanceKey = headerBinanceKey || user?.apiKeys?.binanceKey || SYSTEM_DEFAULT_BINANCE_KEY;
    const binanceSecret = resolveSecret(headerBinanceSecret, user?.apiKeys?.binanceSecret, SYSTEM_DEFAULT_BINANCE_SECRET);
    const binanceEndpoint =
      headerBinanceEndpoint || user?.apiKeys?.binanceEndpoint || DEFAULT_BINANCE_ENDPOINT;

    const bitgetKey = headerBitgetKey || user?.apiKeys?.bitgetKey || SYSTEM_DEFAULT_BITGET_KEY;
    const bitgetSecret = resolveSecret(headerBitgetSecret, user?.apiKeys?.bitgetSecret, SYSTEM_DEFAULT_BITGET_SECRET);
    const bitgetPassphrase = resolveSecret(headerBitgetPassphrase, user?.apiKeys?.bitgetPassphrase, SYSTEM_DEFAULT_BITGET_PASSPHRASE);
    const bitgetEnv = headerBitgetEnv || user?.apiKeys?.bitgetEnv || "demo";

    const coindcxKey = headerCoindcxKey || user?.apiKeys?.coindcxKey || SYSTEM_DEFAULT_COINDCX_KEY;
    const coindcxSecret = resolveSecret(headerCoindcxSecret, user?.apiKeys?.coindcxSecret, SYSTEM_DEFAULT_COINDCX_SECRET);

    const bybitKey = headerBybitKey || user?.apiKeys?.bybitKey || SYSTEM_DEFAULT_BYBIT_KEY;
    const bybitSecret = resolveSecret(headerBybitSecret, user?.apiKeys?.bybitSecret, SYSTEM_DEFAULT_BYBIT_SECRET);
    const bybitProxy = headerBybitProxy || user?.apiKeys?.bybitProxy || process.env.BYBIT_PROXY_URL;
    const bybitBaseUrl = headerBybitBaseUrl || user?.apiKeys?.bybitBaseUrl || process.env.BYBIT_BASE_URL;
    const bybitBackupProxy = headerBybitBackupProxy || user?.apiKeys?.bybitBackupProxy || process.env.BYBIT_BACKUP_PROXY_URL;
    const bybitBackupBaseUrl = headerBybitBackupBaseUrl || user?.apiKeys?.bybitBackupBaseUrl || process.env.BYBIT_BACKUP_BASE_URL;

    return {
      authorized: true,
      isAdmin: true,
      user,
      binanceKey,
      binanceSecret,
      binanceEndpoint,
      bitgetKey,
      bitgetSecret,
      bitgetPassphrase,
      bitgetEnv,
      coindcxKey,
      coindcxSecret,
      bybitKey,
      bybitSecret,
      bybitProxy,
      bybitBaseUrl,
      bybitBackupProxy,
      bybitBackupBaseUrl,
    };
  }

  // Case 2: Standard non-admin User
  if (user && user.role !== "admin") {
    const userBinanceKey = headerBinanceKey || user.apiKeys?.binanceKey || "";
    const userBinanceSecret = resolveSecret(headerBinanceSecret, user.apiKeys?.binanceSecret, "");
    const binanceEndpoint =
      headerBinanceEndpoint || user.apiKeys?.binanceEndpoint || DEFAULT_BINANCE_ENDPOINT;

    const userBitgetKey = headerBitgetKey || user.apiKeys?.bitgetKey || "";
    const userBitgetSecret = resolveSecret(headerBitgetSecret, user.apiKeys?.bitgetSecret, "");
    const userBitgetPassphrase = resolveSecret(headerBitgetPassphrase, user.apiKeys?.bitgetPassphrase, "");
    const bitgetEnv = headerBitgetEnv || user.apiKeys?.bitgetEnv || "demo";

    const userCoindcxKey = headerCoindcxKey || user.apiKeys?.coindcxKey || "";
    const userCoindcxSecret = resolveSecret(headerCoindcxSecret, user.apiKeys?.coindcxSecret, "");

    const userBybitKey = headerBybitKey || user.apiKeys?.bybitKey || "";
    const userBybitSecret = resolveSecret(headerBybitSecret, user.apiKeys?.bybitSecret, "");
    const userBybitProxy = headerBybitProxy || user.apiKeys?.bybitProxy || process.env.BYBIT_PROXY_URL;
    const userBybitBaseUrl = headerBybitBaseUrl || user.apiKeys?.bybitBaseUrl || process.env.BYBIT_BASE_URL;
    const userBybitBackupProxy = headerBybitBackupProxy || user.apiKeys?.bybitBackupProxy || process.env.BYBIT_BACKUP_PROXY_URL;
    const userBybitBackupBaseUrl = headerBybitBackupBaseUrl || user.apiKeys?.bybitBackupBaseUrl || process.env.BYBIT_BACKUP_BASE_URL;

    return {
      authorized: true,
      isAdmin: false,
      user,
      binanceKey: userBinanceKey,
      binanceSecret: userBinanceSecret,
      binanceEndpoint,
      bitgetKey: userBitgetKey,
      bitgetSecret: userBitgetSecret,
      bitgetPassphrase: userBitgetPassphrase,
      bitgetEnv,
      coindcxKey: userCoindcxKey,
      coindcxSecret: userCoindcxSecret,
      bybitKey: userBybitKey,
      bybitSecret: userBybitSecret,
      bybitProxy: userBybitProxy,
      bybitBaseUrl: userBybitBaseUrl,
      bybitBackupProxy: userBybitBackupProxy,
      bybitBackupBaseUrl: userBybitBackupBaseUrl,
    };
  }

  // Case 3 & 4: Unauthenticated caller.
  // CRITICAL SECURITY ENFORCEMENT: Explicit header credentials (x-binance-key, x-binance-secret, etc.)
  // are ONLY accepted if the caller has an already verified authenticated session (handled in Case 1 & 2 above).
  // If user is null (no valid auth_session cookie), callers MUST be rejected with authorized: false
  // and empty credentials, ensuring strict HTTP 401 across all order, hedge, and execution routes.
  return {
    authorized: false,
    isAdmin: false,
    user: null,
    binanceKey: "",
    binanceSecret: "",
    binanceEndpoint: headerBinanceEndpoint,
    bitgetKey: "",
    bitgetSecret: "",
    bitgetPassphrase: "",
    bitgetEnv: headerBitgetEnv,
    coindcxKey: "",
    coindcxSecret: "",
    bybitKey: "",
    bybitSecret: "",
    bybitProxy: headerBybitProxy || process.env.BYBIT_PROXY_URL,
    bybitBaseUrl: headerBybitBaseUrl || process.env.BYBIT_BASE_URL,
    bybitBackupProxy: headerBybitBackupProxy || process.env.BYBIT_BACKUP_PROXY_URL,
    bybitBackupBaseUrl: headerBybitBackupBaseUrl || process.env.BYBIT_BACKUP_BASE_URL,
    error: "Authentication required for trade execution.",
  };
}

/**
 * Interface contract implementation from PROJECT.md:
 * getAuthCredentials(req: NextRequest): Promise<{ authorized: boolean; userId?: string; isAdmin?: boolean; error?: string }>
 * returns authorized: false when no valid session cookie/header exists. Never falls back to usr_admin_varsha.
 */
export async function getAuthCredentials(req: NextRequest): Promise<{ authorized: boolean; userId?: string; isAdmin?: boolean; error?: string }> {
  const creds = resolveCallerCredentials(req);
  if (!creds.authorized) {
    return { authorized: false, error: "Authentication required" };
  }
  return {
    authorized: true,
    userId: creds.user?.id,
    isAdmin: creds.isAdmin,
  };
}
