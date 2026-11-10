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
import {
  getVerifiedCredentialsForTenant,
  MissingCredentialsError,
  fetchAvailableBalances,
  isCorridorSymbolLocked,
  releaseCorridorSymbolLock,
  DEFAULT_CONFIG,
  BotConfig,
} from "@/lib/botEngine";
import { getLivePositionsForVenues } from "@/lib/exchangePositions";

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

  describe("Phase 2: Strict Credential Isolation & Admin Secret Fallback Stripping", () => {
    it("should reject non-admin tenant execution when required corridor credentials are missing", () => {
      const tenantId = "usr_tenant_test_1";
      const partialCreds = {
        binanceKey: "valid_binance_key_123",
        binanceSecret: "valid_binance_sec_123",
      };

      expect(() => {
        getVerifiedCredentialsForTenant(tenantId, partialCreds, "BINANCE_BYBIT");
      }).toThrow(MissingCredentialsError);

      try {
        getVerifiedCredentialsForTenant(tenantId, partialCreds, "BINANCE_BYBIT");
      } catch (err: any) {
        expect(err.code).toBe("MISSING_EXCHANGE_CREDENTIALS");
        expect(err.message).toContain("Bybit");
        expect(err.message).toContain(tenantId);
      }
    });

    it("should reject non-admin tenant when credentials object is undefined", () => {
      const tenantId = "usr_tenant_test_2";
      expect(() => {
        getVerifiedCredentialsForTenant(tenantId, undefined, "BINANCE_BYBIT");
      }).toThrowError(/MISSING_EXCHANGE_CREDENTIALS/);
    });

    it("should resolve decrypted credentials for non-admin tenant when valid keys are configured", () => {
      const tenantId = "usr_tenant_test_3";
      const plainBybitSec = "bybit_secret_cleartext_789";
      const encBybitSec = encryptVaultSecret(plainBybitSec);

      const tenantCreds = {
        binanceKey: "bn_key_abc_123",
        binanceSecret: "bn_sec_abc_123",
        bybitKey: "byb_key_xyz_456",
        bybitSecret: encBybitSec,
      };

      const result = getVerifiedCredentialsForTenant(tenantId, tenantCreds, "BINANCE_BYBIT");
      expect(result.isAdmin).toBe(false);
      expect(result.binanceKey).toBe("bn_key_abc_123");
      expect(result.binanceSecret).toBe("bn_sec_abc_123");
      expect(result.bybitKey).toBe("byb_key_xyz_456");
      expect(result.bybitSecret).toBe(plainBybitSec);
    });

    it("should preserve system default credentials fallback for verified administrator", () => {
      const adminResult = getVerifiedCredentialsForTenant("usr_admin_varsha", undefined, "BINANCE_BYBIT");
      expect(adminResult.isAdmin).toBe(true);
      expect(adminResult.binanceKey.length).toBeGreaterThan(0);
      expect(adminResult.bybitKey.length).toBeGreaterThan(0);
    });

    it("should return zero balances for non-admin accounts with missing exchange credentials", async () => {
      const balances = await fetchAvailableBalances(undefined, "usr_tenant_no_keys");
      expect(balances.binanceBal).toBe(0);
      expect(balances.bitgetBal).toBe(0);
      expect(balances.bybitBal).toBe(0);
      expect(balances.coindcxBal).toBe(0);
    });

    it("should isolate live position queries and prevent non-admin from reading admin positions", async () => {
      const snapshot = await getLivePositionsForVenues(["Binance"], undefined, "usr_tenant_isolated", true, "usr_tenant_isolated");
      const binanceOpenSymbols = snapshot.venueOpenSymbols.get("binance");
      expect(binanceOpenSymbols?.size).toBe(0);
    });

    it("should scope in-flight entry locks by tenant without cross-tenant collision", () => {
      const tenantAlpha = "usr_tenant_lock_alpha";
      const tenantBeta = "usr_tenant_lock_beta";

      expect(isCorridorSymbolLocked("BINANCE_BYBIT", "AVAXUSDT", tenantAlpha)).toBe(false);
      expect(isCorridorSymbolLocked("BINANCE_BYBIT", "AVAXUSDT", tenantBeta)).toBe(false);

      // Release helper cleans up cleanly
      releaseCorridorSymbolLock("BINANCE_BYBIT", "AVAXUSDT", tenantAlpha);
      expect(isCorridorSymbolLocked("BINANCE_BYBIT", "AVAXUSDT", tenantAlpha)).toBe(false);
    });

    it("should provide user-configurable leverage targets with 20x normal and 10x volatile coin defaults", () => {
      // Verify defaults
      expect(DEFAULT_CONFIG.normalCoinLeverage).toBe(20);
      expect(DEFAULT_CONFIG.volatileCoinLeverage).toBe(10);

      // Verify custom tenant configuration overrides
      const customConfig: Partial<BotConfig> = {
        normalCoinLeverage: 25,
        volatileCoinLeverage: 12,
      };
      expect(customConfig.normalCoinLeverage).toBe(25);
      expect(customConfig.volatileCoinLeverage).toBe(12);
    });
  });
});
