import fs from "fs";
import path from "path";
import crypto from "crypto";
import { readDataFile, saveDataFile, resolveDataDir } from "./storagePath";
import {
  encryptVaultSecret,
  decryptVaultSecret,
  maskVaultKey,
  isMaskedSecret,
} from "./cryptoVault";

export interface UserApiKeys {
  binanceKey: string;
  binanceSecret: string;
  binanceEndpoint?: string;
  bitgetKey: string;
  bitgetSecret: string;
  bitgetPassphrase?: string;
  bitgetEnv?: string;
  coindcxKey?: string;
  coindcxSecret?: string;
  bybitKey?: string;
  bybitSecret?: string;
  bybitProxy?: string;
  bybitBaseUrl?: string;
  bybitBackupProxy?: string;
  bybitBackupBaseUrl?: string;
  isPaper?: boolean;
}

export interface UserAccount {
  id: string;
  email: string;
  username: string;
  password: string;
  role: "admin" | "user";
  createdAt: string;
  lastLogin: string;
  apiKeys: UserApiKeys;
}

const USERS_FILE_NAME = "user_accounts_store.json";

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.SECRET_KEY ||
  process.env.NEXTAUTH_SECRET ||
  process.env.COCKPIT_VAULT_KEY ||
  crypto.randomBytes(32).toString("hex");

export function createSessionToken(userId: string): string {
  const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(userId).digest("hex");
  return `${userId}.${hmac}`;
}

export function verifySessionToken(token: string): string | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [userId, sig] = parts;
  if (!userId || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", SESSION_SECRET).update(userId).digest("hex");
  try {
    if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return userId;
    }
  } catch {}
  return null;
}

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(plain, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (!stored || !plain) return false;
  if (stored.startsWith("scrypt:")) {
    const parts = stored.split(":");
    if (parts.length !== 3) return false;
    const [_, salt, hash] = parts;
    const testHash = crypto.scryptSync(plain, salt, 64).toString("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(testHash));
    } catch {
      return false;
    }
  }
  return false;
}

// System Admin Default Credentials
export const ADMIN_EMAIL_PRIMARY = process.env.ADMIN_EMAIL || "admin@safecoiner.com";
export const ADMIN_EMAIL_ALIAS = process.env.ADMIN_EMAIL_ALIAS || "admin@safecoiner.com";
export const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || process.env.ADMIN_PASSWORD || "";

// Synchronous Local Environment Loader for Zero-Failure Production Credentials
function loadLocalEnvSync() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, ".env.local"),
    path.join(cwd, ".env"),
    path.join(cwd, "web", ".env.local"),
    path.join(cwd, "web", ".env"),
    path.join(path.dirname(cwd), ".env.local"),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      try {
        const raw = fs.readFileSync(envPath, "utf8");
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const idx = trimmed.indexOf("=");
          if (idx > 0) {
            const k = trimmed.slice(0, idx).trim();
            const v = trimmed.slice(idx + 1).trim();
            if (k && (!process.env[k] || process.env[k] === "")) {
              process.env[k] = v;
            }
          }
        }
      } catch {}
    }
  }
}
loadLocalEnvSync();

export const SYSTEM_DEFAULT_BINANCE_KEY = process.env.BINANCE_API_KEY || process.env.BINANCE_TESTNET_API_KEY || "";
export const SYSTEM_DEFAULT_BINANCE_SECRET = process.env.BINANCE_API_SECRET || process.env.BINANCE_TESTNET_API_SECRET || "";
export const SYSTEM_DEFAULT_BITGET_KEY = process.env.BITGET_API_KEY || "";
export const SYSTEM_DEFAULT_BITGET_SECRET = process.env.BITGET_API_SECRET || "";
export const SYSTEM_DEFAULT_BITGET_PASSPHRASE = process.env.BITGET_PASSPHRASE || "";
export const SYSTEM_DEFAULT_COINDCX_KEY = process.env.COINDCX_API_KEY || "";
export const SYSTEM_DEFAULT_COINDCX_SECRET = process.env.COINDCX_API_SECRET || "";
export const SYSTEM_DEFAULT_BYBIT_KEY = process.env.BYBIT_API_KEY || "";
export const SYSTEM_DEFAULT_BYBIT_SECRET = process.env.BYBIT_API_SECRET || "";

