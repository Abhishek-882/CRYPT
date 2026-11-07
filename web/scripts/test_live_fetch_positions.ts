import { getDecryptedExchangeCredentials } from '../lib/statarb/execution/liveExchangeAdapter';
import crypto from 'crypto';

async function main() {
  const creds = getDecryptedExchangeCredentials();

  // Binance
  const ts = Date.now();
  const qs = `timestamp=${ts}`;
  const sig = crypto.createHmac("sha256", creds.binanceSecret).update(qs).digest("hex");
  const url = `https://fapi.binance.com/fapi/v2/account?${qs}&signature=${sig}`;

  const res = await fetch(url, { headers: { "X-MBX-APIKEY": creds.binanceKey } });
  const data = await res.json();
  const pos = (data.positions || []).filter((p: any) => parseFloat(p.positionAmt) !== 0);
  console.log("=== BINANCE OPEN POSITIONS ===");
  console.log(JSON.stringify(pos, null, 2));

  // Bybit
  const tsB = Date.now().toString();
  const recvWindow = "5000";
  const qsB = "category=linear&settleCoin=USDT";
  const preHash = `${tsB}${creds.bybitKey}${recvWindow}${qsB}`;
  const sigB = crypto.createHmac("sha256", creds.bybitSecret).update(preHash).digest("hex");

  const bybRes = await fetch(`https://api.bybit.com/v5/position/list?${qsB}`, {
    headers: {
      "X-BAPI-API-KEY": creds.bybitKey,
      "X-BAPI-SIGN": sigB,
      "X-BAPI-TIMESTAMP": tsB,
      "X-BAPI-RECV-WINDOW": recvWindow
    }
  });
  const bybData = await bybRes.json();
  const activeByb = (bybData.result?.list || []).filter((p: any) => parseFloat(p.size) !== 0);
  console.log("=== BYBIT OPEN POSITIONS ===");
  console.log(JSON.stringify(activeByb, null, 2));
}

main();
