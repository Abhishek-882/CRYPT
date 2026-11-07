import { getDecryptedExchangeCredentials } from '../lib/statarb/execution/liveExchangeAdapter';
import crypto from 'crypto';

async function main() {
  const creds = getDecryptedExchangeCredentials();

  const ts = Date.now();
  const qs = `symbol=SUIUSDT&limit=20&timestamp=${ts}`;
  const sig = crypto.createHmac("sha256", creds.binanceSecret).update(qs).digest("hex");
  const url = `https://fapi.binance.com/fapi/v1/userTrades?${qs}&signature=${sig}`;

  const res = await fetch(url, { headers: { "X-MBX-APIKEY": creds.binanceKey } });
  const data = await res.json();
  console.log("=== BINANCE SUIUSDT RECENT USER TRADES ===");
  console.log(JSON.stringify(data, null, 2));

  // Also Bybit trade history
  const tsB = Date.now().toString();
  const recvWindow = "5000";
  const qsB = "category=linear&symbol=SUIUSDT&limit=20";
  const preHash = `${tsB}${creds.bybitKey}${recvWindow}${qsB}`;
  const sigB = crypto.createHmac("sha256", creds.bybitSecret).update(preHash).digest("hex");

  const bybRes = await fetch(`https://api.bybit.com/v5/execution/list?${qsB}`, {
    headers: {
      "X-BAPI-API-KEY": creds.bybitKey,
      "X-BAPI-SIGN": sigB,
      "X-BAPI-TIMESTAMP": tsB,
      "X-BAPI-RECV-WINDOW": recvWindow
    }
  });
  const bybData = await bybRes.json();
  console.log("=== BYBIT SUIUSDT RECENT EXECUTIONS ===");
  console.log(JSON.stringify(bybData, null, 2));
}

main();