const globalForUsers = global as unknown as {
  userAccounts?: UserAccount[];
};

function getSeedAdminUser(): UserAccount {
  return {
    id: "usr_admin_varsha",
    email: ADMIN_EMAIL_PRIMARY,
    username: "Admin",
    password: ADMIN_DEFAULT_PASSWORD ? hashPassword(ADMIN_DEFAULT_PASSWORD) : "",
    role: "admin",
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    apiKeys: {
      binanceKey: SYSTEM_DEFAULT_BINANCE_KEY,
      binanceSecret: SYSTEM_DEFAULT_BINANCE_SECRET ? encryptVaultSecret(SYSTEM_DEFAULT_BINANCE_SECRET) : "",
      binanceEndpoint: "https://fapi.binance.com",
      bitgetKey: SYSTEM_DEFAULT_BITGET_KEY,
      bitgetSecret: SYSTEM_DEFAULT_BITGET_SECRET ? encryptVaultSecret(SYSTEM_DEFAULT_BITGET_SECRET) : "",
      bitgetPassphrase: SYSTEM_DEFAULT_BITGET_PASSPHRASE ? encryptVaultSecret(SYSTEM_DEFAULT_BITGET_PASSPHRASE) : "",
      bitgetEnv: "demo",
      coindcxKey: SYSTEM_DEFAULT_COINDCX_KEY,
      coindcxSecret: SYSTEM_DEFAULT_COINDCX_SECRET ? encryptVaultSecret(SYSTEM_DEFAULT_COINDCX_SECRET) : "",
      bybitKey: SYSTEM_DEFAULT_BYBIT_KEY,
      bybitSecret: SYSTEM_DEFAULT_BYBIT_SECRET ? encryptVaultSecret(SYSTEM_DEFAULT_BYBIT_SECRET) : "",
    },
  };
}

