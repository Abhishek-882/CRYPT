/**
 * Candidate Microstructure Verification & Depth Feasibility Tester
 * Queries live Level-10 books on Binance and Bybit for the empirical candidates
 * Strict 0% prohibited notations, strictly percentage (%) notation.
 */

import fs from 'fs';

interface CandidateProfile {
  symbol: string;
  category: string;
  direction: 'LONG_BN_SHORT_BYB' | 'SHORT_BN_LONG_BYB';
}

const CANDIDATES: CandidateProfile[] = [
  { symbol: 'CARVUSDT', category: 'High Beta Alt', direction: 'SHORT_BN_LONG_BYB' },
  { symbol: 'JCTUSDT', category: 'Volatile Alt', direction: 'LONG_BN_SHORT_BYB' },
  { symbol: 'AKEUSDT', category: 'High Beta Meme/Alt', direction: 'SHORT_BN_LONG_BYB' },
  { symbol: 'AIOUSDT', category: 'AI Sector', direction: 'LONG_BN_SHORT_BYB' },
  { symbol: 'CLANKERUSDT', category: 'Meme/Alt', direction: 'LONG_BN_SHORT_BYB' },
  { symbol: 'TRUSTUSDT', category: 'Altcoin', direction: 'LONG_BN_SHORT_BYB' },
  { symbol: 'APRUSDT', category: 'Altcoin', direction: 'SHORT_BN_LONG_BYB' },
  { symbol: 'INITUSDT', category: 'Infrastructure', direction: 'SHORT_BN_LONG_BYB' },
  { symbol: 'ACTUSDT', category: 'High Volume AI', direction: 'SHORT_BN_LONG_BYB' },
  { symbol: 'INUSDT', category: 'Meme Coin', direction: 'LONG_BN_SHORT_BYB' },
];

