import { getDecryptedExchangeCredentials } from '../lib/statarb/execution/liveExchangeAdapter';
import crypto from 'crypto';

async function main() {
  const creds = getDecryptedExchangeCredentials();

  console.log("=== FULL FORENSIC TRADE AUDIT ===");

  // 1. All Binance Futures User Trades (last 7 days / all recent)
  const ts = Date.now();
  const startTime = ts - 24 * 60 * 60 * 1000; // last 24h
  
  // Symbols to check
  const symbols = ["SUIUSDT", "APTUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "PEPEUSDT", "1000PEPEUSDT", "1000SATSUSDT"];
  
  const binanceFills: any[] = [];
  for (const sym of symbols) {
    try {
      const q = `symbol=${sym}&startTime=${startTime}&timestamp=${Date.now()}`;
      const sig = crypto.createHmac("sha256", creds.binanceSecret).update(q).digest("hex");
      const url = `https://fapi.binance.com/fapi/v1/userTrades?${q}&signature=${sig}`;
      const res = await fetch(url, { headers: { "X-MBX-APIKEY": creds.binanceKey } });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        binanceFills.push(...data.map(d => ({ ...d, symbol: sym })));
      }
    } catch (e: any) {
      console.error(`Error querying Binance ${sym}:`, e.message);
    }
  }

  console.log(`\n>>> BINANCE FILLS IN LAST 24H: ${binanceFills.length} trades`);
  let binanceTotalPnl = 0;
  let binanceTotalFees = 0;
  for (const f of binanceFills) {
    const pnl = parseFloat(f.realizedPnl || "0");
    const comm = parseFloat(f.commission || "0");
    binanceTotalPnl += pnl;
    binanceTotalFees += comm;
    console.log(`  [Binance] ${new Date(f.time).toISOString()} | ${f.symbol} | ${f.side} | Qty: ${f.qty} @ ${f.price} | PnL: $${pnl.toFixed(4)} | Fee: $${comm.toFixed(4)} (${f.commissionAsset}) | OrderId: ${f.orderId}`);
  }
  console.log(`Total Binance Realized PnL: $${binanceTotalPnl.toFixed(4)} USDT`);
  console.log(`Total Binance Fees Paid: $${binanceTotalFees.toFixed(4)} USDT`);
  console.log(`Net Binance Change: $${(binanceTotalPnl - binanceTotalFees).toFixed(4)} USDT`);

  // 2. All Bybit Linear Executions (last 24h)
  const bybitFills: any[] = [];
  for (const sym of symbols) {
    try {
      const tsB = Date.now().toString();
      const recvWindow = "5000";
      const qsB = `category=linear&symbol=${sym}&limit=50`;
      const preHash = `${tsB}${creds.bybitKey}${recvWindow}${qsB}`;
      const sigB = crypto.createHmac("sha256", creds.bybitSecret).update(preHash).digest("hex");

      const urlB = `https://api.bybit.com/v5/execution/list?${qsB}`;
      const resB = await fetch(urlB, {
        headers: {
          "X-BAPI-API-KEY": creds.bybitKey,
          "X-BAPI-SIGN": sigB,
          "X-BAPI-TIMESTAMP": tsB,
          "X-BAPI-RECV-WINDOW": recvWindow
        }
      });
      const dataB = await resB.json();
      if (dataB.result?.list && dataB.result.list.length > 0) {
        bybitFills.push(...dataB.result.list);
      }
    } catch (e: any) {
      console.error(`Error querying Bybit ${sym}:`, e.message);
    }
  }

  console.log(`\n>>> BYBIT FILLS IN LAST 24H: ${bybitFills.length} trades`);
  let bybitTotalFee = 0;
  for (const b of bybitFills) {
    const fee = parseFloat(b.execFee || "0");
    bybitTotalFee += fee;
    console.log(`  [Bybit] ${new Date(parseInt(b.execTime)).toISOString()} | ${b.symbol} | ${b.side} | Qty: ${b.execQty} @ ${b.execPrice} | Fee: $${fee.toFixed(4)} | OrderId: ${b.orderId}`);
  }

  // 3. Check Bybit Closed PnL
  try {
    const tsB = Date.now().toString();
    const recvWindow = "5000";
    const qsB = `category=linear&limit=50`;
    const preHash = `${tsB}${creds.bybitKey}${recvWindow}${qsB}`;
    const sigB = crypto.createHmac("sha256", creds.bybitSecret).update(preHash).digest("hex");

    const urlB = `https://api.bybit.com/v5/position/closed-pnl?${qsB}`;
    const resB = await fetch(urlB, {
      headers: {
        "X-BAPI-API-KEY": creds.bybitKey,
        "X-BAPI-SIGN": sigB,
        "X-BAPI-TIMESTAMP": tsB,
        "X-BAPI-RECV-WINDOW": recvWindow
      }
    });
    const dataB = await resB.json();
    console.log(`\n>>> BYBIT CLOSED PNL RECORDS: ${dataB.result?.list?.length || 0}`);
    for (const cp of (dataB.result?.list || []).slice(0, 10)) {
      console.log(`  [Bybit Closed] ${new Date(parseInt(cp.updatedTime)).toISOString()} | ${cp.symbol} | Closed PnL: $${cp.closedPnl} | Exit Price: ${cp.avgExitPrice}`);
    }
  } catch (e: any) {
    console.error("Error querying Bybit closed PnL:", e.message);
  }
}

main();