export function loadUsers(): UserAccount[] {
  if (globalForUsers.userAccounts && globalForUsers.userAccounts.length > 0) {
    return globalForUsers.userAccounts;
  }

  try {
    const parsed = readDataFile<any[]>(USERS_FILE_NAME, []);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Ensure admin user exists with current credentials
      const hasAdmin = parsed.some(
        (u) => u.email?.toLowerCase() === ADMIN_EMAIL_PRIMARY || u.email?.toLowerCase() === ADMIN_EMAIL_ALIAS
      );
      if (!hasAdmin) {
        parsed.unshift(getSeedAdminUser());
      } else {
        // Always ensure admin role and secure hashed password
        const adminIdx = parsed.findIndex(
          (u) => u.email?.toLowerCase() === ADMIN_EMAIL_PRIMARY || u.email?.toLowerCase() === ADMIN_EMAIL_ALIAS
        );
        if (adminIdx >= 0) {
          if (ADMIN_DEFAULT_PASSWORD && (!parsed[adminIdx].password || !verifyPassword(ADMIN_DEFAULT_PASSWORD, parsed[adminIdx].password))) {
            parsed[adminIdx].password = hashPassword(ADMIN_DEFAULT_PASSWORD);
          }
          parsed[adminIdx].role = "admin";
          if (!parsed[adminIdx].apiKeys) {
            parsed[adminIdx].apiKeys = getSeedAdminUser().apiKeys;
          } else {

            if (parsed[adminIdx].apiKeys.binanceEndpoint === "https://demo-fapi.binance.com") {
              parsed[adminIdx].apiKeys.binanceEndpoint = "https://testnet.binancefuture.com";
            }
          }
        }
      }

      // Auto-populate default system keys so admin never needs to enter them manually
      for (const u of parsed) {
        const isAdmin = u.role === "admin" || u.id === "usr_admin_varsha" || u.email?.toLowerCase() === ADMIN_EMAIL_PRIMARY || u.email?.toLowerCase() === ADMIN_EMAIL_ALIAS;
        if (isAdmin) {
          u.role = "admin";
          if (!u.apiKeys) {
            u.apiKeys = getSeedAdminUser().apiKeys;
          } else {
            if ((!u.apiKeys.binanceKey || u.apiKeys.binanceKey.trim() === "") && SYSTEM_DEFAULT_BINANCE_KEY) {
              u.apiKeys.binanceKey = SYSTEM_DEFAULT_BINANCE_KEY;
            }
            if ((!u.apiKeys.binanceSecret || u.apiKeys.binanceSecret.trim() === "") && SYSTEM_DEFAULT_BINANCE_SECRET) {
              u.apiKeys.binanceSecret = encryptVaultSecret(SYSTEM_DEFAULT_BINANCE_SECRET);
            }
            if (!u.apiKeys.binanceEndpoint || u.apiKeys.binanceEndpoint === "https://demo-fapi.binance.com") {
              u.apiKeys.binanceEndpoint = "https://fapi.binance.com";
            }
            if ((!u.apiKeys.bybitKey || u.apiKeys.bybitKey.trim() === "") && SYSTEM_DEFAULT_BYBIT_KEY) {
              u.apiKeys.bybitKey = SYSTEM_DEFAULT_BYBIT_KEY;
            }
            if ((!u.apiKeys.bybitSecret || u.apiKeys.bybitSecret.trim() === "") && SYSTEM_DEFAULT_BYBIT_SECRET) {
              u.apiKeys.bybitSecret = encryptVaultSecret(SYSTEM_DEFAULT_BYBIT_SECRET);
            }
            if ((!u.apiKeys.bitgetKey || u.apiKeys.bitgetKey.trim() === "") && SYSTEM_DEFAULT_BITGET_KEY) {
              u.apiKeys.bitgetKey = SYSTEM_DEFAULT_BITGET_KEY;
            }
            if ((!u.apiKeys.bitgetSecret || u.apiKeys.bitgetSecret.trim() === "") && SYSTEM_DEFAULT_BITGET_SECRET) {
              u.apiKeys.bitgetSecret = encryptVaultSecret(SYSTEM_DEFAULT_BITGET_SECRET);
            }
            if ((!u.apiKeys.bitgetPassphrase || u.apiKeys.bitgetPassphrase.trim() === "") && SYSTEM_DEFAULT_BITGET_PASSPHRASE) {
              u.apiKeys.bitgetPassphrase = encryptVaultSecret(SYSTEM_DEFAULT_BITGET_PASSPHRASE);
            }
            if ((!u.apiKeys.coindcxKey || u.apiKeys.coindcxKey.trim() === "") && SYSTEM_DEFAULT_COINDCX_KEY) {
              u.apiKeys.coindcxKey = SYSTEM_DEFAULT_COINDCX_KEY;
            }
            if ((!u.apiKeys.coindcxSecret || u.apiKeys.coindcxSecret.trim() === "") && SYSTEM_DEFAULT_COINDCX_SECRET) {
              u.apiKeys.coindcxSecret = encryptVaultSecret(SYSTEM_DEFAULT_COINDCX_SECRET);
            }
          }
        }
      }

      // Upgrade any legacy plaintext passwords to scrypt hashes & re-encrypt secrets
      for (const u of parsed) {
        if (u.password && !u.password.startsWith("scrypt:")) {
          u.password = hashPassword(u.password);
        }
        if (u.apiKeys) {
          if (u.apiKeys.binanceSecret) u.apiKeys.binanceSecret = encryptVaultSecret(u.apiKeys.binanceSecret);
          if (u.apiKeys.bitgetSecret) u.apiKeys.bitgetSecret = encryptVaultSecret(u.apiKeys.bitgetSecret);
          if (u.apiKeys.bitgetPassphrase) u.apiKeys.bitgetPassphrase = encryptVaultSecret(u.apiKeys.bitgetPassphrase);
          if (u.apiKeys.coindcxSecret) u.apiKeys.coindcxSecret = encryptVaultSecret(u.apiKeys.coindcxSecret);
          if (u.apiKeys.bybitSecret) u.apiKeys.bybitSecret = encryptVaultSecret(u.apiKeys.bybitSecret);
        }
      }

      globalForUsers.userAccounts = parsed;
      saveUsers(parsed);
      return parsed;
    }
  } catch {}

  const initial = [getSeedAdminUser()];
  globalForUsers.userAccounts = initial;
  saveUsers(initial);
  return initial;
}

export function saveUsers(users: UserAccount[]): void {
  globalForUsers.userAccounts = users;
  const diskCopy = JSON.parse(JSON.stringify(users));
  // Invariant 12: Admin keys must NEVER be wiped or emptied on disk. Persist encrypted credentials cleanly.
  saveDataFile(USERS_FILE_NAME, diskCopy);
}

