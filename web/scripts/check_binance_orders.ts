import { getDecryptedExchangeCredentials } from '../lib/statarb/execution/liveExchangeAdapter';
import crypto from 'crypto';

async function main() {
  const creds = getDecryptedExchangeCredentials();

  const ts = Date.now();
  const qs = `symbol=SUIUSDT&limit=10&timestamp=${ts}`;
  const sig = crypto.createHmac("sha256", creds.binanceSecret).update(qs).digest("hex");
  const url = `https://fapi.binance.com/fapi/v1/allOrders?${qs}&signature=${sig}`;

  const res = await fetch(url, { headers: { "X-MBX-APIKEY": creds.binanceKey } });
  const data = await res.json();
  console.log("=== BINANCE SUIUSDT LAST 10 ORDERS ===");
  console.log(JSON.stringify(data, null, 2));
}

main();