async function inspectCandidate(cand: CandidateProfile) {
  const [bnRes, bybRes, bnTick, bybTick] = await Promise.all([
    fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${cand.symbol}&limit=10`),
    fetch(`https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${cand.symbol}&limit=10`),
    fetch(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${cand.symbol}`).then(r => r.json()),
    fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${cand.symbol}`).then(r => r.json()),
  ]);

  const bnData = await bnRes.json();
  const bybData = await bybRes.json();

  const bnBids = (bnData.bids || []).map((b: any) => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]), notional: parseFloat(b[0]) * parseFloat(b[1]) }));
  const bnAsks = (bnData.asks || []).map((a: any) => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]), notional: parseFloat(a[0]) * parseFloat(a[1]) }));

  const bybBids = (bybData.result?.b || []).map((b: any) => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]), notional: parseFloat(b[0]) * parseFloat(b[1]) }));
  const bybAsks = (bybData.result?.a || []).map((a: any) => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]), notional: parseFloat(a[0]) * parseFloat(a[1]) }));

  const bnSpreadPct = ((bnAsks[0].price - bnBids[0].price) / ((bnAsks[0].price + bnBids[0].price) / 2)) * 100;
  const bybSpreadPct = ((bybAsks[0].price - bybBids[0].price) / ((bybAsks[0].price + bybBids[0].price) / 2)) * 100;

  const bnMid = (bnAsks[0].price + bnBids[0].price) / 2;
  const bybMid = (bybAsks[0].price + bybBids[0].price) / 2;
  const liveBasisPct = ((bnMid - bybMid) / ((bnMid + bybMid) / 2)) * 100;

  // Legs according to direction
  // LONG_BN_SHORT_BYB: Maker BUY on Binance (post-only bid), Taker SELL on Bybit (hit bybit bid)
  // SHORT_BN_LONG_BYB: Maker SELL on Binance (post-only ask), Taker BUY on Bybit (take bybit ask)
  const isLongBn = cand.direction === 'LONG_BN_SHORT_BYB';

  const makerVenue = 'Binance USD-M';
  const makerSide = isLongBn ? 'POST_BUY' : 'POST_SELL';
  const makerLevel1Notional = isLongBn ? bnBids[0].notional : bnAsks[0].notional;
  const makerTopPrice = isLongBn ? bnBids[0].price : bnAsks[0].price;

  const takerVenue = 'Bybit Linear';
  const takerSide = isLongBn ? 'TAKE_SELL (Bid)' : 'TAKE_BUY (Ask)';
  const takerLevels = isLongBn ? bybBids : bybAsks;
  const takerLevel1Notional = takerLevels[0]?.notional || 0;
  const takerTopPrice = takerLevels[0]?.price || 0;

  // Taker slippage simulation
  function simulateTakerSlippage(targetNotional: number) {
    let rem = targetNotional;
    let cost = 0;
    let qty = 0;
    for (const lvl of takerLevels) {
      const takeNotional = Math.min(rem, lvl.notional);
      cost += takeNotional;
      qty += takeNotional / lvl.price;
      rem -= takeNotional;
      if (rem <= 0) break;
    }
    if (rem > 0) return { fillable: false, slippagePct: 999 };
    const avgFillPrice = cost / qty;
    const slippagePct = Math.abs(avgFillPrice - takerTopPrice) / takerTopPrice * 100;
    return { fillable: true, slippagePct };
  }

  const slip15 = simulateTakerSlippage(15.0);
  const slip60 = simulateTakerSlippage(60.0);
  const slip100 = simulateTakerSlippage(100.0);

  const bybL5Notional = takerLevels.slice(0, 5).reduce((acc: number, l: any) => acc + l.notional, 0);
  const bnL5Notional = (isLongBn ? bnBids : bnAsks).slice(0, 5).reduce((acc: number, l: any) => acc + l.notional, 0);

  const has4xL1 = takerLevel1Notional >= 60.0;
  const has4xL5 = bybL5Notional >= 60.0;

  return {
    symbol: cand.symbol,
    category: cand.category,
    direction: cand.direction,
    liveBasisPct,
    bnSpreadPct,
    bybSpreadPct,
    spreadGatePassed: bnSpreadPct <= 0.080 && bybSpreadPct <= 0.080,
    makerVenue,
    makerSide,
    makerLevel1Notional,
    takerVenue,
    takerSide,
    takerLevel1Notional,
    bybL5Notional,
    bnL5Notional,
    has4xL1,
    has4xL5,
    slip15Pct: slip15.slippagePct,
    slip60Pct: slip60.slippagePct,
    slip100Pct: slip100.slippagePct,
  };
}

async function main() {
  console.log('Fetching live microstructure depth for empirical candidates...');
  const results = [];
  for (const c of CANDIDATES) {
    const res = await inspectCandidate(c);
    results.push(res);
  }

  console.log('\n========================================================================================================================');
  console.log('  LIVE MICROSTRUCTURE & SLIPPAGE STRESS-TEST RESULTS');
  console.log('========================================================================================================================');
  console.log('Symbol       | Live Basis | BN Sprd | BYB Sprd | Spread Gate | BN L1 ($) | BYB Taker L1 ($) | 4x L1? | 4x L5? | Slip $15 | Slip $60');
  console.log('------------------------------------------------------------------------------------------------------------------------');

  results.forEach(r => {
    console.log(
      `${r.symbol.padEnd(12)} | ` +
      `${r.liveBasisPct.toFixed(4).padStart(9)}% | ` +
      `${r.bnSpreadPct.toFixed(4).padStart(6)}% | ` +
      `${r.bybSpreadPct.toFixed(4).padStart(7)}% | ` +
      `${(r.spreadGatePassed ? 'PASS' : 'FAIL').padEnd(11)} | ` +
      `$${r.makerLevel1Notional.toFixed(0).padStart(8)} | ` +
      `$${r.takerLevel1Notional.toFixed(0).padStart(15)} | ` +
      `${(r.has4xL1 ? 'YES' : 'NO').padEnd(6)} | ` +
      `${(r.has4xL5 ? 'YES' : 'NO').padEnd(6)} | ` +
      `${r.slip15Pct.toFixed(4).padStart(7)}% | ` +
      `${r.slip60Pct.toFixed(4).padStart(7)}%`
    );
  });

  fs.writeFileSync('scripts/candidate_depth_audit.json', JSON.stringify(results, null, 2));
}

main().catch(console.error);