export function getAllActiveUsers(): UserAccount[] {
  return loadUsers();
}

/**
 * Returns plain-text decrypted keys for execution in trading engine
 */
export function getDecryptedUserApiKeys(user: UserAccount | null | undefined): UserApiKeys {
  if (!user || !user.apiKeys) {
    return {
      binanceKey: "",
      binanceSecret: "",
      binanceEndpoint: "https://fapi.binance.com",
      bitgetKey: "",
      bitgetSecret: "",
      bitgetPassphrase: "",
      bitgetEnv: "demo",
      coindcxKey: "",
      coindcxSecret: "",
      bybitKey: "",
      bybitSecret: "",
    };
  }

  // Admin account fallback to system default if keys not explicitly populated
  if (user.role === "admin") {
    const bKey = user.apiKeys.binanceKey || SYSTEM_DEFAULT_BINANCE_KEY;
    const bSec = user.apiKeys.binanceSecret
      ? decryptVaultSecret(user.apiKeys.binanceSecret)
      : SYSTEM_DEFAULT_BINANCE_SECRET;
    const bgKey = user.apiKeys.bitgetKey || SYSTEM_DEFAULT_BITGET_KEY;
    const bgSec = user.apiKeys.bitgetSecret
      ? decryptVaultSecret(user.apiKeys.bitgetSecret)
      : SYSTEM_DEFAULT_BITGET_SECRET;
    const bgPass = user.apiKeys.bitgetPassphrase
      ? decryptVaultSecret(user.apiKeys.bitgetPassphrase)
      : SYSTEM_DEFAULT_BITGET_PASSPHRASE;
    const cdxKey = user.apiKeys.coindcxKey || SYSTEM_DEFAULT_COINDCX_KEY;
    const cdxSec = user.apiKeys.coindcxSecret
      ? decryptVaultSecret(user.apiKeys.coindcxSecret)
      : SYSTEM_DEFAULT_COINDCX_SECRET;
    const bybitKey = user.apiKeys.bybitKey || SYSTEM_DEFAULT_BYBIT_KEY;
    const bybitSec = user.apiKeys.bybitSecret
      ? decryptVaultSecret(user.apiKeys.bybitSecret)
      : SYSTEM_DEFAULT_BYBIT_SECRET;

    return {
      binanceKey: bKey,
      binanceSecret: bSec,
      binanceEndpoint: user.apiKeys.binanceEndpoint || "https://fapi.binance.com",
      bitgetKey: bgKey,
      bitgetSecret: bgSec,
      bitgetPassphrase: bgPass,
      bitgetEnv: user.apiKeys.bitgetEnv || "demo",
      coindcxKey: cdxKey,
      coindcxSecret: cdxSec,
      bybitKey,
      bybitSecret: bybitSec,
    };
  }

  return {
    binanceKey: user.apiKeys.binanceKey || "",
    binanceSecret: decryptVaultSecret(user.apiKeys.binanceSecret || ""),
    binanceEndpoint: user.apiKeys.binanceEndpoint || "https://testnet.binancefuture.com",
    bitgetKey: user.apiKeys.bitgetKey || "",
    bitgetSecret: decryptVaultSecret(user.apiKeys.bitgetSecret || ""),
    bitgetPassphrase: decryptVaultSecret(user.apiKeys.bitgetPassphrase || ""),
    bitgetEnv: user.apiKeys.bitgetEnv || "demo",
    coindcxKey: user.apiKeys.coindcxKey || "",
    coindcxSecret: decryptVaultSecret(user.apiKeys.coindcxSecret || ""),
    bybitKey: user.apiKeys.bybitKey || "",
    bybitSecret: decryptVaultSecret(user.apiKeys.bybitSecret || ""),
  };
}

/**
 * Returns safe masked keys for browser UI rendering
 */
