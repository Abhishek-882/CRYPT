const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const ALGORITHM = "aes-256-gcm";
const ENCRYPTED_PREFIX = "enc:v1:";

function getMasterKey() {
  const secretPath = "C:/AI-Hedge-Cockpit/web/.vault_master_key";
  if (fs.existsSync(secretPath)) {
    const raw = fs.readFileSync(secretPath, "utf-8").trim();
    return crypto.createHash("sha256").update(raw).digest();
  }
  const altPath = "C:/AI-Hedge-Cockpit/.vault_master_key";
  if (fs.existsSync(altPath)) {
    const raw = fs.readFileSync(altPath, "utf-8").trim();
    return crypto.createHash("sha256").update(raw).digest();
  }
  return crypto.createHash("sha256").update("ai_hedge_cockpit_secure_session_key_2026_vps").digest();
}

function decryptVaultSecret(cipherText) {
  if (!cipherText || typeof cipherText !== "string") return "";
  const trimmed = cipherText.trim();
  if (!trimmed.startsWith(ENCRYPTED_PREFIX)) return trimmed;
  try {
    const parts = trimmed.substring(ENCRYPTED_PREFIX.length).split(":");
    if (parts.length !== 3) return trimmed;
    const [ivHex, tagHex, dataHex] = parts;
    const key = getMasterKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch (err) {
    return "";
  }
}

const userStorePath = "C:/AI-Hedge-Cockpit/web/user_accounts_store.json";
const users = JSON.parse(fs.readFileSync(userStorePath, "utf8"));
const admin = users.find(u => u.role === "admin" || u.email.includes("varsha"));

const apiKey = admin.apiKeys.binanceKey;
const apiSecret = decryptVaultSecret(admin.apiKeys.binanceSecret);
const baseUrl = "https://fapi.binance.com";

console.log("=================================================================");
console.log(" REAL MONEY BINANCE FUTURES EXECUTION SPEED TEST & INSTANT CLOSE");
console.log(" Target Venue: Binance USD-M Futures Mainnet");
console.log(" User: " + admin.email);
console.log(" API Key: " + apiKey.slice(0, 8) + "..." + apiKey.slice(-6));
console.log("=================================================================\n");

async function sendSignedRequest(method, endpointPath, params = {}) {
  // Get calibrated timestamp
  const timeRes = await fetch(`${baseUrl}/fapi/v1/time`);
  const timeData = await timeRes.json();
  const serverOffset = timeData.serverTime - Date.now();

  const cleanParams = {
    ...params,
    timestamp: Date.now() + serverOffset,
    recvWindow: 10000,
  };

  const queryString = new URLSearchParams(
    Object.entries(cleanParams).map(([k, v]) => [k, String(v)])
  ).toString();

  const signature = crypto.createHmac("sha256", apiSecret).update(queryString).digest("hex");
  const fullUrl = `${baseUrl}${endpointPath}?${queryString}&signature=${signature}`;

  const t0 = performance.now();
  const res = await fetch(fullUrl, {
    method: method.toUpperCase(),
    headers: {
      "X-MBX-APIKEY": apiKey,
      "User-Agent": "BinanceSpeedTest/1.0",
    },
  });
  const latencyMs = Math.round(performance.now() - t0);
  const data = await res.json();
  return { ok: res.ok, status: res.status, data, latencyMs };
}

async function runTest() {
  // 1. Pre-flight Balance & Position Check
  console.log("[1/5] Checking account balance & open positions on Binance...");
  const accRes = await sendSignedRequest("GET", "/fapi/v2/account");
  if (!accRes.ok) {
    console.error("Account query failed:", accRes.data);
    process.exit(1);
  }

  const availableUsdt = parseFloat(accRes.data.availableBalance || "0");
  console.log(`Available Margin Balance: $${availableUsdt.toFixed(2)} USDT (query latency: ${accRes.latencyMs}ms)`);
  if (availableUsdt < 3) {
    console.error("Insufficient balance (< 3 USDT). Cannot proceed with test.");
    process.exit(1);
  }

  const dogePos = (accRes.data.positions || []).find(p => p.symbol === "DOGEUSDT");
  const currentQty = parseFloat(dogePos?.positionAmt || "0");
  console.log(`Current DOGEUSDT Position: ${currentQty} DOGE`);
  if (Math.abs(currentQty) > 0.001) {
    console.warn("DOGEUSDT position is not flat. Exiting to prevent overlap.");
    process.exit(1);
  }

  // 2. Set Leverage to 5x
  console.log("\n[2/5] Setting DOGEUSDT leverage to 5x...");
  const levRes = await sendSignedRequest("POST", "/fapi/v1/leverage", {
    symbol: "DOGEUSDT",
    leverage: 5,
  });
  console.log(`Leverage set to 5x (${levRes.latencyMs}ms) | Max Notional: $${levRes.data.maxNotionalValue}`);

  // 3. EXECUTE REAL MONEY BUY ORDER
  const TEST_QTY = 70; // 70 DOGE @ $0.0769 = ~$5.38 notional (satisfies 5 USDT min notional)
  console.log(`\n[3/5] Firing REAL MONEY Market BUY: ${TEST_QTY} DOGEUSDT...`);
  const tBuyStart = Date.now();
  const buyRes = await sendSignedRequest("POST", "/fapi/v1/order", {
    symbol: "DOGEUSDT",
    side: "BUY",
    type: "MARKET",
    quantity: TEST_QTY,
  });
  const tBuyDone = Date.now();

  if (!buyRes.ok || buyRes.data.code) {
    console.error("BUY order failed:", buyRes.data);
    process.exit(1);
  }

  const buyFillPrice = parseFloat(buyRes.data.avgPrice || "0");
  const buyOrderId = buyRes.data.orderId;
  const buyDurationMs = buyRes.latencyMs;
  console.log(`>>> [BUY FILLED] Order #${buyOrderId} @ $${buyFillPrice} | Fill Latency: ${buyDurationMs}ms (Status: ${buyRes.data.status})`);

  // 4. INSTANT FLAT CLOSE (Market SELL with reduceOnly)
  console.log(`\n[4/5] Instantly triggering FAST CLOSE: Market SELL ${TEST_QTY} DOGEUSDT (reduceOnly)...`);
  const tSellStart = Date.now();
  const sellRes = await sendSignedRequest("POST", "/fapi/v1/order", {
    symbol: "DOGEUSDT",
    side: "SELL",
    type: "MARKET",
    quantity: TEST_QTY,
    reduceOnly: "true",
  });
  const tSellDone = Date.now();

  if (!sellRes.ok || sellRes.data.code) {
    console.error("CRITICAL: SELL order failed:", sellRes.data);
    console.warn("Attempting emergency market unwind without reduceOnly flag...");
    const emRes = await sendSignedRequest("POST", "/fapi/v1/order", {
      symbol: "DOGEUSDT",
      side: "SELL",
      type: "MARKET",
      quantity: TEST_QTY,
    });
    console.log("Emergency unwind result:", emRes.data);
  }

  const sellFillPrice = parseFloat(sellRes.data?.avgPrice || "0");
  const sellOrderId = sellRes.data?.orderId;
  const sellDurationMs = sellRes.latencyMs;
  console.log(`>>> [SELL FILLED] Order #${sellOrderId} @ $${sellFillPrice} | Close Latency: ${sellDurationMs}ms (Status: ${sellRes.data?.status})`);

  const holdDurationMs = tSellDone - tBuyStart;

  // 5. Post-Flight Position & PnL Verification
  console.log("\n[5/5] Verifying position is completely flat...");
  const postAcc = await sendSignedRequest("GET", "/fapi/v2/account");
  const postDoge = (postAcc.data.positions || []).find(p => p.symbol === "DOGEUSDT");
  const finalQty = parseFloat(postDoge?.positionAmt || "0");
  const finalUsdt = parseFloat(postAcc.data.availableBalance || "0");

  const grossPnl = parseFloat(((sellFillPrice - buyFillPrice) * TEST_QTY).toFixed(4));
  const estFees = parseFloat((((buyFillPrice + sellFillPrice) * TEST_QTY) * 0.0005).toFixed(4));
  const netPnl = parseFloat((grossPnl - estFees).toFixed(4));

  console.log("\n=================================================================");
  console.log("            BINANCE REAL MONEY TEST TELEMETRY REPORT            ");
  console.log("=================================================================");
  console.log(` Pair:                   DOGEUSDT`);
  console.log(` Quantity:               ${TEST_QTY} DOGE ($${(buyFillPrice * TEST_QTY).toFixed(2)} Notional)`);
  console.log(` Leverage:               5x`);
  console.log(` ---------------------------------------------------------------`);
  console.log(` BUY Order:              #${buyOrderId} @ $${buyFillPrice}`);
  console.log(` BUY Fill Latency:       ${buyDurationMs} ms (Round-Trip ACK)`);
  console.log(` ---------------------------------------------------------------`);
  console.log(` SELL Close Order:       #${sellOrderId} @ $${sellFillPrice}`);
  console.log(` SELL Fill Latency:      ${sellDurationMs} ms (Round-Trip ACK)`);
  console.log(` ---------------------------------------------------------------`);
  console.log(` Total In-Market Time:   ${holdDurationMs} ms (From Buy Fire to Sell Confirmed)`);
  console.log(` Final Position Size:    ${finalQty} DOGE (${Math.abs(finalQty) === 0 ? "100% FLAT DELTA-NEUTRAL" : "WARNING: OPEN POSITION"})`);
  console.log(` Price Slippage PnL:     $${grossPnl >= 0 ? "+" : ""}${grossPnl} USDT`);
  console.log(` Round-Trip Taker Fees:  $${estFees} USDT`);
  console.log(` Net Test Cost:          $${netPnl} USDT`);
  console.log(` Ending Wallet Balance:  $${finalUsdt.toFixed(2)} USDT`);
  console.log("=================================================================\n");
}

runTest();
