import { getDecryptedExchangeCredentials } from '../lib/statarb/execution/liveExchangeAdapter';
import crypto from 'crypto';

async function main() {
  const creds = getDecryptedExchangeCredentials();

  const ts = Date.now();
  const params: Record<string, string> = {
    symbol: "SUIUSDT",
    side: "SELL",
    type: "MARKET",
    quantity: "17.2",
    reduceOnly: "true",
    timestamp: String(ts)
  };

  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join("&");
  const sig = crypto.createHmac("sha256", creds.binanceSecret).update(qs).digest("hex");
  const url = `https://fapi.binance.com/fapi/v1/order?${qs}&signature=${sig}`;

  console.log("Submitting Binance Market Sell to flatten 17.2 SUI...");
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-MBX-APIKEY": creds.binanceKey }
  });

  const data = await res.json();
  console.log("Binance Close Order Result:", JSON.stringify(data, null, 2));
}

main();