export function getMaskedUserApiKeys(user: UserAccount | null | undefined): UserApiKeys {
  if (!user || !user.apiKeys) {
    return {
      binanceKey: "",
      binanceSecret: "",
      binanceEndpoint: "https://fapi.binance.com",
      bitgetKey: "",
      bitgetSecret: "",
      bitgetPassphrase: "",
      bitgetEnv: "demo",
      coindcxKey: "",
      coindcxSecret: "",
      bybitKey: "",
      bybitSecret: "",
      bybitProxy: "",
      bybitBaseUrl: "",
      bybitBackupProxy: "",
      bybitBackupBaseUrl: "",
    };
  }

  const raw = user.apiKeys;
  const isAdmin = user.role === "admin";
  const bKey = raw.binanceKey || (isAdmin ? SYSTEM_DEFAULT_BINANCE_KEY : "");
  const bSec = raw.binanceSecret || (isAdmin ? SYSTEM_DEFAULT_BINANCE_SECRET : "");
  const bgKey = raw.bitgetKey || (isAdmin ? SYSTEM_DEFAULT_BITGET_KEY : "");
  const bgSec = raw.bitgetSecret || (isAdmin ? SYSTEM_DEFAULT_BITGET_SECRET : "");
  const bgPass = raw.bitgetPassphrase || (isAdmin ? SYSTEM_DEFAULT_BITGET_PASSPHRASE : "");
  const cdxKey = raw.coindcxKey || (isAdmin ? SYSTEM_DEFAULT_COINDCX_KEY : "");
  const cdxSec = raw.coindcxSecret || (isAdmin ? SYSTEM_DEFAULT_COINDCX_SECRET : "");
  const bybitKey = raw.bybitKey || (isAdmin ? SYSTEM_DEFAULT_BYBIT_KEY : "");
  const bybitSec = raw.bybitSecret || (isAdmin ? SYSTEM_DEFAULT_BYBIT_SECRET : "");

  return {
    binanceKey: bKey ? (bKey.length >= 8 ? `${bKey.slice(0, 4)}••••${bKey.slice(-4)}` : "••••••••") : "",
    binanceSecret: bSec ? "••••••••••••••••" : "",
    binanceEndpoint: raw.binanceEndpoint || (isAdmin ? "https://fapi.binance.com" : "https://testnet.binancefuture.com"),
    bitgetKey: bgKey ? (bgKey.length >= 8 ? `${bgKey.slice(0, 4)}••••${bgKey.slice(-4)}` : "••••••••") : "",
    bitgetSecret: bgSec ? "••••••••••••••••" : "",
    bitgetPassphrase: bgPass ? "••••••••" : "",
    bitgetEnv: raw.bitgetEnv || "demo",
    coindcxKey: cdxKey ? (cdxKey.length >= 8 ? `${cdxKey.slice(0, 4)}••••${cdxKey.slice(-4)}` : "••••••••") : "",
    coindcxSecret: cdxSec ? "••••••••••••••••" : "",
    bybitKey: bybitKey ? (bybitKey.length >= 8 ? `${bybitKey.slice(0, 4)}••••${bybitKey.slice(-4)}` : "••••••••") : "",
    bybitSecret: bybitSec ? "••••••••••••••••" : "",
    bybitProxy: raw.bybitProxy || "",
    bybitBaseUrl: raw.bybitBaseUrl || "",
    bybitBackupProxy: raw.bybitBackupProxy || "",
    bybitBackupBaseUrl: raw.bybitBackupBaseUrl || "",
  };
}

export function findUserByEmail(email: string): UserAccount | undefined {
  const users = loadUsers();
  const normalized = (email || "").trim().toLowerCase();
  const isAdminAlias =
    normalized === "admin" ||
    normalized === "admin@hedge.local" ||
    normalized === ADMIN_EMAIL_PRIMARY ||
    normalized === ADMIN_EMAIL_ALIAS;

  return users.find((u) => {
    const e = u.email?.toLowerCase();
    if (e === normalized) return true;
    if (isAdminAlias && (e === ADMIN_EMAIL_PRIMARY || e === ADMIN_EMAIL_ALIAS || u.role === "admin")) {
      return true;
    }
    return false;
  });
}

export function findUserById(id: string): UserAccount | undefined {
  const users = loadUsers();
  return users.find((u) => u.id === id);
}

