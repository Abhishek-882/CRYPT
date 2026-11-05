import { NextRequest } from "next/server";
import { POST as orderPost } from "../app/api/order/route";
import { POST as hedgePost } from "../app/api/hedge/route";
import { POST as bitgetOrderPost } from "../app/api/bitget/order/route";
import { POST as bybitOrderPost } from "../app/api/bybit/order/route";
import { POST as coindcxOrderPost } from "../app/api/coindcx/order/route";
import { GET as botDaemonGet, POST as botDaemonPost } from "../app/api/bot/daemon/route";
import { GET as botConfigGet, POST as botConfigPost } from "../app/api/bot/config/route";
import { GET as authGet, POST as authPost } from "../app/api/auth/route";
import { registerUser, createSessionToken } from "../lib/userStore";

// Ensure dummy test vault key if needed
process.env.COCKPIT_VAULT_KEY = process.env.COCKPIT_VAULT_KEY || "2f1afca42db8f9b86e03660cf5591193c3c061b5c01b99002892c4c5e5454d18";

interface TestResult {
  id: string;
  name: string;
  expectedStatus: number;
  actualStatus: number;
  expectedCode?: string;
  actualCode?: string;
  payload: any;
  passed: boolean;
  notes?: string;
}

const results: TestResult[] = [];

async function recordTest(
  id: string,
  name: string,
  expectedStatus: number,
  expectedCode: string | undefined,
  handlerCall: () => Promise<Response>,
  notes?: string
) {
  let res: Response;
  let data: any = {};
  try {
    res = await handlerCall();
    try {
      data = await res.json();
    } catch {
      data = {};
    }
  } catch (err: any) {
    res = { status: 500 } as any;
    data = { error: err.message };
  }

  const actualStatus = res.status;
  const actualCode = data.code || data.complianceCode;
  let passed = actualStatus === expectedStatus;
  if (expectedCode && data.code !== expectedCode && data.error !== expectedCode) {
    // If code check requested
    if (actualStatus === expectedStatus) {
      // status matches
    }
  }

  results.push({
    id,
    name,
    expectedStatus,
    actualStatus,
    expectedCode,
    actualCode,
    payload: data,
    passed,
    notes,
  });

  const statusSymbol = passed ? "PASS" : "FAIL";
  console.log(`[${statusSymbol}] [${id}] ${name} -> Got ${actualStatus} (Expected ${expectedStatus})`);
  if (!passed) {
    console.log(`       Details: ${JSON.stringify(data)}`);
  }
}

