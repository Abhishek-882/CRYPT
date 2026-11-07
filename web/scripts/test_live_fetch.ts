import { getDecryptedExchangeCredentials } from '../lib/statarb/execution/liveExchangeAdapter';
import crypto from 'crypto';

async function main() {
  const creds = getDecryptedExchangeCredentials();
  console.log("Credentials loaded successfully:");
  console.log("Binance Key:", creds.binanceKey ? creds.binanceKey.slice(0, 6) + "..." : "NONE");
  console.log("Binance Secret Length:", creds.binanceSecret.length);
  console.log("Bybit Key:", creds.bybitKey ? creds.bybitKey.slice(0, 6) + "..." : "NONE");
  console.log("Bybit Secret Length:", creds.bybitSecret.length);

  const ts = Date.now();
  const qs = `timestamp=${ts}`;
  const sig = crypto.createHmac("sha256", creds.binanceSecret).update(qs).digest("hex");
  const url = `https://fapi.binance.com/fapi/v2/account?${qs}&signature=${sig}`;

  const res = await fetch(url, {
    headers: {
      "X-MBX-APIKEY": creds.binanceKey
    }
  });

  const data = await res.json();
  if (data.totalWalletBalance) {
    console.log("Binance Total Wallet Balance:", data.totalWalletBalance, "USDT");
    console.log("Binance Available Balance:", data.availableBalance, "USDT");
    console.log("Binance Unrealized PnL:", data.totalUnrealizedProfit, "USDT");
    const pos = (data.positions || []).filter((p: any) => parseFloat(p.positionAmt) !== 0);
    console.log("Binance Open Positions:", pos.length);
  } else {
    console.log("Binance Response:", data);
  }
}

main();