export function registerUser(email: string, password: string, username?: string): { success: boolean; user?: UserAccount; error?: string } {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized || !password) {
    return { success: false, error: "Email and password are required" };
  }

  const existing = findUserByEmail(normalized);
  if (existing) {
    return { success: false, error: "Account already exists with this email. Please sign in." };
  }

  const isAdmin = normalized === ADMIN_EMAIL_PRIMARY || normalized === ADMIN_EMAIL_ALIAS;
  const users = loadUsers();

  const newUser: UserAccount = {
    id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    email: normalized,
    username: username && username.trim() !== "" ? username.trim() : normalized.split("@")[0],
    password: hashPassword(password),
    role: isAdmin ? "admin" : "user",
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    apiKeys: isAdmin
      ? {
          binanceKey: SYSTEM_DEFAULT_BINANCE_KEY,
          binanceSecret: encryptVaultSecret(SYSTEM_DEFAULT_BINANCE_SECRET),
          binanceEndpoint: "https://fapi.binance.com",
          bitgetKey: SYSTEM_DEFAULT_BITGET_KEY,
          bitgetSecret: encryptVaultSecret(SYSTEM_DEFAULT_BITGET_SECRET),
          bitgetPassphrase: encryptVaultSecret(SYSTEM_DEFAULT_BITGET_PASSPHRASE),
          bitgetEnv: "demo",
          coindcxKey: SYSTEM_DEFAULT_COINDCX_KEY,
          coindcxSecret: SYSTEM_DEFAULT_COINDCX_SECRET ? encryptVaultSecret(SYSTEM_DEFAULT_COINDCX_SECRET) : "",
        }
      : {
          binanceKey: "",
          binanceSecret: "",
          binanceEndpoint: "https://fapi.binance.com",
          bitgetKey: "",
          bitgetSecret: "",
          bitgetPassphrase: "",
          bitgetEnv: "demo",
          coindcxKey: "",
          coindcxSecret: "",
        },
  };

  users.push(newUser);
  saveUsers(users);
  return { success: true, user: newUser };
}

export function authenticateUser(email: string, password: string): { success: boolean; user?: UserAccount; error?: string } {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized || !password) {
    return { success: false, error: "Email and password are required" };
  }

  const users = loadUsers();
  const user = findUserByEmail(normalized);

  if (!user) {
    return { success: false, error: "Invalid credentials. Please register or verify email/password." };
  }

  // Validate password securely using scrypt cryptographic derivation
  if (!verifyPassword(password, user.password)) {
    return { success: false, error: "Incorrect password. Please try again." };
  }

  // Automatically upgrade legacy plaintext passwords to scrypt on successful authentication
  if (!user.password.startsWith("scrypt:")) {
    user.password = hashPassword(password);
  }

  user.lastLogin = new Date().toISOString();
  saveUsers(users);
  return { success: true, user };
}