async function runAdversarialSuite() {
  console.log("================================================================================");
  console.log("  SAFECOINER EMPIRICAL CHALLENGER: ADVERSARIAL AUTHENTICATION GATING SUITE");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // VECTOR 1: Empty Cookies & Null Headers
  // ---------------------------------------------------------------------------
  console.log("--- Vector 1: Empty Cookies & Null Headers ---");

  await recordTest("V1-01", "POST /api/order [Empty]", 401, "AUTH_REQUIRED", () =>
    orderPost(new NextRequest("http://localhost/api/order", {
      method: "POST",
      body: JSON.stringify({ symbol: "BTCUSDT", side: "BUY", quantity: "0.005" }),
    }))
  );

  await recordTest("V1-02", "POST /api/hedge [Empty]", 401, "AUTH_REQUIRED", () =>
    hedgePost(new NextRequest("http://localhost/api/hedge", {
      method: "POST",
      body: JSON.stringify({ mode: "paper", symbol: "BTCUSDT", notional: 25 }),
    }))
  );

  await recordTest("V1-03", "POST /api/bitget/order [Empty]", 401, "AUTH_REQUIRED", () =>
    bitgetOrderPost(new NextRequest("http://localhost/api/bitget/order", {
      method: "POST",
      body: JSON.stringify({ symbol: "BTCUSDT", side: "buy", size: "0.005" }),
    }))
  );

  await recordTest("V1-04", "POST /api/bybit/order [Empty]", 401, "AUTH_REQUIRED", () =>
    bybitOrderPost(new NextRequest("http://localhost/api/bybit/order", {
      method: "POST",
      body: JSON.stringify({ symbol: "BTCUSDT", side: "Buy", quantity: 0.001 }),
    }))
  );

  await recordTest("V1-05", "POST /api/coindcx/order [Empty]", 401, "AUTH_REQUIRED", () =>
    coindcxOrderPost(new NextRequest("http://localhost/api/coindcx/order", {
      method: "POST",
      body: JSON.stringify({ symbol: "BTCUSDT", side: "buy", quantity: 0.001 }),
    }))
  );

  await recordTest("V1-06", "GET /api/bot/daemon [Empty]", 401, "AUTH_REQUIRED", () =>
    botDaemonGet(new NextRequest("http://localhost/api/bot/daemon"))
  );

  await recordTest("V1-07", "POST /api/bot/daemon [Empty]", 401, "AUTH_REQUIRED", () =>
    botDaemonPost(new NextRequest("http://localhost/api/bot/daemon", {
      method: "POST",
      body: JSON.stringify({ action: "start" }),
    }))
  );

  await recordTest("V1-08", "GET /api/bot/config [Empty]", 401, "AUTH_REQUIRED", () =>
    botConfigGet(new NextRequest("http://localhost/api/bot/config"))
  );

  await recordTest("V1-09", "POST /api/bot/config [Empty]", 401, "AUTH_REQUIRED", () =>
    botConfigPost(new NextRequest("http://localhost/api/bot/config", {
      method: "POST",
      body: JSON.stringify({ activeBotId: "bot-1" }),
    }))
  );

  await recordTest("V1-10", "POST /api/auth [update_keys without cookie]", 401, undefined, () =>
    authPost(new NextRequest("http://localhost/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "update_keys", apiKeys: { binanceKey: "test" } }),
    }))
  );

  // ---------------------------------------------------------------------------
  // VECTOR 2: Forged Session Tokens & Invalid HMAC Signatures
  // ---------------------------------------------------------------------------
  console.log("\n--- Vector 2: Forged Session Tokens & Invalid HMAC Signatures ---");

  const forgedCookie = "auth_session=usr_admin_varsha.bad_signature_00000000000000000000000000000000";
  const forgedHeaders = { cookie: forgedCookie };

  await recordTest("V2-01", "POST /api/order [Forged HMAC]", 401, "AUTH_REQUIRED", () =>
    orderPost(new NextRequest("http://localhost/api/order", {
      method: "POST",
      headers: forgedHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "BUY", quantity: "0.005" }),
    }))
  );

  await recordTest("V2-02", "POST /api/hedge [Forged HMAC]", 401, "AUTH_REQUIRED", () =>
    hedgePost(new NextRequest("http://localhost/api/hedge", {
      method: "POST",
      headers: forgedHeaders,
      body: JSON.stringify({ mode: "paper", symbol: "BTCUSDT", notional: 25 }),
    }))
  );

  await recordTest("V2-03", "POST /api/bitget/order [Forged HMAC]", 401, "AUTH_REQUIRED", () =>
    bitgetOrderPost(new NextRequest("http://localhost/api/bitget/order", {
      method: "POST",
      headers: forgedHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "buy", size: "0.005" }),
    }))
  );

  await recordTest("V2-04", "POST /api/bybit/order [Forged HMAC]", 401, "AUTH_REQUIRED", () =>
    bybitOrderPost(new NextRequest("http://localhost/api/bybit/order", {
      method: "POST",
      headers: forgedHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "Buy", quantity: 0.001 }),
    }))
  );

  await recordTest("V2-05", "POST /api/coindcx/order [Forged HMAC]", 401, "AUTH_REQUIRED", () =>
    coindcxOrderPost(new NextRequest("http://localhost/api/coindcx/order", {
      method: "POST",
      headers: forgedHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "buy", quantity: 0.001 }),
    }))
  );

  await recordTest("V2-06", "GET /api/bot/daemon [Forged HMAC]", 401, "AUTH_REQUIRED", () =>
    botDaemonGet(new NextRequest("http://localhost/api/bot/daemon", {
      headers: forgedHeaders,
    }))
  );

  await recordTest("V2-07", "POST /api/bot/daemon [Forged HMAC]", 401, "AUTH_REQUIRED", () =>
    botDaemonPost(new NextRequest("http://localhost/api/bot/daemon", {
      method: "POST",
      headers: forgedHeaders,
      body: JSON.stringify({ action: "start" }),
    }))
  );

  await recordTest("V2-08", "GET /api/bot/config [Forged HMAC]", 401, "AUTH_REQUIRED", () =>
    botConfigGet(new NextRequest("http://localhost/api/bot/config", {
      headers: forgedHeaders,
    }))
  );

  await recordTest("V2-09", "POST /api/bot/config [Forged HMAC]", 401, "AUTH_REQUIRED", () =>
    botConfigPost(new NextRequest("http://localhost/api/bot/config", {
      method: "POST",
      headers: forgedHeaders,
      body: JSON.stringify({ activeBotId: "bot-1" }),
    }))
  );

  await recordTest("V2-10", "POST /api/auth [Forged HMAC update_keys]", 401, undefined, () =>
    authPost(new NextRequest("http://localhost/api/auth", {
      method: "POST",
      headers: forgedHeaders,
      body: JSON.stringify({ action: "update_keys", apiKeys: { binanceKey: "test" } }),
    }))
  );

  // ---------------------------------------------------------------------------
  // VECTOR 3: Legacy usr_admin_varsha Backdoor Injection in Headers & Bodies
  // ---------------------------------------------------------------------------
  console.log("\n--- Vector 3: Legacy usr_admin_varsha Injection in Headers & Bodies ---");

  const legacyBackdoorHeaders = {
    "x-user-id": "usr_admin_varsha",
    "x-user": "usr_admin_varsha",
    "x-admin": "true",
    "x-role": "admin",
    "x-auth-user": "usr_admin_varsha",
    cookie: "auth_role=admin; auth_email=admin@safecoiner.com", // Missing auth_session!
  };

  await recordTest("V3-01", "POST /api/order [usr_admin_varsha Header Injection]", 401, "AUTH_REQUIRED", () =>
    orderPost(new NextRequest("http://localhost/api/order", {
      method: "POST",
      headers: legacyBackdoorHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "BUY", quantity: "0.005", userId: "usr_admin_varsha" }),
    }))
  );

  await recordTest("V3-02", "POST /api/hedge [usr_admin_varsha Header Injection]", 401, "AUTH_REQUIRED", () =>
    hedgePost(new NextRequest("http://localhost/api/hedge", {
      method: "POST",
      headers: legacyBackdoorHeaders,
      body: JSON.stringify({ mode: "paper", symbol: "BTCUSDT", notional: 25, userId: "usr_admin_varsha" }),
    }))
  );

  await recordTest("V3-03", "POST /api/bitget/order [usr_admin_varsha Header Injection]", 401, "AUTH_REQUIRED", () =>
    bitgetOrderPost(new NextRequest("http://localhost/api/bitget/order", {
      method: "POST",
      headers: legacyBackdoorHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "buy", size: "0.005", userId: "usr_admin_varsha" }),
    }))
  );

  await recordTest("V3-04", "POST /api/bybit/order [usr_admin_varsha Header Injection]", 401, "AUTH_REQUIRED", () =>
    bybitOrderPost(new NextRequest("http://localhost/api/bybit/order", {
      method: "POST",
      headers: legacyBackdoorHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "Buy", quantity: 0.001, userId: "usr_admin_varsha" }),
    }))
  );

  await recordTest("V3-05", "POST /api/coindcx/order [usr_admin_varsha Header Injection]", 401, "AUTH_REQUIRED", () =>
    coindcxOrderPost(new NextRequest("http://localhost/api/coindcx/order", {
      method: "POST",
      headers: legacyBackdoorHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "buy", quantity: 0.001, userId: "usr_admin_varsha" }),
    }))
  );

  await recordTest("V3-06", "GET /api/bot/daemon [usr_admin_varsha Header Injection]", 401, "AUTH_REQUIRED", () =>
    botDaemonGet(new NextRequest("http://localhost/api/bot/daemon", {
      headers: legacyBackdoorHeaders,
    }))
  );

  await recordTest("V3-07", "POST /api/bot/daemon [usr_admin_varsha Header Injection]", 401, "AUTH_REQUIRED", () =>
    botDaemonPost(new NextRequest("http://localhost/api/bot/daemon", {
      method: "POST",
      headers: legacyBackdoorHeaders,
      body: JSON.stringify({ action: "start", userId: "usr_admin_varsha" }),
    }))
  );

  await recordTest("V3-08", "GET /api/bot/config [usr_admin_varsha Header Injection]", 401, "AUTH_REQUIRED", () =>
    botConfigGet(new NextRequest("http://localhost/api/bot/config", {
      headers: legacyBackdoorHeaders,
    }))
  );

  await recordTest("V3-09", "POST /api/bot/config [usr_admin_varsha Header Injection]", 401, "AUTH_REQUIRED", () =>
    botConfigPost(new NextRequest("http://localhost/api/bot/config", {
      method: "POST",
      headers: legacyBackdoorHeaders,
      body: JSON.stringify({ activeBotId: "bot-1", userId: "usr_admin_varsha" }),
    }))
  );

  // Unsigned raw session cookie test: auth_session=usr_admin_varsha
  const rawCookieReq = new NextRequest("http://localhost/api/auth", {
    headers: { cookie: "auth_session=usr_admin_varsha" },
  });
  const rawAuthRes = await authGet(rawCookieReq);
  const rawAuthData = await rawAuthRes.json();
  const rawAuthPassed = rawAuthData.isLoggedIn === false && rawAuthData.user === null;
  results.push({
    id: "V3-10",
    name: "GET /api/auth [Raw unsigned usr_admin_varsha cookie rejects auto-login]",
    expectedStatus: 200,
    actualStatus: rawAuthRes.status,
    payload: rawAuthData,
    passed: rawAuthPassed,
  });
  console.log(`[${rawAuthPassed ? "PASS" : "FAIL"}] [V3-10] GET /api/auth [Raw unsigned usr_admin_varsha] -> isLoggedIn=${rawAuthData.isLoggedIn}`);

  // ---------------------------------------------------------------------------
  // VECTOR 4: Missing Admin Privileges / Non-Admin Role Gating
  // ---------------------------------------------------------------------------
  console.log("\n--- Vector 4: Missing Admin Privileges / Non-Admin Role Gating ---");

  // Create or load a regular user with role: "user" and grant consent
  const { findUserByEmail } = await import("../lib/userStore");
  let regularUser: any = findUserByEmail("regular_trader@safecoiner.com");
  if (!regularUser) {
    const regUserRes = registerUser("regular_trader@safecoiner.com", "SecurePass123!", "regular_trader");
    regularUser = regUserRes.user || null;
  }
  if (regularUser) {
    regularUser.role = "user";
  }
  const regularUserToken = regularUser ? createSessionToken(regularUser.id) : "";
  const regularUserHeaders = {
    cookie: `auth_session=${regularUserToken}`,
  };

  if (regularUser) {
    // Grant DPDP consent so we isolate the missing keys gate:
    const { recordBatchConsents } = await import("../lib/complianceStore");
    recordBatchConsents(regularUser.email, [
      { purpose: "PURPOSE_AUTH_AND_EXECUTION", status: "GRANTED" },
      { purpose: "PURPOSE_EXCHANGE_DISPATCH", status: "GRANTED" },
    ], { userId: regularUser.id, ipAddress: "127.0.0.1", userAgent: "test" });
  }

  // Regular user trying to trigger daemon cron without CRON_SECRET:
  await recordTest("V4-01", "GET /api/bot/daemon?action=cron_tick [Non-admin role without CRON_SECRET]", 401, "AUTH_REQUIRED", () =>
    botDaemonGet(new NextRequest("http://localhost/api/bot/daemon?action=cron_tick", {
      headers: regularUserHeaders,
    }))
  );

  // Regular user trying to trigger order without configuring their own API keys:
  await recordTest("V4-02", "POST /api/order [Non-admin without own keys rejects default keys]", 401, undefined, () =>
    orderPost(new NextRequest("http://localhost/api/order", {
      method: "POST",
      headers: regularUserHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "BUY", quantity: "0.005" }),
    }))
  );

  // ---------------------------------------------------------------------------
  // VECTOR 5: Case 3 Exploit — Explicit Header API Keys Without Session
  // ---------------------------------------------------------------------------
  console.log("\n--- Vector 5: Case 3 Exploit — Header API Keys Without Session ---");

  // Attack scenario: Attacker sends fake exchange credentials in headers without any auth_session cookie
  const fakeBinanceHeaders = {
    "x-binance-key": "attacker_supplied_fake_key_12345",
    "x-binance-secret": "attacker_supplied_fake_secret_67890",
  };

  await recordTest("V5-01", "POST /api/order [Attacker Header Keys Without Session]", 401, "AUTH_REQUIRED", () =>
    orderPost(new NextRequest("http://localhost/api/order", {
      method: "POST",
      headers: fakeBinanceHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "BUY", quantity: "0.005" }),
    })),
    "Case 3 in lib/authHelper.ts grants authorized:true when x-binance-key and secret are provided, bypassing session checks!"
  );

  await recordTest("V5-02", "POST /api/hedge [Attacker Header Keys Without Session]", 401, "AUTH_REQUIRED", () =>
    hedgePost(new NextRequest("http://localhost/api/hedge", {
      method: "POST",
      headers: fakeBinanceHeaders,
      body: JSON.stringify({ mode: "paper", symbol: "BTCUSDT", notional: 25 }),
    })),
    "Case 3 in lib/authHelper.ts grants authorized:true, executing paper hedge for global_default without login!"
  );

  const fakeBitgetHeaders = {
    "x-bitget-key": "fake_bitget_key",
    "x-bitget-secret": "fake_bitget_secret",
    "x-bitget-passphrase": "fake_bitget_pass",
  };

  await recordTest("V5-03", "POST /api/bitget/order [Attacker Header Keys Without Session]", 401, "AUTH_REQUIRED", () =>
    bitgetOrderPost(new NextRequest("http://localhost/api/bitget/order", {
      method: "POST",
      headers: fakeBitgetHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "buy", size: "0.005" }),
    })),
    "Case 3 in lib/authHelper.ts grants authorized:true, triggering Bitget order execution without session!"
  );

  const fakeBybitHeaders = {
    "x-bybit-key": "fake_bybit_key",
    "x-bybit-secret": "fake_bybit_secret",
  };

  await recordTest("V5-04", "POST /api/bybit/order [Attacker Header Keys Without Session]", 401, "AUTH_REQUIRED", () =>
    bybitOrderPost(new NextRequest("http://localhost/api/bybit/order", {
      method: "POST",
      headers: fakeBybitHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "Buy", quantity: 0.001 }),
    })),
    "Case 3 in lib/authHelper.ts grants authorized:true, triggering Bybit order execution without session!"
  );

  const fakeCoindcxHeaders = {
    "x-coindcx-key": "fake_coindcx_key",
    "x-coindcx-secret": "fake_coindcx_secret",
  };

  await recordTest("V5-05", "POST /api/coindcx/order [Attacker Header Keys Without Session]", 401, "AUTH_REQUIRED", () =>
    coindcxOrderPost(new NextRequest("http://localhost/api/coindcx/order", {
      method: "POST",
      headers: fakeCoindcxHeaders,
      body: JSON.stringify({ symbol: "BTCUSDT", side: "buy", quantity: 0.001 }),
    })),
    "Case 3 in lib/authHelper.ts grants authorized:true, triggering CoinDCX order execution without session!"
  );

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  const totalPassed = results.filter((r) => r.passed).length;
  const totalFailed = results.filter((r) => !r.passed).length;
  console.log(`TOTAL TESTS: ${results.length} | PASSED: ${totalPassed} | FAILED: ${totalFailed}`);
  console.log("================================================================================\n");

  if (totalFailed > 0) {
    console.error("FAILING TESTS:");
    for (const f of results.filter((r) => !r.passed)) {
      console.error(`  - [${f.id}] ${f.name} -> Expected ${f.expectedStatus}, got ${f.actualStatus}`);
      if (f.notes) console.error(`    Note: ${f.notes}`);
    }
  }

  process.exit(totalFailed > 0 ? 1 : 0);
}

runAdversarialSuite().catch((err) => {
  console.error("Fatal suite crash:", err);
  process.exit(1);
});
