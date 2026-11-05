/**
 * Adversarial Milestone 1 Challenge Harness:
 * Credential Security & Vault Master Key Enforcement
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// Target web directory
const webDir = path.resolve(__dirname, "..");

// Helper for assertion
let passed = 0;
let failed = 0;
const results: Array<{ testName: string; status: "PASS" | "FAIL"; details: string }> = [];

function assert(condition: boolean, testName: string, details = "") {
  if (condition) {
    passed++;
    results.push({ testName, status: "PASS", details });
    console.log(`  [PASS] ${testName}`);
  } else {
    failed++;
    results.push({ testName, status: "FAIL", details });
    console.error(`  [FAIL] ${testName}: ${details}`);
  }
}

async function run() {
  console.log("===============================================================");
  console.log("  ADVERSARIAL STRESS TEST: COCKPIT_VAULT_KEY & CREDENTIAL ENFORCEMENT");
  console.log("===============================================================\n");

  // Dynamically import cryptoVault so environment variable tests can run prior to evaluation
  const cryptoVault = await import("../lib/cryptoVault");
  const {
    getCockpitVaultKey,
    getMasterKey,
    encryptVaultSecret,
    decryptVaultSecret,
    maskVaultKey,
    isMaskedSecret,
  } = cryptoVault;

  // -------------------------------------------------------------
  // SUITE 1: COCKPIT_VAULT_KEY Missing / Invalid Stress Testing
  // -------------------------------------------------------------
  console.log("--- SUITE 1: COCKPIT_VAULT_KEY Enforcement Stress Testing ---");

  // Test 1.1: Missing env var (undefined)
  delete process.env.COCKPIT_VAULT_KEY;
  let thrown = false;
  try {
    getCockpitVaultKey();
  } catch (err: any) {
    thrown = true;
    assert(
      err.message.includes("[VAULT CRITICAL]"),
      "1.1.1: Missing env var throws [VAULT CRITICAL] error on getCockpitVaultKey",
      err.message
    );
  }
  assert(thrown, "1.1.2: Missing env var fails fast without executing");

  thrown = false;
  try {
    getMasterKey();
  } catch (err: any) {
    thrown = true;
    assert(
      err.message.includes("[VAULT CRITICAL]"),
      "1.1.3: Missing env var throws on getMasterKey",
      err.message
    );
  }
  assert(thrown, "1.1.4: getMasterKey rejects missing env var");

  thrown = false;
  try {
    encryptVaultSecret("plain_text_test");
  } catch (err: any) {
    thrown = true;
    assert(
      err.message.includes("Vault encryption failed"),
      "1.1.5: encryptVaultSecret refuses to persist unencrypted secret when key is missing",
      err.message
    );
  }
  assert(thrown, "1.1.6: encryptVaultSecret fail-closed on missing key");

  // Test 1.2: Empty string
  process.env.COCKPIT_VAULT_KEY = "";
  thrown = false;
  try {
    getCockpitVaultKey();
  } catch (err: any) {
    thrown = true;
    assert(err.message.includes("[VAULT CRITICAL]"), "1.2: Empty string env var rejected");
  }
  assert(thrown, "1.2.1: Empty string fails fast");

  // Test 1.3: Whitespace only
  process.env.COCKPIT_VAULT_KEY = "   \t  \n  ";
  thrown = false;
  try {
    getCockpitVaultKey();
  } catch (err: any) {
    thrown = true;
    assert(err.message.includes("[VAULT CRITICAL]"), "1.3: Whitespace-only env var rejected");
  }
  assert(thrown, "1.3.1: Whitespace string fails fast");

  // Test 1.4: Key length < 64 chars
  const shortLengths = [1, 16, 32, 48, 63];
  for (const len of shortLengths) {
    process.env.COCKPIT_VAULT_KEY = "a".repeat(len);
    thrown = false;
    try {
      getCockpitVaultKey();
    } catch (err) {
      thrown = true;
    }
    assert(thrown, `1.4: Short key length ${len} chars rejected`);
  }

  // Test 1.5: Key length > 64 chars
  const longLengths = [65, 66, 80, 128, 256];
  for (const len of longLengths) {
    process.env.COCKPIT_VAULT_KEY = "a".repeat(len);
    thrown = false;
    try {
      getCockpitVaultKey();
    } catch (err) {
      thrown = true;
    }
    assert(thrown, `1.5: Long key length ${len} chars rejected`);
  }

  // Test 1.6: Non-hex characters
  const nonHexKeys = [
    { name: 'Contains "g"', key: "g" + "a".repeat(63) },
    { name: 'Contains "z"', key: "a".repeat(31) + "z" + "b".repeat(32) },
    { name: "Contains symbols (!@#$)", key: "a".repeat(60) + "!@#$" },
    { name: "Contains internal space", key: "a".repeat(32) + " " + "b".repeat(31) },
    { name: "Contains newline", key: "a".repeat(32) + "\n" + "b".repeat(31) },
    { name: "Contains unicode", key: "a".repeat(62) + "🔑" },
    { name: "Punctuation hyphen", key: "a".repeat(31) + "-" + "b".repeat(32) },
  ];
  for (const item of nonHexKeys) {
    process.env.COCKPIT_VAULT_KEY = item.key;
    thrown = false;
    try {
      getCockpitVaultKey();
    } catch (err) {
      thrown = true;
    }
    assert(thrown, `1.6: Non-hex key rejected (${item.name})`);
  }

  // Test 1.7: Valid 64-hex keys
  const validKeyLower = "2f1afca42db8f9b86e03660cf5591193c3c061b5c01b99002892c4c5e5454d18";
  process.env.COCKPIT_VAULT_KEY = validKeyLower;
  const returnedKey = getCockpitVaultKey();
  assert(returnedKey === validKeyLower, "1.7.1: Lowercase valid 64-hex key accepted");
  const masterKeyBuffer = getMasterKey();
  assert(
    Buffer.isBuffer(masterKeyBuffer) && masterKeyBuffer.length === 32,
    "1.7.2: getMasterKey returns 32-byte Buffer for AES-256"
  );

  const validKeyUpper = validKeyLower.toUpperCase();
  process.env.COCKPIT_VAULT_KEY = validKeyUpper;
  const returnedUpper = getCockpitVaultKey();
  assert(returnedUpper === validKeyUpper, "1.7.3: Uppercase valid 64-hex key accepted");
  const upperBuffer = getMasterKey();
  assert(
    upperBuffer.length === 32 && upperBuffer.toString("hex") === validKeyLower,
    "1.7.4: Uppercase hex parses to identical 32-byte Buffer"
  );

  const validKeyWithSpaces = `   ${validKeyLower}   \n`;
  process.env.COCKPIT_VAULT_KEY = validKeyWithSpaces;
  const trimmedReturn = getCockpitVaultKey();
  assert(trimmedReturn === validKeyLower, "1.7.5: Valid key with whitespace padding trims cleanly");

  // Test 1.8: Dynamic key mutation and cache invalidation
  const keyA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const keyB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  process.env.COCKPIT_VAULT_KEY = keyA;
  const bufA = getMasterKey();
  assert(bufA[0] === 0xaa, "1.8.1: Key A buffer initialized");

  process.env.COCKPIT_VAULT_KEY = keyB;
  const bufB = getMasterKey();
  assert(bufB[0] === 0xbb, "1.8.2: Dynamic mutation to Key B invalidates cache");

  // If changed to invalid key, must NOT return cached key
  process.env.COCKPIT_VAULT_KEY = "invalid";
  thrown = false;
  try {
    getMasterKey();
  } catch (err) {
    thrown = true;
  }
  assert(thrown, "1.8.3: Mutating to invalid key throws rather than returning stale cached Buffer");

  // Reset to valid key for crypto tests
  process.env.COCKPIT_VAULT_KEY = validKeyLower;

  // Test 1.9: AES-256-GCM Roundtrip, Auth Tag & Tamper Resistance
  const testSecret = "sk-live-sample-api-secret-1234567890abcdef-super-sensitive";
  const encrypted = encryptVaultSecret(testSecret);
  assert(encrypted.startsWith("enc:v1:"), "1.9.1: Ciphertext formatted with enc:v1: prefix");
  const parts = encrypted.slice("enc:v1:".length).split(":");
  assert(parts.length === 3, "1.9.2: Ciphertext contains exactly [iv, tag, data]");
  assert(parts[0].length === 24, "1.9.3: IV is 12 bytes (24 hex characters)");
  assert(parts[1].length === 32, "1.9.4: Auth Tag is 16 bytes (32 hex characters)");

  const decrypted = decryptVaultSecret(encrypted);
  assert(decrypted === testSecret, "1.9.5: Roundtrip decryption matches original secret");

  // Idempotency on already encrypted strings
  const doubleEnc = encryptVaultSecret(encrypted);
  assert(doubleEnc === encrypted, "1.9.6: Double encryption avoided for already encrypted secret");

  // Masked secret preserved
  const maskedVal = "••••••••••••••••";
  assert(encryptVaultSecret(maskedVal) === maskedVal, "1.9.7: Masked placeholders not re-encrypted");

  // Decryption with incorrect key returns empty string
  process.env.COCKPIT_VAULT_KEY = keyB;
  const wrongKeyDec = decryptVaultSecret(encrypted);
  assert(wrongKeyDec === "", '1.9.8: Decrypting with wrong key fails gracefully (returns "")');

  // Tampered ciphertext returns empty string
  process.env.COCKPIT_VAULT_KEY = validKeyLower;
  const tamperedData = parts[2].slice(0, -2) + (parts[2].endsWith("00") ? "ff" : "00");
  const tamperedCipher = `enc:v1:${parts[0]}:${parts[1]}:${tamperedData}`;
  const tamperedDec = decryptVaultSecret(tamperedCipher);
  assert(tamperedDec === "", "1.9.9: Tampered ciphertext rejected by GCM auth tag verification");

  // -------------------------------------------------------------
  // SUITE 2: Absence and Silent Recreation of .vault_master_key
  // -------------------------------------------------------------
  console.log("\n--- SUITE 2: Absence and Silent Recreation of .vault_master_key ---");

  const vaultKeyPath = path.join(webDir, ".vault_master_key");
  assert(!fs.existsSync(vaultKeyPath), "2.1: .vault_master_key does not exist in web/");

  // Import userStore and invoke operations to test if .vault_master_key is silently created
  const userStore = await import("../lib/userStore");
  const { loadUsers, saveUsers, getDecryptedUserApiKeys, getMaskedUserApiKeys, authenticateUser } = userStore;

  const users = loadUsers();
  assert(Array.isArray(users), "2.2: loadUsers() executes successfully");
  saveUsers(users);

  // Check again
  assert(!fs.existsSync(vaultKeyPath), "2.3: .vault_master_key was not silently recreated after userStore load/save");

  // Check for any file with "vault_master_key" in web/
  function scanFilesForPattern(dir: string, pattern: RegExp): string[] {
    const matched: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        matched.push(...scanFilesForPattern(fullPath, pattern));
      } else {
        if (pattern.test(entry.name)) {
          matched.push(fullPath);
        }
      }
    }
    return matched;
  }

  const keyFilesFound = scanFilesForPattern(webDir, /vault_master_key/i);
  assert(
    keyFilesFound.length === 0,
    "2.4: Zero files matching *vault_master_key* exist in web/",
    keyFilesFound.join(", ")
  );

  // Scan all source files in web/ (excluding node_modules and .next) for any reference to .vault_master_key
  function scanFileContentsForRegex(dir: string, regex: RegExp): string[] {
    const hits: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name.includes("adversarial_m1")
      ) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        hits.push(...scanFileContentsForRegex(fullPath, regex));
      } else if (/\.(ts|tsx|js|mjs|json)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, "utf8");
        if (regex.test(content)) {
          hits.push(fullPath);
        }
      }
    }
    return hits;
  }

  const codeHits = scanFileContentsForRegex(webDir, /\.vault_master_key/);
  assert(
    codeHits.length === 0,
    "2.5: Zero references to .vault_master_key in web/ source files",
    codeHits.join(", ")
  );

  // -------------------------------------------------------------
  // SUITE 3: Comprehensive Plaintext Secret & Entropy Scans
  // -------------------------------------------------------------
  console.log("\n--- SUITE 3: Comprehensive Plaintext Secret & Entropy Scans ---");

  // 3.1 Known Leaked Strings in lib/userStore.ts and user_accounts_store.json
  const knownBadPatterns = [
    { label: 'Admin default password "123456Safe"', regex: /123456Safe/ },
    { label: 'Static session secret "ai_hedge_cockpit_secure_session_key"', regex: /ai_hedge_cockpit_secure/ },
    { label: 'Binance key snippet "p0bQ0sEuhn"', regex: /p0bQ0sEuhn/ },
    { label: 'Binance secret snippet "jalfTphUb"', regex: /jalfTphUb/ },
    { label: 'Bitget key "bg_2c493"', regex: /bg_2c493/ },
    { label: 'Bitget secret snippet "ArbitrageBot2027"', regex: /ArbitrageBot2027/ },
    { label: 'CoinDCX key snippet "7e744fb"', regex: /7e744fb/ },
    { label: 'Bybit key snippet "LctwamyAei"', regex: /LctwamyAei/ },
    { label: 'Hardcoded email "varsha633@gmailcom"', regex: /varsha633@gmailcom/ },
    { label: 'Hardcoded daemon cron secret "internal_daemon_cron_secret"', regex: /internal_daemon_cron_secret/ },
  ];

  const targetFiles = [
    path.join(webDir, "lib", "userStore.ts"),
    path.join(webDir, "user_accounts_store.json"),
    path.join(webDir, "lib", "cryptoVault.ts"),
    path.join(webDir, "lib", "authHelper.ts"),
    path.join(webDir, "app", "api", "auth", "route.ts"),
    path.join(webDir, "app", "api", "order", "route.ts"),
    path.join(webDir, "app", "api", "bot", "daemon", "route.ts"),
    path.join(webDir, "app", "api", "bot", "config", "route.ts"),
  ];

  for (const pattern of knownBadPatterns) {
    let matchFound = false;
    const matchingFiles: string[] = [];
    for (const f of targetFiles) {
      if (fs.existsSync(f)) {
        const text = fs.readFileSync(f, "utf8");
        if (pattern.regex.test(text)) {
          matchFound = true;
          matchingFiles.push(path.basename(f));
        }
      }
    }
    assert(
      !matchFound,
      `3.1: Zero occurrences of ${pattern.label} in web/ security files`,
      matchingFiles.join(", ")
    );
  }

  // 3.2 Inspect user_accounts_store.json for any plaintext credentials
  const userStoreFile = path.join(webDir, "user_accounts_store.json");
  if (fs.existsSync(userStoreFile)) {
    const storeRaw = fs.readFileSync(userStoreFile, "utf8");
    const storeJson = JSON.parse(storeRaw);
    let plaintextExchangeKeyFound = false;
    let plaintextPasswordFound = false;

    for (const u of storeJson) {
      if (u.password && !u.password.startsWith("scrypt:")) {
        plaintextPasswordFound = true;
      }
      if (u.apiKeys) {
        for (const [k, v] of Object.entries(u.apiKeys)) {
          if (typeof v === "string" && v.trim() !== "") {
            // Endpoints and environments are expected plaintext URLs or identifiers
            if (
              k.toLowerCase().includes("endpoint") ||
              k.toLowerCase().includes("env") ||
              k.toLowerCase().includes("url") ||
              k.toLowerCase().includes("proxy")
            ) {
              continue;
            }
            // Secrets must be encrypted with enc:v1:
            if (k.toLowerCase().includes("secret") || k.toLowerCase().includes("passphrase")) {
              if (!v.startsWith("enc:v1:")) {
                plaintextExchangeKeyFound = true;
                console.error(`Plaintext secret found in user ${u.id}: ${k}`);
              }
            }
            // Keys: in seeded/cleared store, keys should be empty string
            if (k.toLowerCase().includes("key") && v.length > 10) {
              plaintextExchangeKeyFound = true;
              console.error(`Plaintext API key found in user ${u.id}: ${k} = ${v}`);
            }
          }
        }
      }
    }

    assert(!plaintextPasswordFound, "3.2.1: All user passwords in user_accounts_store.json are scrypt hashed");
    assert(!plaintextExchangeKeyFound, "3.2.2: Zero plaintext API keys/secrets in user_accounts_store.json");
  } else {
    assert(false, "user_accounts_store.json exists");
  }

  // 3.3 Shannon Entropy Scan on Strings in userStore.ts
  function shannonEntropy(str: string): number {
    const map: Record<string, number> = {};
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      map[c] = (map[c] || 0) + 1;
    }
    let entropy = 0;
    for (const c in map) {
      const p = map[c] / str.length;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  const userStoreSrc = fs.readFileSync(path.join(webDir, "lib", "userStore.ts"), "utf8");
  // Match string literals >= 20 characters
  const stringLiteralRegex = /"([^"\\]{20,})"/g;
  let match: RegExpExecArray | null;
  const suspiciousHighEntropyStrings: Array<{ val: string; entropy: string }> = [];
  while ((match = stringLiteralRegex.exec(userStoreSrc)) !== null) {
    const val = match[1];
    // Exclude imports, URLs, standard messages, known constant keys
    if (
      val.startsWith("http") ||
      val.includes("/") ||
      val.includes(" ") ||
      val.startsWith("scrypt:") ||
      val.includes("@")
    ) {
      continue;
    }
    const ent = shannonEntropy(val);
    if (ent > 4.2 && val.length > 25) {
      suspiciousHighEntropyStrings.push({ val, entropy: ent.toFixed(2) });
    }
  }

  assert(
    suspiciousHighEntropyStrings.length === 0,
    "3.3: Shannon entropy scan found zero hardcoded high-entropy secrets in lib/userStore.ts",
    JSON.stringify(suspiciousHighEntropyStrings)
  );

  // 3.4 Deep Parent Directory Audit (remediated_hedge_cockpit vs web)
  console.log("\n--- SUITE 4: Multi-Directory Operational Isolation Audit ---");
  const rootDir = path.resolve(webDir, "..");
  const rootVaultKey = path.join(rootDir, ".vault_master_key");
  const rootUserStore = path.join(rootDir, "user_accounts_store.json");

  const rootVaultKeyExists = fs.existsSync(rootVaultKey);
  console.log(`  [INFO] Root dir .vault_master_key exists: ${rootVaultKeyExists}`);
  if (rootVaultKeyExists) {
    console.log(`  [ADVISORY / CAVEAT] Found root .vault_master_key outside web/ at: ${rootVaultKey}`);
  }

  // Verify that web/lib/storagePath.ts never reads root .vault_master_key
  const storagePathSrc = fs.readFileSync(path.join(webDir, "lib", "storagePath.ts"), "utf8");
  const readsVaultKeyDirectly = /vault_master_key/.test(storagePathSrc);
  assert(!readsVaultKeyDirectly, "4.1: storagePath.ts does not reference or resolve .vault_master_key");

  // Verify that cryptoVault.ts does NOT import storagePath.ts or fs
  const cryptoVaultSrc = fs.readFileSync(path.join(webDir, "lib", "cryptoVault.ts"), "utf8");
  const importsFsInVault = /from\s+["']fs["']|require\(["']fs["']\)/.test(cryptoVaultSrc);
  const importsStoragePathInVault = /storagePath/.test(cryptoVaultSrc);
  assert(!importsFsInVault, "4.2: cryptoVault.ts has zero fs imports (memory & env only)");
  assert(!importsStoragePathInVault, "4.3: cryptoVault.ts does not use storagePath");

  console.log("\n===============================================================");
  console.log(`  SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test suite crashed with unhandled error:", err);
  process.exit(1);
});