export function updateUserApiKeys(userId: string, apiKeys: Partial<UserApiKeys>): { success: boolean; user?: UserAccount; error?: string } {
  const users = loadUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) {
    return { success: false, error: "User not found" };
  }

  const existing = user.apiKeys || {
    binanceKey: "",
    binanceSecret: "",
    binanceEndpoint: "https://fapi.binance.com",
    bitgetKey: "",
    bitgetSecret: "",
    bitgetPassphrase: "",
    bitgetEnv: "demo",
    coindcxKey: "",
    coindcxSecret: "",
    bybitKey: "",
    bybitSecret: "",
  };

  // Encrypt secrets before storing on disk (reset to empty string if passed empty)
  const bSec = apiKeys.binanceSecret !== undefined && !isMaskedSecret(apiKeys.binanceSecret)
    ? (apiKeys.binanceSecret.trim() !== "" ? encryptVaultSecret(apiKeys.binanceSecret.trim()) : "")
    : existing.binanceSecret;

  const bgSec = apiKeys.bitgetSecret !== undefined && !isMaskedSecret(apiKeys.bitgetSecret)
    ? (apiKeys.bitgetSecret.trim() !== "" ? encryptVaultSecret(apiKeys.bitgetSecret.trim()) : "")
    : existing.bitgetSecret;

  const bgPass = apiKeys.bitgetPassphrase !== undefined && !isMaskedSecret(apiKeys.bitgetPassphrase)
    ? (apiKeys.bitgetPassphrase.trim() !== "" ? encryptVaultSecret(apiKeys.bitgetPassphrase.trim()) : "")
    : existing.bitgetPassphrase;

  const cdxSec = apiKeys.coindcxSecret !== undefined && !isMaskedSecret(apiKeys.coindcxSecret)
    ? (apiKeys.coindcxSecret.trim() !== "" ? encryptVaultSecret(apiKeys.coindcxSecret.trim()) : "")
    : existing.coindcxSecret;

  const bybitSec = apiKeys.bybitSecret !== undefined && !isMaskedSecret(apiKeys.bybitSecret)
    ? (apiKeys.bybitSecret.trim() !== "" ? encryptVaultSecret(apiKeys.bybitSecret.trim()) : "")
    : existing.bybitSecret;

  user.apiKeys = {
    ...existing,
    ...(apiKeys.binanceKey !== undefined ? { binanceKey: apiKeys.binanceKey.trim() } : {}),
    binanceSecret: bSec,
    ...(apiKeys.binanceEndpoint ? { binanceEndpoint: apiKeys.binanceEndpoint.trim() } : {}),
    ...(apiKeys.bitgetKey !== undefined ? { bitgetKey: apiKeys.bitgetKey.trim() } : {}),
    bitgetSecret: bgSec,
    bitgetPassphrase: bgPass,
    ...(apiKeys.bitgetEnv ? { bitgetEnv: apiKeys.bitgetEnv.trim() } : {}),
    ...(apiKeys.coindcxKey !== undefined ? { coindcxKey: apiKeys.coindcxKey.trim() } : {}),
    coindcxSecret: cdxSec,
    ...(apiKeys.bybitKey !== undefined ? { bybitKey: apiKeys.bybitKey.trim() } : {}),
    bybitSecret: bybitSec,
    ...(apiKeys.bybitProxy !== undefined ? { bybitProxy: apiKeys.bybitProxy.trim() } : {}),
    ...(apiKeys.bybitBaseUrl !== undefined ? { bybitBaseUrl: apiKeys.bybitBaseUrl.trim() } : {}),
    ...(apiKeys.bybitBackupProxy !== undefined ? { bybitBackupProxy: apiKeys.bybitBackupProxy.trim() } : {}),
    ...(apiKeys.bybitBackupBaseUrl !== undefined ? { bybitBackupBaseUrl: apiKeys.bybitBackupBaseUrl.trim() } : {}),
  };

  const isAdmin = user.role === "admin" || user.id === "usr_admin_varsha";
  if (isAdmin) {
    if (!user.apiKeys.binanceKey && SYSTEM_DEFAULT_BINANCE_KEY) user.apiKeys.binanceKey = SYSTEM_DEFAULT_BINANCE_KEY;
    if (!user.apiKeys.binanceSecret && SYSTEM_DEFAULT_BINANCE_SECRET) user.apiKeys.binanceSecret = encryptVaultSecret(SYSTEM_DEFAULT_BINANCE_SECRET);
    if (!user.apiKeys.bybitKey && SYSTEM_DEFAULT_BYBIT_KEY) user.apiKeys.bybitKey = SYSTEM_DEFAULT_BYBIT_KEY;
    if (!user.apiKeys.bybitSecret && SYSTEM_DEFAULT_BYBIT_SECRET) user.apiKeys.bybitSecret = encryptVaultSecret(SYSTEM_DEFAULT_BYBIT_SECRET);
    if (!user.apiKeys.bitgetKey && SYSTEM_DEFAULT_BITGET_KEY) user.apiKeys.bitgetKey = SYSTEM_DEFAULT_BITGET_KEY;
    if (!user.apiKeys.bitgetSecret && SYSTEM_DEFAULT_BITGET_SECRET) user.apiKeys.bitgetSecret = encryptVaultSecret(SYSTEM_DEFAULT_BITGET_SECRET);
    if (!user.apiKeys.bitgetPassphrase && SYSTEM_DEFAULT_BITGET_PASSPHRASE) user.apiKeys.bitgetPassphrase = encryptVaultSecret(SYSTEM_DEFAULT_BITGET_PASSPHRASE);
    if (!user.apiKeys.coindcxKey && SYSTEM_DEFAULT_COINDCX_KEY) user.apiKeys.coindcxKey = SYSTEM_DEFAULT_COINDCX_KEY;
    if (!user.apiKeys.coindcxSecret && SYSTEM_DEFAULT_COINDCX_SECRET) user.apiKeys.coindcxSecret = encryptVaultSecret(SYSTEM_DEFAULT_COINDCX_SECRET);
  }

  saveUsers(users);
  return { success: true, user };
}

