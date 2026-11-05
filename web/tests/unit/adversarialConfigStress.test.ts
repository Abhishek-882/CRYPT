/**
 * Vitest Adversarial Test Harness: Milestone 2 Configuration Persistence & .set Recovery
 * 
 * EMPIRICAL CHALLENGER STRESS SUITE:
 * 1. Malformed, corrupt, legacy, and boundary .set files (unknown modes, missing keys, empty files, case insensitivity, key precedence).
 * 2. High-concurrency and rapid sequential updates/toggles verifying atomic persistence, zero partial JSON, and no orphaned temp files.
 * 3. Serialization and deserialization roundtrip fidelity across arbitrary and exotic custom interval pair permutations.
 * 4. Corrupted on-disk JSON recovery ensuring zero server crash on disk faults.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
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
  saveSetFile,
  loadSetFiles,
  applySetFileToBot,
  deleteSetFile,
} from "../../lib/botEngine";
import { POST } from "../../app/api/bot/daemon/route";
import { createSessionToken, loadUsers, saveUsers, UserAccount } from "../../lib/userStore";
import { resolveUserStoragePath } from "../../lib/storagePath";

describe("Adversarial Challenger: Milestone 2 Config Persistence & State Recovery Stress Harness", () => {
  const TEST_USER = "usr_adversarial_m2_stress";
  let authCookie = "";
  const createdPresetFileNames: string[] = [];

  beforeAll(() => {
    if (!process.env.COCKPIT_VAULT_KEY || process.env.COCKPIT_VAULT_KEY.length !== 64) {
      process.env.COCKPIT_VAULT_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    }

    // Register isolated tenant in user accounts store to avoid pollution of shared admin state
    const users = loadUsers();
    let testAdmin = users.find((u) => u.id === TEST_USER);
    if (!testAdmin) {
      testAdmin = {
        id: TEST_USER,
        email: "adversarial_m2@safecoiner.com",
        username: "AdversarialTesterM2",
        password: "hashed_dummy_password",
        role: "admin",
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        apiKeys: { ...users[0].apiKeys },
      };
      users.push(testAdmin);
      saveUsers(users);
    }

    const sessionToken = createSessionToken(TEST_USER);
    authCookie = `auth_session=${sessionToken}`;
  });

  const createCleanState = (botConfig?: Partial<BotConfig>): BotEngineState => {
    const config: BotConfig = {
      ...DEFAULT_CONFIG,
      ...botConfig,
    };
    const bot: BotInstance = {
      id: "bot_adv_test_1",
      name: "Adversarial Test Bot",
      activeSetFileName: "test_adversarial.set",
      enabled: true,
      maxMarginCapUsdt: 500,
      config,
      flattenedCoinsBlacklist: [],
      symbolCooldowns: {},
      activeHedges: [],
      completedHedges: [],
      logs: [],
      statusText: "READY",
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
      cyclesCompleted: 0,
      activeBotId: bot.id,
      bots: [bot],
      setFiles: [],
      logs: [],
      config,
      activeHedges: [],
      completedHedges: [],
      statusText: "READY",
      lastEvaluatedCandidate: null,
    };
  };

  beforeEach(() => {
    const clean = createCleanState();
    saveBotState(clean, TEST_USER);
  });

  afterEach(() => {
    // Clean up created set files
    for (const fileName of createdPresetFileNames) {
      try {
        deleteSetFile(fileName, TEST_USER);
      } catch {}
    }
    createdPresetFileNames.length = 0;
  });

  afterAll(() => {
    // 1. Remove isolated test user from store
    try {
      const users = loadUsers().filter((u) => u.id !== TEST_USER);
      saveUsers(users);
    } catch {}

    // 2. Complete cleanup of test user storage directory to avoid orphaned artifacts
    try {
      const userDir = path.dirname(resolveUserStoragePath(TEST_USER, "dummy.txt"));
      if (fs.existsSync(userDir)) {
        fs.rmSync(userDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // =========================================================================
  // SUITE 1: Malformed, Corrupt, Legacy & Boundary .set Files
  // =========================================================================
  describe("Suite 1: Malformed, Corrupt, Legacy & Boundary .set Files", () => {
    it("1.1 parses completely empty string (0 bytes) without crashing, preserving baseline config", () => {
      const parsed = parseSetTextToConfig("");
      expect(parsed).toBeDefined();
      expect(parsed.intervalMode).toBe("ALL_ASYMMETRIC");
      expect(parsed.allowAsymmetricFunding).toBe(true);
      expect(parsed.minSpreadBps).toBe(DEFAULT_CONFIG.minSpreadBps);
    });

    it("1.2 parses whitespace-only, comment-only, and blank lines without crashing", () => {
      const commentsOnly = `
        ; MetaTrader 5 Expert Configuration File
        # Another style of comment
        ; ==============================
        
        # End of comments
      `;
      const parsed = parseSetTextToConfig(commentsOnly);
      expect(parsed).toBeDefined();
      expect(parsed.intervalMode).toBe("ALL_ASYMMETRIC");
      expect(parsed.allowAsymmetricFunding).toBe(true);
    });

    it("1.3 ignores lines missing key-value delimiter ('=') and corrupted tokens", () => {
      const corruptedLines = [
        "Enabled=true",
        "CorruptedTokenWithoutEqualsSign",
        "IntervalMode=STRICT_SYNC_ONLY",
        "random_gibberish_12345!@#$",
        "AllowedIntervalPairs=1h_4h,4h_8h",
        "======",
        "=OnlyValue",
      ].join("\n");

      const parsed = parseSetTextToConfig(corruptedLines);
      expect(parsed.enabled).toBe(true);
      expect(parsed.intervalMode).toBe("STRICT_SYNC_ONLY");
      expect(parsed.allowAsymmetricFunding).toBe(false);
      expect(parsed.allowedIntervalPairs).toEqual(["1h_4h", "4h_8h"]);
    });

    it("1.4 handles empty values for interval keys gracefully", () => {
      const emptyValues = [
        "Enabled=true",
        "IntervalMode=",
        "AllowedIntervalPairs=",
        "AllowAsymmetricFunding=",
      ].join("\n");

      const parsed = parseSetTextToConfig(emptyValues);
      expect(parsed.enabled).toBe(true);
      expect(parsed.intervalMode).toBe("ALL_ASYMMETRIC");
      expect(parsed.allowedIntervalPairs).toEqual([]);
    });

    it("1.5 safely maps bizarre / unknown intervalMode strings to ALL_ASYMMETRIC fallback", () => {
      const unknownModes = [
        "UNKNOWN_MODE_XYZ",
        "HYPER_TURBO_MODE",
        "12345",
        "null",
        "undefined",
        "!@#$%",
      ];

      for (const mode of unknownModes) {
        const text = `IntervalMode=${mode}\nAllowAsymmetricFunding=true`;
        const parsed = parseSetTextToConfig(text);
        expect(parsed.intervalMode).toBe("ALL_ASYMMETRIC");
        expect(parsed.allowAsymmetricFunding).toBe(true);
      }
    });

    it("1.6 recognizes all case variations and aliases for STRICT_SYNC_ONLY", () => {
      const strictVariants = [
        "IntervalMode=strict_sync_only",
        "IntervalMode=STRICT",
        "IntervalMode=strict",
        "IntervalMode=Option2",
        "IntervalMode=option2",
        "IntervalMode=  STRICT_SYNC_ONLY  ",
      ];

      for (const text of strictVariants) {
        const parsed = parseSetTextToConfig(text);
        expect(parsed.intervalMode).toBe("STRICT_SYNC_ONLY");
        expect(parsed.allowAsymmetricFunding).toBe(false);
      }
    });

    it("1.7 recognizes all case variations for ALL_ASYMMETRIC and CUSTOM", () => {
      const asymVariants = [
        "IntervalMode=all_asymmetric",
        "IntervalMode=ALL_ASYMMETRIC",
        "IntervalMode=Option1",
        "IntervalMode=option1",
      ];
      for (const text of asymVariants) {
        const parsed = parseSetTextToConfig(text);
        expect(parsed.intervalMode).toBe("ALL_ASYMMETRIC");
        expect(parsed.allowAsymmetricFunding).toBe(true);
      }

      const customVariants = [
        "IntervalMode=custom",
        "IntervalMode=CUSTOM",
        "IntervalMode=  Custom  ",
      ];
      for (const text of customVariants) {
        const parsed = parseSetTextToConfig(text);
        expect(parsed.intervalMode).toBe("CUSTOM");
        expect(parsed.allowAsymmetricFunding).toBe(true);
      }
    });

    it("1.8 handles legacy .set files with boolean AllowAsymmetricFunding and numeric variants", () => {
      // AllowAsymmetricFunding=false -> STRICT_SYNC_ONLY
      const parsedFalse = parseSetTextToConfig("AllowAsymmetricFunding=false");
      expect(parsedFalse.allowAsymmetricFunding).toBe(false);
      expect(parsedFalse.intervalMode).toBe("STRICT_SYNC_ONLY");

      // AllowAsymmetricFunding=0 -> STRICT_SYNC_ONLY
      const parsedZero = parseSetTextToConfig("AllowAsymmetricFunding=0");
      expect(parsedZero.allowAsymmetricFunding).toBe(false);
      expect(parsedZero.intervalMode).toBe("STRICT_SYNC_ONLY");

      // AllowAsymmetricFunding=true -> ALL_ASYMMETRIC
      const parsedTrue = parseSetTextToConfig("AllowAsymmetricFunding=true");
      expect(parsedTrue.allowAsymmetricFunding).toBe(true);
      expect(parsedTrue.intervalMode).toBe("ALL_ASYMMETRIC");

      // AllowAsymmetricFunding=1 -> ALL_ASYMMETRIC
      const parsedOne = parseSetTextToConfig("AllowAsymmetricFunding=1");
      expect(parsedOne.allowAsymmetricFunding).toBe(true);
      expect(parsedOne.intervalMode).toBe("ALL_ASYMMETRIC");
    });

    it("1.9 enforces key precedence: explicit IntervalMode overrides conflicting AllowAsymmetricFunding", () => {
      // CASE A: AllowAsymmetricFunding precedes IntervalMode -> Both harmonize to STRICT_SYNC_ONLY
      const textHarmonious = "AllowAsymmetricFunding=true\nIntervalMode=STRICT_SYNC_ONLY";
      const parsedA = parseSetTextToConfig(textHarmonious);
      expect(parsedA.intervalMode).toBe("STRICT_SYNC_ONLY");
      expect(parsedA.allowAsymmetricFunding).toBe(false);

      // CASE B: IntervalMode precedes conflicting AllowAsymmetricFunding=true
      // Hardened implementation: explicit IntervalMode takes precedence, so allowAsymmetricFunding remains false
      const textConflicting = "IntervalMode=STRICT_SYNC_ONLY\nAllowAsymmetricFunding=true";
      const parsedB = parseSetTextToConfig(textConflicting);
      expect(parsedB.intervalMode).toBe("STRICT_SYNC_ONLY");
      expect(parsedB.allowAsymmetricFunding).toBe(false);
    });

    it("1.10 sanitizes messy, malformed AllowedIntervalPairs with random whitespace and excessive commas", () => {
      const messyPairs = "AllowedIntervalPairs= ,,, 1H_4H ,  , 4h_8H , , , 2h_4h ,,, ";
      const parsed = parseSetTextToConfig(messyPairs);
      expect(parsed.allowedIntervalPairs).toEqual(["1h_4h", "4h_8h", "2h_4h"]);
    });

    it("1.11 does not crash on null bytes or binary characters in text stream", () => {
      const binaryText = "Enabled=true\0\0\0\nIntervalMode=STRICT_SYNC_ONLY\r\n\x01\x02MinSpreadBps=45.0";
      const parsed = parseSetTextToConfig(binaryText);
      expect(parsed).toBeDefined();
      expect(parsed.intervalMode).toBe("STRICT_SYNC_ONLY");
      expect(parsed.allowAsymmetricFunding).toBe(false);
    });
  });

  // =========================================================================
  // SUITE 2: Serialization and Deserialization Roundtrips
  // =========================================================================
  describe("Suite 2: Serialization & Deserialization Roundtrips", () => {
    it("2.1 roundtrips empty custom pair lists cleanly", () => {
      const config: BotConfig = {
        ...DEFAULT_CONFIG,
        intervalMode: "STRICT_SYNC_ONLY",
        allowAsymmetricFunding: false,
        allowedIntervalPairs: [],
      };

      const serialized = serializeConfigToSetText(config, "EmptyPairsPreset");
      expect(serialized).toContain("IntervalMode=STRICT_SYNC_ONLY");
      expect(serialized).toContain("AllowAsymmetricFunding=false");
      expect(serialized).toContain("AllowedIntervalPairs=");

      const deserialized = parseSetTextToConfig(serialized);
      expect(deserialized.intervalMode).toBe("STRICT_SYNC_ONLY");
      expect(deserialized.allowAsymmetricFunding).toBe(false);
      expect(deserialized.allowedIntervalPairs).toEqual([]);
    });

    it("2.2 roundtrips all standard 6 interval pairs with ALL_ASYMMETRIC", () => {
      const allStandard = ["1h_4h", "4h_8h", "1h_8h", "2h_4h", "2h_8h", "1h_2h"];
      const config: BotConfig = {
        ...DEFAULT_CONFIG,
        intervalMode: "ALL_ASYMMETRIC",
        allowAsymmetricFunding: true,
        allowedIntervalPairs: allStandard,
      };

      const serialized = serializeConfigToSetText(config, "AllStandardPairs");
      const deserialized = parseSetTextToConfig(serialized);

      expect(deserialized.intervalMode).toBe("ALL_ASYMMETRIC");
      expect(deserialized.allowAsymmetricFunding).toBe(true);
      expect(deserialized.allowedIntervalPairs).toEqual(allStandard);
    });

    it("2.3 roundtrips single-item custom interval pair", () => {
      const singlePair = ["1h_4h"];
      const config: BotConfig = {
        ...DEFAULT_CONFIG,
        intervalMode: "CUSTOM",
        allowAsymmetricFunding: true,
        allowedIntervalPairs: singlePair,
      };

      const serialized = serializeConfigToSetText(config, "SinglePairPreset");
      const deserialized = parseSetTextToConfig(serialized);

      expect(deserialized.intervalMode).toBe("CUSTOM");
      expect(deserialized.allowAsymmetricFunding).toBe(true);
      expect(deserialized.allowedIntervalPairs).toEqual(singlePair);
    });

    it("2.4 roundtrips exotic and reverse permutations without data loss", () => {
      const exoticList = ["4h_1h", "8h_4h", "8h_1h", "4h_2h", "8h_2h", "2h_1h", "15m_1h"];
      const config: BotConfig = {
        ...DEFAULT_CONFIG,
        intervalMode: "CUSTOM",
        allowAsymmetricFunding: true,
        allowedIntervalPairs: exoticList,
      };

      const serialized = serializeConfigToSetText(config, "ExoticPairsPreset");
      const deserialized = parseSetTextToConfig(serialized);

      expect(deserialized.intervalMode).toBe("CUSTOM");
      expect(deserialized.allowedIntervalPairs).toEqual(exoticList);
    });

    it("2.5 integrates with saveSetFile, loadSetFiles, applySetFileToBot, and deleteSetFile", () => {
      const presetFileName = `adv_test_preset_${Date.now()}.set`;
      createdPresetFileNames.push(presetFileName);

      const customConfig: BotConfig = {
        ...DEFAULT_CONFIG,
        intervalMode: "CUSTOM",
        allowAsymmetricFunding: true,
        allowedIntervalPairs: ["1h_4h", "2h_8h"],
        minSpreadBps: 55.0,
      };

      // 1. Save preset to disk
      const savedSet = saveSetFile(
        presetFileName,
        "Adversarial Custom Preset",
        "Preset for stress testing roundtrip",
        customConfig,
        TEST_USER
      );
      expect(savedSet).toBeDefined();
      expect(savedSet.fileName).toBe(presetFileName);

      // 2. Load set files from disk and verify presence
      const loadedSets = loadSetFiles(TEST_USER);
      const matched = loadedSets.find((s) => s.fileName === presetFileName);
      expect(matched).toBeDefined();
      expect(matched?.config.intervalMode).toBe("CUSTOM");
      expect(matched?.config.allowedIntervalPairs).toEqual(["1h_4h", "2h_8h"]);
      expect(matched?.config.minSpreadBps).toBe(55.0);

      // 3. Apply preset to bot instance
      const state = loadBotState(TEST_USER);
      const targetBot = state.bots[0];
      const applied = applySetFileToBot(targetBot.id, presetFileName, TEST_USER);
      expect(applied).toBe(true);

      // Verify bot acquired the preset configuration
      const refreshedState = loadBotState(TEST_USER, true);
      const updatedBot = refreshedState.bots.find((b) => b.id === targetBot.id);
      expect(updatedBot?.config.intervalMode).toBe("CUSTOM");
      expect(updatedBot?.config.allowAsymmetricFunding).toBe(true);
      expect(updatedBot?.config.allowedIntervalPairs).toEqual(["1h_4h", "2h_8h"]);
      expect(updatedBot?.config.minSpreadBps).toBe(55.0);
      expect(updatedBot?.activeSetFileName).toBe(presetFileName);
    });
  });

  // =========================================================================
  // SUITE 3: High-Concurrency & Rapid Sequential Updates / Atomic Persistence
  // =========================================================================
  describe("Suite 3: High-Concurrency & Rapid Sequential Persistence Stress", () => {
    it("3.1 survives 30 rapid sequential mode toggles without race condition or state corruption", async () => {
      for (let i = 0; i < 30; i++) {
        const targetMode: FundingIntervalMode = i % 2 === 0 ? "STRICT_SYNC_ONLY" : "ALL_ASYMMETRIC";
        const req = new Request("http://localhost:3000/api/bot/daemon", {
          method: "POST",
          headers: { cookie: authCookie, "content-type": "application/json" },
          body: JSON.stringify({
            action: "toggle_asymmetric_funding",
            intervalMode: targetMode,
            enabled: targetMode === "ALL_ASYMMETRIC",
          }),
        });

        const res = await POST(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);

        const curBot = data.daemon.bots.find((b: any) => b.id === data.daemon.activeBotId) || data.daemon.bots[0];
        expect(curBot.config.intervalMode).toBe(targetMode);
      }

      // Read directly from disk after all 30 toggles
      const finalState = loadBotState(TEST_USER, true);
      const activeBot = finalState.bots.find((b) => b.id === finalState.activeBotId) || finalState.bots[0];
      // 29th index is odd -> ALL_ASYMMETRIC
      expect(activeBot.config.intervalMode).toBe("ALL_ASYMMETRIC");
      expect(activeBot.config.allowAsymmetricFunding).toBe(true);
    });

    it("3.2 survives 40 concurrent REST requests (interleaved updates and toggles) with zero corrupted JSON", async () => {
      const concurrentTasks = Array.from({ length: 40 }, (_, idx) => {
        if (idx % 2 === 0) {
          // Toggle action
          const mode: FundingIntervalMode = idx % 4 === 0 ? "STRICT_SYNC_ONLY" : "ALL_ASYMMETRIC";
          return POST(
            new Request("http://localhost:3000/api/bot/daemon", {
              method: "POST",
              headers: { cookie: authCookie, "content-type": "application/json" },
              body: JSON.stringify({
                action: "toggle_asymmetric_funding",
                intervalMode: mode,
              }),
            })
          );
        } else {
          // Update config action
          return POST(
            new Request("http://localhost:3000/api/bot/daemon", {
              method: "POST",
              headers: { cookie: authCookie, "content-type": "application/json" },
              body: JSON.stringify({
                action: "update_config",
                config: {
                  minSpreadBps: 35 + (idx % 10),
                  intervalMode: "CUSTOM",
                  allowedIntervalPairs: ["1h_4h", "4h_8h"],
                },
              }),
            })
          );
        }
      });

      // Execute all 40 simultaneously
      const results = await Promise.all(concurrentTasks);
      for (const res of results) {
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
      }

      // Check on-disk state file integrity
      const userFilePath = resolveUserStoragePath(TEST_USER, "bot_daemon_state.json");
      expect(fs.existsSync(userFilePath)).toBe(true);

      const rawContent = fs.readFileSync(userFilePath, "utf-8");
      // JSON must parse cleanly without SyntaxError (no partial write)
      let parsedJson: any;
      expect(() => {
        parsedJson = JSON.parse(rawContent);
      }).not.toThrow();

      expect(parsedJson).toBeDefined();
      expect(Array.isArray(parsedJson.bots)).toBe(true);
      expect(parsedJson.bots.length).toBeGreaterThan(0);

      // Verify no orphaned .tmp files left in user storage directory
      const userDir = path.dirname(userFilePath);
      const remainingFiles = fs.readdirSync(userDir);
      const tmpFiles = remainingFiles.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });

    it("3.3 survives 50 concurrent direct saveBotState disk writes without truncating file", async () => {
      const concurrentSaves = Array.from({ length: 50 }, (_, idx) => {
        return new Promise<void>((resolve) => {
          const state = createCleanState({
            intervalMode: idx % 2 === 0 ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY",
            minSpreadBps: 30 + idx,
            allowedIntervalPairs: idx % 2 === 0 ? ["1h_4h", "2h_4h"] : [],
          });
          saveBotState(state, TEST_USER);
          resolve();
        });
      });

      await Promise.all(concurrentSaves);

      // Cold reload from disk
      const reloaded = loadBotState(TEST_USER, true);
      expect(reloaded).toBeDefined();
      expect(reloaded.bots).toBeDefined();
      expect(reloaded.bots.length).toBe(1);

      const activeBot = reloaded.bots[0];
      expect(["ALL_ASYMMETRIC", "STRICT_SYNC_ONLY"]).toContain(activeBot.config.intervalMode);
      expect(typeof activeBot.config.minSpreadBps).toBe("number");
    });

    it("3.4 recovers cleanly from corrupted / truncated on-disk JSON without crashing", () => {
      const userFilePath = resolveUserStoragePath(TEST_USER, "bot_daemon_state.json");

      // Intentionally corrupt the file with invalid, truncated JSON
      fs.writeFileSync(userFilePath, '{"isRunning": true, "bots": [ { "name": "Broken Bot", ', "utf-8");

      // Load state must not throw SyntaxError; must fall back to healthy state
      let recoveredState: BotEngineState | undefined;
      let loadThrew = false;
      try {
        recoveredState = loadBotState(TEST_USER, true);
      } catch {
        loadThrew = true;
      }

      expect(loadThrew).toBe(false);
      expect(recoveredState).toBeDefined();
      const state = recoveredState as BotEngineState;
      expect(state.bots).toBeDefined();
      expect(state.bots.length).toBeGreaterThanOrEqual(1);
      expect(state.bots[0].config.intervalMode).toBe("ALL_ASYMMETRIC");
    });
  });
});
