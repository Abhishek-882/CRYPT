import crypto from "crypto";

/**
 * Enterprise At-Rest AES-256-GCM Encryption Vault
 * Enforces environment-variable-only credential injection via COCKPIT_VAULT_KEY.
 * Ensures zero plaintext API secrets on disk.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = "enc:v1:";

// Master Secret Key Management
let cachedMasterKey: Buffer | null = null;
let cachedMasterKeyHex: string | null = null;

/**
 * Retrieve and validate COCKPIT_VAULT_KEY environment variable.
 * Must be a 64-hex-character string (representing a 32-byte / 256-bit AES key).
 * Fails fast with descriptive error if missing or invalid.
 */
export function getCockpitVaultKey(): string {
  const vaultKey = process.env.COCKPIT_VAULT_KEY;
  if (!vaultKey || typeof vaultKey !== "string" || !/^[0-9a-fA-F]{64}$/.test(vaultKey.trim())) {
    throw new Error(
      "[VAULT CRITICAL] Missing or invalid COCKPIT_VAULT_KEY environment variable. A 64-hex-character string (32-byte AES key) is required. Refusing startup."
    );
  }
  return vaultKey.trim();
}

export function getMasterKey(): Buffer {
  const hexKey = getCockpitVaultKey();
  if (cachedMasterKey && cachedMasterKeyHex === hexKey) {
    return cachedMasterKey;
  }
  cachedMasterKeyHex = hexKey;
  cachedMasterKey = Buffer.from(hexKey, "hex");
  return cachedMasterKey;
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 */
export function encryptVaultSecret(plainText: string): string {
  if (!plainText || typeof plainText !== "string") {
    return "";
  }

  const trimmed = plainText.trim();
  if (trimmed === "" || trimmed.startsWith(ENCRYPTED_PREFIX)) {
    return plainText; // Already encrypted or empty
  }

  // Do not encrypt masked previews
  if (trimmed.startsWith("•••") || trimmed.includes("••••")) {
    return plainText;
  }

  try {
    const key = getMasterKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${ENCRYPTED_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
  } catch (err: any) {
    console.error("[VAULT CRITICAL] Encryption failure (failing closed to prevent plaintext leak):", err.message);
    throw new Error(`Vault encryption failed: Refusing to persist unencrypted credentials (${err.message})`);
  }
}

/**
 * Decrypt an AES-256-GCM encrypted string back to plaintext
 */
export function decryptVaultSecret(cipherText: string): string {
  if (!cipherText || typeof cipherText !== "string") {
    return "";
  }

  const trimmed = cipherText.trim();
  if (!trimmed.startsWith(ENCRYPTED_PREFIX)) {
    return plainTextSanitized(trimmed); // Unencrypted legacy plaintext
  }

  try {
    const parts = trimmed.substring(ENCRYPTED_PREFIX.length).split(":");
    if (parts.length !== 3) {
      return plainTextSanitized(trimmed);
    }

    const [ivHex, tagHex, dataHex] = parts;
    const key = getMasterKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const data = Buffer.from(dataHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (err: any) {
    console.warn("[VAULT] Decryption failed or invalid key:", err.message);
    return "";
  }
}

function plainTextSanitized(val: string): string {
  return val.trim();
}

/**
 * Mask an API key or secret for secure UI display
 */
export function maskVaultKey(key: string | undefined): string {
  if (!key) return "";
  const decrypted = decryptVaultSecret(key);
  if (!decrypted || decrypted.trim() === "") return "";
  if (decrypted.length <= 8) return "••••••••";
  return `${decrypted.slice(0, 4)}••••••••${decrypted.slice(-4)}`;
}

/**
 * Check if a string is a masked UI placeholder
 */
export function isMaskedSecret(val: string | undefined): boolean {
  if (!val) return true;
  const trimmed = val.trim();
  return trimmed === "" || trimmed.startsWith("•••") || trimmed.includes("••••");
}