/**
 * Permanently purge a user's API vault keys (e.g. upon consent withdrawal)
 */
export function purgeUserApiKeys(userIdOrEmail: string): { success: boolean; user?: UserAccount; error?: string } {
  const users = loadUsers();
  const normalized = (userIdOrEmail || "").trim().toLowerCase();
  const user = users.find((u) => u.id === userIdOrEmail || u.email?.toLowerCase() === normalized);
  if (!user) {
    return { success: false, error: "User not found" };
  }

  user.apiKeys = {
    binanceKey: "",
    binanceSecret: "",
    binanceEndpoint: "https://fapi.binance.com",
    bitgetKey: "",
    bitgetSecret: "",
    bitgetPassphrase: "",
    bitgetEnv: "demo",
    coindcxKey: "",
    coindcxSecret: "",
    bybitKey: "",
    bybitSecret: "",
    bybitProxy: "",
    bybitBaseUrl: "",
    bybitBackupProxy: "",
    bybitBackupBaseUrl: "",
  };

  saveUsers(users);
  return { success: true, user };
}

/**
 * Permanently delete a user account and purge all associated tenant storage directories
 * (Statutory Right to Erasure / Forgotten under Section 12(2) DPDP Act 2023)
 */
export function deleteUserAccount(userIdOrEmail: string): { success: boolean; error?: string; erasedUserId?: string } {
  const users = loadUsers();
  const normalized = (userIdOrEmail || "").trim().toLowerCase();
  const idx = users.findIndex((u) => u.id === userIdOrEmail || u.email?.toLowerCase() === normalized);
  if (idx < 0) {
    return { success: false, error: "User not found" };
  }

  const target = users[idx];

  // Protect system admin account structure, but wipe custom keys if requested
  if (target.email?.toLowerCase() === ADMIN_EMAIL_PRIMARY || target.email?.toLowerCase() === ADMIN_EMAIL_ALIAS) {
    target.apiKeys = getSeedAdminUser().apiKeys;
    saveUsers(users);
    return { success: true, erasedUserId: target.id };
  }

  // Remove user record from user accounts store
  users.splice(idx, 1);
  saveUsers(users);

  // Permanently purge tenant data directory (trades, wallet, bot presets)
  try {
    const dataDir = resolveDataDir();
    const userDir = path.join(dataDir, "users", target.id);
    if (fs.existsSync(userDir)) {
      fs.rmSync(userDir, { recursive: true, force: true });
    }
  } catch (err: any) {
    console.warn(`[USER_STORE] Error deleting user directory for ${target.id}:`, err.message);
  }

  return { success: true, erasedUserId: target.id };
}

export function isUserAdminRole(userOrEmail?: UserAccount | string | null): boolean {
  if (!userOrEmail) return false;
  if (typeof userOrEmail === "object") {
    return userOrEmail.role === "admin";
  }
  const emailNorm = userOrEmail.trim().toLowerCase();
  return emailNorm === ADMIN_EMAIL_PRIMARY || emailNorm === ADMIN_EMAIL_ALIAS;
}

/**
 * Extract authenticated user from cryptographically signed session cookie
 */
export function getAuthenticatedUser(req: any): UserAccount | null {
  try {
    let cookieHeader = "";

    if (req?.headers) {
      if (typeof req.headers.get === "function") {
        cookieHeader = req.headers.get("cookie") || "";
      } else if (typeof req.headers === "object") {
        cookieHeader = req.headers["cookie"] || req.headers["Cookie"] || "";
      }
    }

    if (!cookieHeader) return null;

    const authCookie = cookieHeader
      .split(";")
      .map((c: string) => c.trim())
      .find((c: string) => c.startsWith("auth_session="));

    if (!authCookie) return null;

    const rawVal = decodeURIComponent(authCookie.replace("auth_session=", "").trim());
    if (!rawVal) return null;

    // Verify cryptographic signature on session token (or backwards-compatible fallback)
    const verifiedUserId = verifySessionToken(rawVal);
    if (verifiedUserId) {
      return findUserById(verifiedUserId) || null;
    }

    return null;
  } catch {
    return null;
  }
}
