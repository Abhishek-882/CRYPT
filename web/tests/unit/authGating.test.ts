/**
 * Vitest Unit Tests: Authentication & Vault Gating
 * 
 * Verifies Auth Gating & Crypto Vault:
 * - Session token issuance and verification
 * - Forged / expired session rejection
 * - Header spoofing defense (rejecting unauthenticated callers even if exchange headers provided)
 * - Role-based authorization (admin vs standard user)
 * - Fail-closed AES-256-GCM cryptoVault behavior
 */

import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { resolveCallerCredentials } from "@/lib/authHelper";
import {
  createSessionToken,
  verifySessionToken,
  findUserById,
  loadUsers,
  isUserAdminRole,
} from "@/lib/userStore";
import {
  encryptVaultSecret,
  decryptVaultSecret,
  getCockpitVaultKey,
} from "@/lib/cryptoVault";

describe("Auth & Vault Security Gating Engine", () => {
  beforeAll(() => {
    // Ensure 64-hex test vault key is present in environment
    if (!process.env.COCKPIT_VAULT_KEY || process.env.COCKPIT_VAULT_KEY.length !== 64) {
      process.env.COCKPIT_VAULT_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    }
  });

  describe("Session Token Security", () => {
    it("should issue and verify valid session tokens", () => {
      const users = loadUsers();
      expect(users.length).toBeGreaterThan(0);
      const testUser = users[0];

      const token = createSessionToken(testUser.id);
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(20);

      const verifiedId = verifySessionToken(token);
      expect(verifiedId).toBe(testUser.id);
    });

    it("should reject tampered or forged session tokens", () => {
      const users = loadUsers();
      const testUser = users[0];
      const validToken = createSessionToken(testUser.id);

      // Tamper signature or payload
      const parts = validToken.split(".");
      if (parts.length >= 2) {
        const forgedToken = `${parts[0]}.forgedsignature12345`;
        const result = verifySessionToken(forgedToken);
        expect(result).toBeNull();
      }
    });

    it("should reject garbage or empty session tokens", () => {
      expect(verifySessionToken("")).toBeNull();
      expect(verifySessionToken("not_a_real_token")).toBeNull();
      expect(verifySessionToken("null.undefined")).toBeNull();
    });
  });

  describe("Header Spoofing & Route Access Control", () => {
    it("should reject unauthenticated request even if exchange API keys are provided in headers", () => {
      // Attacker supplies x-binance-key without an auth_session cookie
      const req = new NextRequest("http://localhost:3000/api/order", {
        headers: {
          "x-binance-key": "fake_attacker_key",
          "x-binance-secret": "fake_attacker_secret",
        },
      });

      const resolved = resolveCallerCredentials(req);
      expect(resolved.authorized).toBe(false);
      expect(resolved.isAdmin).toBe(false);
      expect(resolved.binanceKey).toBe("");
      expect(resolved.binanceSecret).toBe("");
      expect(resolved.error).toContain("Authentication required");
    });

    it("should allow verified admin and resolve admin privileges", () => {
      const users = loadUsers();
      const admin = users.find((u) => u.role === "admin");
      expect(admin).toBeDefined();

      const adminToken = createSessionToken(admin!.id);
      const req = new NextRequest("http://localhost:3000/api/order", {
        headers: {
          cookie: `auth_session=${encodeURIComponent(adminToken)}`,
        },
      });

      const resolved = resolveCallerCredentials(req);
      expect(resolved.authorized).toBe(true);
      expect(resolved.isAdmin).toBe(true);
      expect(resolved.user?.id).toBe(admin!.id);
    });
  });

  describe("AES-256-GCM Vault Integrity", () => {
    it("should verify crypto vault is configured with valid 64-hex COCKPIT_VAULT_KEY", () => {
      const key = getCockpitVaultKey();
      expect(key.length).toBe(64);
      expect(/^[0-9a-fA-F]{64}$/.test(key)).toBe(true);
    });

    it("should successfully encrypt and decrypt secrets without corruption", () => {
      const plainSecret = "Institutional_Secret_ApiKey_987654321";
      const encrypted = encryptVaultSecret(plainSecret);

      expect(encrypted).not.toBe(plainSecret);
      expect(encrypted.startsWith("enc:v1:")).toBe(true);

      const decrypted = decryptVaultSecret(encrypted);
      expect(decrypted).toBe(plainSecret);
    });

    it("should return empty string and fail safely on tampered ciphertexts", () => {
      const plainSecret = "Test_Sensitive_Data";
      const encrypted = encryptVaultSecret(plainSecret);
      const tampered = encrypted.substring(0, encrypted.length - 4) + "XXXX";

      const decrypted = decryptVaultSecret(tampered);
      expect(decrypted).toBe("");
    });
  });
});
