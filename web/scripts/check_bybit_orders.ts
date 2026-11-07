import { getDecryptedExchangeCredentials } from '../lib/statarb/execution/liveExchangeAdapter';
import crypto from 'crypto';

async function main() {
  const creds = getDecryptedExchangeCredentials();

  const tsB = Date.now().toString();
  const recvWindow = "5000";
  const qsB = "category=linear&symbol=SUIUSDT&limit=10";
  const preHash = `${tsB}${creds.bybitKey}${recvWindow}${qsB}`;
  const sigB = crypto.createHmac("sha256", creds.bybitSecret).update(preHash).digest("hex");

  const res = await fetch(`https://api.bybit.com/v5/order/history?${qsB}`, {
    headers: {
      "X-BAPI-API-KEY": creds.bybitKey,
      "X-BAPI-SIGN": sigB,
      "X-BAPI-TIMESTAMP": tsB,
      "X-BAPI-RECV-WINDOW": recvWindow
    }
  });

  const data = await res.json();
  console.log("=== BYBIT SUIUSDT ORDER HISTORY ===");
  console.log(JSON.stringify(data, null, 2));
}

main();
