/**
 * Vitest Unit Tests: Asymmetric Funding Configuration & Daemon Atomic Persistence
 * 
 * Verifies Milestone 2 (R3):
 * 1. Roundtrip .set serialization and deserialization with intervalMode and allowedIntervalPairs.
 * 2. Daemon atomic disk persistence, legacy fallback, and refresh recovery.
 * 3. 1-Click toggle action state transitions (/api/bot/daemon toggle_asymmetric_funding & update_config).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import {
  serializeConfigToSetText,
  parseSetTextToConfig,
  DEFAULT_CONFIG,
  BotConfig,
  FundingIntervalMode,
  saveBotState,
  loadBotState,
  BotEngineState,
  BotInstance,
} from "../../lib/botEngine";
import { POST } from "../../app/api/bot/daemon/route";
import { createSessionToken, loadUsers } from "../../lib/userStore";

describe("Milestone 2 (R3): Asymmetric Funding Config Persistence & Daemon Synchronization", () => {
  const TEST_USER = "usr_unit_test_persist_m2";
  let authCookie = "";

  beforeAll(() => {
    if (!process.env.COCKPIT_VAULT_KEY || process.env.COCKPIT_VAULT_KEY.length !== 64) {
      process.env.COCKPIT_VAULT_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    }
    const users = loadUsers();
    const adminUser = users.find((u) => u.role === "admin") || users[0];
    const sessionToken = createSessionToken(adminUser.id);
    authCookie = `auth_session=${sessionToken}`;
  });

  const createCleanState = (botConfig?: Partial<BotConfig>): BotEngineState => {
    const config: BotConfig = {
      ...DEFAULT_CONFIG,
      ...botConfig,
    };
    const bot: BotInstance = {
      id: "bot_persist_test",
      name: "Persistence Test Sniper",
      activeSetFileName: "test_preset.set",
      enabled: true,
      maxMarginCapUsdt: 500,
      config,
      flattenedCoinsBlacklist: [],
      symbolCooldowns: {},
      activeHedges: [],
      completedHedges: [],
      logs: [],
      statusText: "RUNNING_24_7",
      lastEvaluatedCandidate: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return {
      isRunning: true,
      runInBackgroundWhenClosed: true,
      mode: "AUTONOMOUS_SERVER_24_7",
      startedAt: Date.now(),
      lastCycleAt: Date.now(),
      cyclesCompleted: 1,
      activeBotId: bot.id,
      bots: [bot],
      setFiles: [],
      logs: [],
      config,
      activeHedges: [],
      completedHedges: [],
      statusText: "RUNNING_24_7",
      lastEvaluatedCandidate: null,
    };
  };

  beforeEach(() => {
    const clean = createCleanState();
    saveBotState(clean, TEST_USER);
  });

  afterEach(() => {
    const clean = createCleanState();
    saveBotState(clean, TEST_USER);
  });

  // =========================================================================
  // SUITE 1: Roundtrip .set Serialization & Deserialization
  // =========================================================================
  describe("1. Roundtrip .set File Serialization & Deserialization", () => {
    it("serializes and deserializes Option 1: ALL_ASYMMETRIC cleanly", () => {
      const config: BotConfig = {
        ...DEFAULT_CONFIG,
        intervalMode: "ALL_ASYMMETRIC",
        allowAsymmetricFunding: true,
        allowedIntervalPairs: ["1h_4h", "4h_8h", "1h_8h", "2h_4h", "2h_8h"],
      };

      const setText = serializeConfigToSetText(config, "Option1_Preset");

      // Verify serialization output format
      expect(setText).toContain("IntervalMode=ALL_ASYMMETRIC");
      expect(setText).toContain("AllowAsymmetricFunding=true");
      expect(setText).toContain("AllowedIntervalPairs=1h_4h,4h_8h,1h_8h,2h_4h,2h_8h");

      // Deserialization roundtrip
      const parsed = parseSetTextToConfig(setText);
      expect(parsed.intervalMode).toBe("ALL_ASYMMETRIC");
      expect(parsed.allowAsymmetricFunding).toBe(true);
      expect(parsed.allowedIntervalPairs).toEqual(["1h_4h", "4h_8h", "1h_8h", "2h_4h", "2h_8h"]);
    });

    it("serializes and deserializes Option 2: STRICT_SYNC_ONLY cleanly", () => {
      const config: BotConfig = {
        ...DEFAULT_CONFIG,
        intervalMode: "STRICT_SYNC_ONLY",
        allowAsymmetricFunding: false,
        allowedIntervalPairs: [],
      };

      const setText = serializeConfigToSetText(config, "Option2_StrictSync_Preset");

      expect(setText).toContain("IntervalMode=STRICT_SYNC_ONLY");
      expect(setText).toContain("AllowAsymmetricFunding=false");

      const parsed = parseSetTextToConfig(setText);
      expect(parsed.intervalMode).toBe("STRICT_SYNC_ONLY");
      expect(parsed.allowAsymmetricFunding).toBe(false);
      expect(parsed.allowedIntervalPairs).toEqual([]);
    });

    it("serializes and deserializes Option 3: CUSTOM Asymmetric with selected pairs", () => {
      const customPairs = ["1h_4h", "2h_8h"];
      const config: BotConfig = {
        ...DEFAULT_CONFIG,
        intervalMode: "CUSTOM",
        allowAsymmetricFunding: true,
        allowedIntervalPairs: customPairs,
      };

      const setText = serializeConfigToSetText(config, "Option3_Custom_Preset");

      expect(setText).toContain("IntervalMode=CUSTOM");
      expect(setText).toContain("AllowAsymmetricFunding=true");
      expect(setText).toContain("AllowedIntervalPairs=1h_4h,2h_8h");

      const parsed = parseSetTextToConfig(setText);
      expect(parsed.intervalMode).toBe("CUSTOM");
      expect(parsed.allowAsymmetricFunding).toBe(true);
      expect(parsed.allowedIntervalPairs).toEqual(["1h_4h", "2h_8h"]);
    });

    it("falls back gracefully when parsing legacy .set files missing IntervalMode", () => {
      // Legacy .set with AllowAsymmetricFunding=true
      const legacyAsymSet = [
        "Enabled=true",
        "MinSpreadBps=35.0",
        "AllowAsymmetricFunding=true",
      ].join("\n");

      const parsedAsym = parseSetTextToConfig(legacyAsymSet);
      expect(parsedAsym.allowAsymmetricFunding).toBe(true);
      expect(parsedAsym.intervalMode).toBe("ALL_ASYMMETRIC");

      // Legacy .set with AllowAsymmetricFunding=false
      const legacyStrictSet = [
        "Enabled=true",
        "MinSpreadBps=35.0",
        "AllowAsymmetricFunding=false",
      ].join("\n");

      const parsedStrict = parseSetTextToConfig(legacyStrictSet);
      expect(parsedStrict.allowAsymmetricFunding).toBe(false);
      expect(parsedStrict.intervalMode).toBe("STRICT_SYNC_ONLY");
    });

    it("handles case-insensitivity and aliases in .set parsing", () => {
      const aliasSet1 = "intervalmode=option2\nallowedintervalpairs=1H_4H, 4H_8H";
      const parsed1 = parseSetTextToConfig(aliasSet1);
      expect(parsed1.intervalMode).toBe("STRICT_SYNC_ONLY");
      expect(parsed1.allowAsymmetricFunding).toBe(false);

      const aliasSet2 = "intervalmode=strict\nallowasymmetricfunding=false";
      const parsed2 = parseSetTextToConfig(aliasSet2);
      expect(parsed2.intervalMode).toBe("STRICT_SYNC_ONLY");
      expect(parsed2.allowAsymmetricFunding).toBe(false);

      const aliasSet3 = "intervalmode=custom\nallowedintervalpairs=1H_4H, 2H_4H";
      const parsed3 = parseSetTextToConfig(aliasSet3);
      expect(parsed3.intervalMode).toBe("CUSTOM");
      expect(parsed3.allowAsymmetricFunding).toBe(true);
      expect(parsed3.allowedIntervalPairs).toEqual(["1h_4h", "2h_4h"]);
    });
  });

  // =========================================================================
  // SUITE 2: Daemon State Persistence & Reload Recovery
  // =========================================================================
  describe("2. Daemon State Persistence & Refresh Recovery", () => {
    it("atomically persists intervalMode and allowedIntervalPairs to disk and reloads on fresh disk read", () => {
      const stateToPersist = createCleanState({
        intervalMode: "CUSTOM",
        allowAsymmetricFunding: true,
        allowedIntervalPairs: ["4h_8h", "1h_8h"],
      });

      // Write to user isolated state
      saveBotState(stateToPersist, TEST_USER);

      // Force direct disk read (simulating browser page refresh / server cold start)
      const reloadedState = loadBotState(TEST_USER, true);
      const activeBot = reloadedState.bots.find((b) => b.id === reloadedState.activeBotId) || reloadedState.bots[0];

      expect(activeBot.config.intervalMode).toBe("CUSTOM");
      expect(activeBot.config.allowAsymmetricFunding).toBe(true);
      expect(activeBot.config.allowedIntervalPairs).toEqual(["4h_8h", "1h_8h"]);
    });

    it("correctly resolves fallback intervalMode when reading legacy bot state without intervalMode", () => {
      // Simulate state written by older bot versions where intervalMode was undefined
      const legacyState = createCleanState({
        allowAsymmetricFunding: false,
        intervalMode: undefined,
      });

      saveBotState(legacyState, TEST_USER);

      const reloaded = loadBotState(TEST_USER, true);
      const curBot = reloaded.bots.find((b) => b.id === reloaded.activeBotId) || reloaded.bots[0];

      // Re-enact UI fetchStatus deserialization resolution:
      const resolvedMode: FundingIntervalMode =
        curBot.config?.intervalMode ||
        (curBot.config?.allowAsymmetricFunding !== false ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY");

      expect(resolvedMode).toBe("STRICT_SYNC_ONLY");
    });

    it("correctly resolves fallback to ALL_ASYMMETRIC when allowAsymmetricFunding is true or undefined", () => {
      const legacyState = createCleanState({
        allowAsymmetricFunding: true,
        intervalMode: undefined,
      });

      saveBotState(legacyState, TEST_USER);

      const reloaded = loadBotState(TEST_USER, true);
      const curBot = reloaded.bots.find((b) => b.id === reloaded.activeBotId) || reloaded.bots[0];

      const resolvedMode: FundingIntervalMode =
        curBot.config?.intervalMode ||
        (curBot.config?.allowAsymmetricFunding !== false ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY");

      expect(resolvedMode).toBe("ALL_ASYMMETRIC");
    });
  });

  // =========================================================================
  // SUITE 3: 1-Click Toggle & Daemon API Action Handlers
  // =========================================================================
  describe("3. 1-Click Toggle Action & REST Endpoint State Transitions", () => {
    it("toggles 1-click from ALL_ASYMMETRIC to STRICT_SYNC_ONLY via toggle_asymmetric_funding", async () => {
      const req = new Request("http://localhost:3000/api/bot/daemon", {
        method: "POST",
        headers: {
          cookie: authCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "toggle_asymmetric_funding",
          intervalMode: "STRICT_SYNC_ONLY",
          allowAsymmetricFunding: false,
          enabled: false,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);

      const activeBot = json.daemon.bots.find((b: any) => b.id === json.daemon.activeBotId) || json.daemon.bots[0];
      expect(activeBot.config.intervalMode).toBe("STRICT_SYNC_ONLY");
      expect(activeBot.config.allowAsymmetricFunding).toBe(false);

      // Verify audit log entry was generated
      const lastLog = json.daemon.logs?.[0] || activeBot.logs?.[0];
      const allLogMessages = (json.daemon.logs || []).map((l: any) => l.message).join(" ");
      expect(allLogMessages).toContain("Option 2: STRICT SYNC ONLY");
    });

    it("toggles 1-click from STRICT_SYNC_ONLY to ALL_ASYMMETRIC via toggle_asymmetric_funding", async () => {
      // First put it in STRICT_SYNC_ONLY
      const setupReq = new Request("http://localhost:3000/api/bot/daemon", {
        method: "POST",
        headers: { cookie: authCookie, "content-type": "application/json" },
        body: JSON.stringify({
          action: "toggle_asymmetric_funding",
          intervalMode: "STRICT_SYNC_ONLY",
          enabled: false,
        }),
      });
      await POST(setupReq);

      // Toggle back to ALL_ASYMMETRIC
      const toggleReq = new Request("http://localhost:3000/api/bot/daemon", {
        method: "POST",
        headers: { cookie: authCookie, "content-type": "application/json" },
        body: JSON.stringify({
          action: "toggle_asymmetric_funding",
          intervalMode: "ALL_ASYMMETRIC",
          enabled: true,
          allowedIntervalPairs: ["1h_4h", "4h_8h", "1h_8h", "2h_4h", "2h_8h"],
        }),
      });

      const res = await POST(toggleReq);
      expect(res.status).toBe(200);

      const json = await res.json();
      const activeBot = json.daemon.bots.find((b: any) => b.id === json.daemon.activeBotId) || json.daemon.bots[0];
      expect(activeBot.config.intervalMode).toBe("ALL_ASYMMETRIC");
      expect(activeBot.config.allowAsymmetricFunding).toBe(true);
      expect(activeBot.config.allowedIntervalPairs).toHaveLength(5);
    });

    it("persists intervalMode and allowedIntervalPairs via update_config action", async () => {
      const updateReq = new Request("http://localhost:3000/api/bot/daemon", {
        method: "POST",
        headers: { cookie: authCookie, "content-type": "application/json" },
        body: JSON.stringify({
          action: "update_config",
          config: {
            intervalMode: "CUSTOM",
            allowedIntervalPairs: ["1h_4h", "2h_4h"],
            minSpreadBps: 40.0,
          },
        }),
      });

      const res = await POST(updateReq);
      expect(res.status).toBe(200);

      const json = await res.json();
      const activeBot = json.daemon.bots.find((b: any) => b.id === json.daemon.activeBotId) || json.daemon.bots[0];
      expect(activeBot.config.intervalMode).toBe("CUSTOM");
      expect(activeBot.config.allowAsymmetricFunding).toBe(true);
      expect(activeBot.config.allowedIntervalPairs).toEqual(["1h_4h", "2h_4h"]);
      expect(activeBot.config.minSpreadBps).toBe(40.0);
    });

    it("supports parameter-less toggle_asymmetric_funding toggling current active mode", async () => {
      // Setup as ALL_ASYMMETRIC
      const req1 = new Request("http://localhost:3000/api/bot/daemon", {
        method: "POST",
        headers: { cookie: authCookie, "content-type": "application/json" },
        body: JSON.stringify({ action: "toggle_asymmetric_funding", intervalMode: "ALL_ASYMMETRIC" }),
      });
      await POST(req1);

      // Call without parameters - should toggle to STRICT_SYNC_ONLY
      const reqToggle1 = new Request("http://localhost:3000/api/bot/daemon", {
        method: "POST",
        headers: { cookie: authCookie, "content-type": "application/json" },
        body: JSON.stringify({ action: "toggle_asymmetric_funding" }),
      });
      const resToggle1 = await POST(reqToggle1);
      const json1 = await resToggle1.json();
      const bot1 = json1.daemon.bots.find((b: any) => b.id === json1.daemon.activeBotId) || json1.daemon.bots[0];
      expect(bot1.config.intervalMode).toBe("STRICT_SYNC_ONLY");
      expect(bot1.config.allowAsymmetricFunding).toBe(false);

      // Call again without parameters - should toggle back to ALL_ASYMMETRIC
      const reqToggle2 = new Request("http://localhost:3000/api/bot/daemon", {
        method: "POST",
        headers: { cookie: authCookie, "content-type": "application/json" },
        body: JSON.stringify({ action: "toggle_asymmetric_funding" }),
      });
      const resToggle2 = await POST(reqToggle2);
      const json2 = await resToggle2.json();
      const bot2 = json2.daemon.bots.find((b: any) => b.id === json2.daemon.activeBotId) || json2.daemon.bots[0];
      expect(bot2.config.intervalMode).toBe("ALL_ASYMMETRIC");
      expect(bot2.config.allowAsymmetricFunding).toBe(true);
    });
  });
});
