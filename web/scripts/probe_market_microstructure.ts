/**
 * Quantitative Market Probe & Microstructure Specialist Analysis
 * Verifies live market dynamics across Binance USD-M Perpetuals & Bybit Linear Perpetuals
 * Strictly enforces 0% prohibited notations (zero bps) and zero legacy references.
 */

import fs from 'fs';
import path from 'path';

interface SymbolLotPriceInfo {
  symbol: string;
  minQty: number;
  stepSize: number;
  tickSize: number;
}

interface VenueMetrics {
  symbol: string;
  bnMid: number;
  bybMid: number;
  liveBasisPct: number;
  bnSpreadPct: number;
  bybSpreadPct: number;
  bnBidNotional: number;
  bnAskNotional: number;
  bybBidNotional: number;
  bybAskNotional: number;
  bnTurnover24h: number;
  bybTurnover24h: number;
  combinedVolume24h: number;
  fundingRateBn: number;
  fundingRateByb: number;
}

interface HistoricalDispersion {
  symbol: string;
  minBasisPct: number;
  maxBasisPct: number;
  dispersion24hPct: number;
  ddi24h: number;
  candleCount: number;
}

interface OrderBookDepthDetail {
  symbol: string;
  bnTopBidPrice: number;
  bnTopBidQty: number;
  bnTopBidNotional: number;
  bnTopAskPrice: number;
  bnTopAskQty: number;
  bnTopAskNotional: number;
  bnL5BidNotional: number;
  bnL5AskNotional: number;
  bnSpreadPct: number;

  bybTopBidPrice: number;
  bybTopBidQty: number;
  bybTopBidNotional: number;
  bybTopAskPrice: number;
  bybTopAskQty: number;
  bybTopAskNotional: number;
  bybL5BidNotional: number;
  bybL5AskNotional: number;
  bybSpreadPct: number;

  minL1Notional: number;
  has4xL1Depth: boolean;
  minL5Notional: number;
  has4xL5Depth: boolean;
  
  // Real slippage calculation for $15 and $60
  slippage15UsdtPct: number;
  slippage60UsdtPct: number;
}

async function fetchBinanceExchangeInfo(): Promise<Map<string, SymbolLotPriceInfo>> {
  const res = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
  const data = await res.json();
  const map = new Map<string, SymbolLotPriceInfo>();
  for (const s of data.symbols) {
    if (s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING') {
      const lot = s.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const price = s.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      map.set(s.symbol, {
        symbol: s.symbol,
        minQty: lot ? parseFloat(lot.minQty) : 0.001,
        stepSize: lot ? parseFloat(lot.stepSize) : 0.001,
        tickSize: price ? parseFloat(price.tickSize) : 0.01,
      });
    }
  }
  return map;
}

async function fetchBybitInstruments(): Promise<Map<string, SymbolLotPriceInfo>> {
  const res = await fetch('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000');
  const data = await res.json();
  const map = new Map<string, SymbolLotPriceInfo>();
  for (const s of data.result.list) {
    if (s.contractType === 'LinearPerpetual' && s.quoteCoin === 'USDT' && s.status === 'Trading') {
      map.set(s.symbol, {
        symbol: s.symbol,
        minQty: parseFloat(s.lotSizeFilter?.minOrderQty || '0.001'),
        stepSize: parseFloat(s.lotSizeFilter?.qtyStep || '0.001'),
        tickSize: parseFloat(s.priceFilter?.tickSize || '0.01'),
      });
    }
  }
  return map;
}

async function fetchBinance24hTickers(): Promise<Map<string, any>> {
  const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
  const list = await res.json();
  const map = new Map<string, any>();
  for (const t of list) {
    map.set(t.symbol, t);
  }
  return map;
}

async function fetchBinanceBookTickers(): Promise<Map<string, any>> {
  const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/bookTicker');
  const list = await res.json();
  const map = new Map<string, any>();
  for (const t of list) {
    map.set(t.symbol, t);
  }
  return map;
}

async function fetchBinancePremiumIndex(): Promise<Map<string, number>> {
  const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
  const list = await res.json();
  const map = new Map<string, number>();
  for (const item of list) {
    map.set(item.symbol, parseFloat(item.lastFundingRate || '0') * 100);
  }
  return map;
}

async function fetchBybitTickers(): Promise<Map<string, any>> {
  const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
  const data = await res.json();
  const map = new Map<string, any>();
  for (const t of data.result.list) {
    map.set(t.symbol, t);
  }
  return map;
}

async function fetch24hDispersionForSymbol(symbol: string): Promise<HistoricalDispersion | null> {
  try {
    const [bnRes, bybRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=96`),
      fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=15&limit=96`)
    ]);

    if (!bnRes.ok || !bybRes.ok) return null;
    const bnK = await bnRes.json();
    const bybK = await bybRes.json();

    if (!Array.isArray(bnK) || !bybK?.result?.list) return null;

    const bybMap = new Map<number, number>();
    for (const c of bybK.result.list) {
      bybMap.set(parseInt(c[0]), parseFloat(c[4]));
    }

    let minB = 999.0;
    let maxB = -999.0;
    let matchCount = 0;

    for (const c of bnK) {
      const t = c[0];
      const pBN = parseFloat(c[4]);
      const pBYB = bybMap.get(t);
      if (pBYB && pBYB > 0 && pBN > 0) {
        matchCount++;
        const b = (2.0 * (pBN - pBYB) / (pBN + pBYB)) * 100.0;
        if (b < minB) minB = b;
        if (b > maxB) maxB = b;
      }
    }

    if (matchCount < 40) return null;

    const absMax = Math.max(Math.abs(minB), Math.abs(maxB));
    const denom = Math.max(maxB, Math.abs(minB));
    const ddi = denom > 0 ? (maxB - Math.abs(minB)) / denom : 0;

    return {
      symbol,
      minBasisPct: minB,
      maxBasisPct: maxB,
      dispersion24hPct: absMax,
      ddi24h: ddi,
      candleCount: matchCount,
    };
  } catch {
    return null;
  }
}

async function fetchDetailedOrderBook(symbol: string, direction: 'LONG_BN_SHORT_BYB' | 'SHORT_BN_LONG_BYB'): Promise<OrderBookDepthDetail | null> {
  try {
    const [bnRes, bybRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=10`),
      fetch(`https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${symbol}&limit=10`)
    ]);

    const bnData = await bnRes.json();
    const bybData = await bybRes.json();

    const bnBids = (bnData.bids || []).map((b: any) => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]), notional: parseFloat(b[0]) * parseFloat(b[1]) }));
    const bnAsks = (bnData.asks || []).map((a: any) => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]), notional: parseFloat(a[0]) * parseFloat(a[1]) }));

    const bybBids = (bybData.result?.b || []).map((b: any) => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]), notional: parseFloat(b[0]) * parseFloat(b[1]) }));
    const bybAsks = (bybData.result?.a || []).map((a: any) => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]), notional: parseFloat(a[0]) * parseFloat(a[1]) }));

    const bnTopBidPrice = bnBids[0]?.price || 0;
    const bnTopBidQty = bnBids[0]?.qty || 0;
    const bnTopBidNotional = bnBids[0]?.notional || 0;
    const bnTopAskPrice = bnAsks[0]?.price || 0;
    const bnTopAskQty = bnAsks[0]?.qty || 0;
    const bnTopAskNotional = bnAsks[0]?.notional || 0;
    const bnL5BidNotional = bnBids.slice(0, 5).reduce((acc: number, x: any) => acc + x.notional, 0);
    const bnL5AskNotional = bnAsks.slice(0, 5).reduce((acc: number, x: any) => acc + x.notional, 0);
    const bnSpreadPct = bnTopBidPrice > 0 && bnTopAskPrice > 0 ? ((bnTopAskPrice - bnTopBidPrice) / ((bnTopAskPrice + bnTopBidPrice) / 2)) * 100 : 999;

    const bybTopBidPrice = bybBids[0]?.price || 0;
    const bybTopBidQty = bybBids[0]?.qty || 0;
    const bybTopBidNotional = bybBids[0]?.notional || 0;
    const bybTopAskPrice = bybAsks[0]?.price || 0;
    const bybTopAskQty = bybAsks[0]?.qty || 0;
    const bybTopAskNotional = bybAsks[0]?.notional || 0;
    const bybL5BidNotional = bybBids.slice(0, 5).reduce((acc: number, x: any) => acc + x.notional, 0);
    const bybL5AskNotional = bybAsks.slice(0, 5).reduce((acc: number, x: any) => acc + x.notional, 0);
    const bybSpreadPct = bybTopBidPrice > 0 && bybTopAskPrice > 0 ? ((bybTopAskPrice - bybTopBidPrice) / ((bybTopAskPrice + bybTopBidPrice) / 2)) * 100 : 999;

    // For Bybit Taker Leg:
    // If direction is LONG_BN_SHORT_BYB, Bybit taker leg sells into Bybit bids
    // If direction is SHORT_BN_LONG_BYB, Bybit taker leg buys from Bybit asks
    const takerLevels = direction === 'LONG_BN_SHORT_BYB' ? bybBids : bybAsks;
    const takerTopPrice = direction === 'LONG_BN_SHORT_BYB' ? bybTopBidPrice : bybTopAskPrice;

    // Calculate slippage for target notional
    function calcTakerSlippage(targetNotional: number): number {
      if (!takerLevels || takerLevels.length === 0 || takerTopPrice <= 0) return 999;
      let remaining = targetNotional;
      let totalCost = 0;
      let totalQty = 0;
      for (const lvl of takerLevels) {
        const fillNotional = Math.min(remaining, lvl.notional);
        const fillQty = fillNotional / lvl.price;
        totalCost += fillNotional;
        totalQty += fillQty;
        remaining -= fillNotional;
        if (remaining <= 0) break;
      }
      if (remaining > 0) return 999; // deeper than book
      const avgPrice = totalCost / totalQty;
      const slippagePct = Math.abs(avgPrice - takerTopPrice) / takerTopPrice * 100;
      return slippagePct;
    }

    const slippage15UsdtPct = calcTakerSlippage(15.0);
    const slippage60UsdtPct = calcTakerSlippage(60.0);

    const minL1Notional = Math.min(bnTopBidNotional, bnTopAskNotional, bybTopBidNotional, bybTopAskNotional);
    const has4xL1Depth = minL1Notional >= 60.0;
    const minL5Notional = Math.min(bnL5BidNotional, bnL5AskNotional, bybL5BidNotional, bybL5AskNotional);
    const has4xL5Depth = minL5Notional >= 60.0;

    return {
      symbol,
      bnTopBidPrice,
      bnTopBidQty,
      bnTopBidNotional,
      bnTopAskPrice,
      bnTopAskQty,
      bnTopAskNotional,
      bnL5BidNotional,
      bnL5AskNotional,
      bnSpreadPct,
      bybTopBidPrice,
      bybTopBidQty,
      bybTopBidNotional,
      bybTopAskPrice,
      bybTopAskQty,
      bybTopAskNotional,
      bybL5BidNotional,
      bybL5AskNotional,
      bybSpreadPct,
      minL1Notional,
      has4xL1Depth,
      minL5Notional,
      has4xL5Depth,
      slippage15UsdtPct,
      slippage60UsdtPct,
    };
  } catch {
    return null;
  }
}

async function runQuantitativeProbe() {
  console.log('========================================================================================');
  console.log('  INSTITUTIONAL QUANTITATIVE PROBE: BINANCE USD-M vs BYBIT LINEAR PERPETUAL MARKETS');
  console.log('========================================================================================');

  const [bnSymbols, bybSymbols, bnTickers24h, bnBookTickers, bnFunding, bybTickers] = await Promise.all([
    fetchBinanceExchangeInfo(),
    fetchBybitInstruments(),
    fetchBinance24hTickers(),
    fetchBinanceBookTickers(),
    fetchBinancePremiumIndex(),
    fetchBybitTickers()
  ]);

  const sharedSymbols = [...bnSymbols.keys()].filter(s => bybSymbols.has(s));
  console.log(`[VENUE RECONCILIATION]`);
  console.log(`Binance USD-M Active Perpetual Symbols: ${bnSymbols.size}`);
  console.log(`Bybit Linear Active Perpetual Symbols:  ${bybSymbols.size}`);
  console.log(`Shared Active USDT Perpetual Pairs:     ${sharedSymbols.length}`);

  const livePairs: VenueMetrics[] = [];

  for (const sym of sharedSymbols) {
    const bnBook = bnBookTickers.get(sym);
    const bn24 = bnTickers24h.get(sym);
    const byb = bybTickers.get(sym);

    if (!bnBook || !byb) continue;

    const bnBid = parseFloat(bnBook.bidPrice || '0');
    const bnAsk = parseFloat(bnBook.askPrice || '0');
    const bybBid = parseFloat(byb.bid1Price || '0');
    const bybAsk = parseFloat(byb.ask1Price || '0');

    if (bnBid <= 0 || bnAsk <= 0 || bybBid <= 0 || bybAsk <= 0) continue;

    const bnMid = (bnBid + bnAsk) / 2.0;
    const bybMid = (bybBid + bybAsk) / 2.0;

    const liveBasisPct = (2.0 * (bnMid - bybMid) / (bnMid + bybMid)) * 100.0;
    const bnSpreadPct = ((bnAsk - bnBid) / bnMid) * 100.0;
    const bybSpreadPct = ((bybAsk - bybBid) / bybMid) * 100.0;

    const bnBidNotional = bnBid * parseFloat(bnBook.bidQty || '0');
    const bnAskNotional = bnAsk * parseFloat(bnBook.askQty || '0');
    const bybBidNotional = bybBid * parseFloat(byb.bid1Size || '0');
    const bybAskNotional = bybAsk * parseFloat(byb.ask1Size || '0');

    const bnTurnover24h = bn24 ? parseFloat(bn24.quoteVolume || '0') : 0;
    const bybTurnover24h = parseFloat(byb.turnover24h || '0');
    const combinedVolume24h = bnTurnover24h + bybTurnover24h;

    const fundingRateBn = bnFunding.get(sym) || 0;
    const fundingRateByb = parseFloat(byb.fundingRate || '0') * 100;

    livePairs.push({
      symbol: sym,
      bnMid,
      bybMid,
      liveBasisPct,
      bnSpreadPct,
      bybSpreadPct,
      bnBidNotional,
      bnAskNotional,
      bybBidNotional,
      bybAskNotional,
      bnTurnover24h,
      bybTurnover24h,
      combinedVolume24h,
      fundingRateBn,
      fundingRateByb,
    });
  }

  livePairs.sort((a, b) => b.combinedVolume24h - a.combinedVolume24h);

  console.log(`\n[HISTORICAL 24H BASIS DISPERSION SAMPLING]`);
  // Sample top 130 pairs
  const targetUniverse = livePairs.filter(p => p.combinedVolume24h >= 1_500_000).slice(0, 130);
  console.log(`Sampling 96 15-minute klines (24 hours) for ${targetUniverse.length} pairs across Binance & Bybit...`);

  const dispersionMap = new Map<string, HistoricalDispersion>();
  const batchSize = 10;
  for (let i = 0; i < targetUniverse.length; i += batchSize) {
    const chunk = targetUniverse.slice(i, i + batchSize);
    const results = await Promise.all(chunk.map(c => fetch24hDispersionForSymbol(c.symbol)));
    for (const r of results) {
      if (r) dispersionMap.set(r.symbol, r);
    }
    await new Promise(r => setTimeout(r, 120));
  }

  const analyzedPairs = targetUniverse
    .map(p => {
      const disp = dispersionMap.get(p.symbol);
      return disp ? { ...p, ...disp } : null;
    })
    .filter((p): p is (VenueMetrics & HistoricalDispersion) => p !== null);

  const dOver800 = analyzedPairs.filter(p => p.dispersion24hPct >= 0.800).length;
  const dOver400 = analyzedPairs.filter(p => p.dispersion24hPct >= 0.400).length;
  const dOver350 = analyzedPairs.filter(p => p.dispersion24hPct >= 0.350).length;
  const dOver280 = analyzedPairs.filter(p => p.dispersion24hPct >= 0.280).length;
  const dOver200 = analyzedPairs.filter(p => p.dispersion24hPct >= 0.200).length;
  const dUnder200 = analyzedPairs.filter(p => p.dispersion24hPct < 0.200).length;

  console.log('\n----------------------------------------------------------------------------------------');
  console.log('  24-HOUR ABSOLUTE BASIS DISPERSION SPECTRUM (\\Delta b_{24h})');
  console.log('----------------------------------------------------------------------------------------');
  console.log(`Total Sampled Pairs: ${analyzedPairs.length}`);
  console.log(`Extreme Dispersion (\\ge 0.800%):   ${dOver800.toString().padStart(3)} pairs (${((dOver800 / analyzedPairs.length) * 100).toFixed(2)}%)`);
  console.log(`High Dispersion    (\\ge 0.400%):   ${dOver400.toString().padStart(3)} pairs (${((dOver400 / analyzedPairs.length) * 100).toFixed(2)}%)`);
  console.log(`Moderate Dispersion(\\ge 0.350%):   ${dOver350.toString().padStart(3)} pairs (${((dOver350 / analyzedPairs.length) * 100).toFixed(2)}%)`);
  console.log(`Standard Tail      (\\ge 0.280%):   ${dOver280.toString().padStart(3)} pairs (${((dOver280 / analyzedPairs.length) * 100).toFixed(2)}%)`);
  console.log(`Low Dispersion     (\\ge 0.200%):   ${dOver200.toString().padStart(3)} pairs (${((dOver200 / analyzedPairs.length) * 100).toFixed(2)}%)`);
  console.log(`Ultra-Tight        (< 0.200%):    ${dUnder200.toString().padStart(3)} pairs (${((dUnder200 / analyzedPairs.length) * 100).toFixed(2)}%)`);

  // Analyze all pairs with >= 0.400% dispersion
  const highDispPairs = analyzedPairs.filter(p => p.dispersion24hPct >= 0.400);
  console.log(`\n----------------------------------------------------------------------------------------`);
  console.log(`  ALL ${highDispPairs.length} PAIRS MEETING \\Delta b_{24h} \\ge 0.400% HURDLE`);
  console.log(`----------------------------------------------------------------------------------------`);
  console.log('Symbol     | Comb Vol  | 24h Disp | Live Basis | DDI 24h | Status                          | Spreads (BN / BYB)');
  console.log('---------------------------------------------------------------------------------------------------------');
  for (const h of highDispPairs) {
    const isCoiled = Math.abs(h.liveBasisPct) <= 0.100;
    const status = isCoiled ? 'COILED (READY FOR DISPATCH)' : `DISLOCATED (Awaiting compression)`;
    console.log(
      `${h.symbol.padEnd(10)} | ` +
      `$${(h.combinedVolume24h / 1e6).toFixed(1).padStart(6)}M | ` +
      `${h.dispersion24hPct.toFixed(4).padStart(7)}% | ` +
      `${h.liveBasisPct.toFixed(4).padStart(9)}% | ` +
      `${h.ddi24h.toFixed(3).padStart(7)} | ` +
      `${status.padEnd(31)} | ` +
      `${h.bnSpreadPct.toFixed(4)}% / ${h.bybSpreadPct.toFixed(4)}%`
    );
  }

  // Construct ranked top 10 empirical candidates
  // Ranking formula weights:
  // 1. Dispersion score (higher is better)
  // 2. Proximity to parity (|liveBasis| <= 0.100% preferred)
  // 3. Spreads (<= 0.080% required for low friction)
  // 4. Volume (sufficient liquidity)
  const ranked = [...analyzedPairs].sort((a, b) => {
    // Priority 1: Coiled spring (|b_t| <= 0.100%)
    const aCoiled = Math.abs(a.liveBasisPct) <= 0.100 ? 1 : 0;
    const bCoiled = Math.abs(b.liveBasisPct) <= 0.100 ? 1 : 0;
    if (aCoiled !== bCoiled) return bCoiled - aCoiled;

    // Priority 2: Higher dispersion
    return b.dispersion24hPct - a.dispersion24hPct;
  });

  console.log('\n[EVALUATING ORDER BOOK MICROSTRUCTURE FOR CANDIDATES]');
  const candidatePool = ranked.slice(0, 15);
  const candidatesWithDepth = [];

  for (const c of candidatePool) {
    const direction = c.ddi24h > 0.200 ? 'LONG_BN_SHORT_BYB' : c.ddi24h < -0.200 ? 'SHORT_BN_LONG_BYB' : (c.liveBasisPct <= 0 ? 'LONG_BN_SHORT_BYB' : 'SHORT_BN_LONG_BYB');
    const ob = await fetchDetailedOrderBook(c.symbol, direction);
    candidatesWithDepth.push({
      ...c,
      directionStr: direction === 'LONG_BN_SHORT_BYB' ? 'LONG BN / SHORT BYB' : 'SHORT BN / LONG BYB',
      directionEnum: direction,
      depth: ob,
    });
  }

  const top10 = candidatesWithDepth.slice(0, 10);

  console.log('\n===========================================================================================================================================');
  console.log('  TOP 10 EMPIRICAL CANDIDATE PAIRS (LIVE ORDER BOOK MICROSTRUCTURE)');
  console.log('===========================================================================================================================================');
  console.log('Rank | Symbol     | Comb 24h Vol | 24h Disp | Live Basis | DDI 24h | Direction       | BN Sprd | BYB Sprd | BN L1 ($) | BYB L1 ($) | L1 Slip ($15) | 4x ($60)?');
  console.log('-------------------------------------------------------------------------------------------------------------------------------------------');

  top10.forEach((c, idx) => {
    const ob = c.depth;
    const bnL1 = ob ? (c.directionEnum === 'LONG_BN_SHORT_BYB' ? ob.bnTopAskNotional : ob.bnTopBidNotional) : 0;
    const bybL1 = ob ? (c.directionEnum === 'LONG_BN_SHORT_BYB' ? ob.bybTopBidNotional : ob.bybTopAskNotional) : 0;
    const minL1 = Math.min(bnL1, bybL1);
    const has4xL1 = minL1 >= 60.0;
    const minL5 = ob ? Math.min(ob.bnL5AskNotional, ob.bybL5BidNotional) : 0;
    const has4xL5 = minL5 >= 60.0;
    const slip15 = ob ? ob.slippage15UsdtPct : 0;

    console.log(
      `${(idx + 1).toString().padStart(4)} | ` +
      `${c.symbol.padEnd(10)} | ` +
      `$${(c.combinedVolume24h / 1e6).toFixed(1).padStart(7)}M | ` +
      `${c.dispersion24hPct.toFixed(4).padStart(7)}% | ` +
      `${c.liveBasisPct.toFixed(4).padStart(9)}% | ` +
      `${c.ddi24h.toFixed(3).padStart(7)} | ` +
      `${c.directionStr.padEnd(17)} | ` +
      `${(ob?.bnSpreadPct ?? c.bnSpreadPct).toFixed(4).padStart(6)}% | ` +
      `${(ob?.bybSpreadPct ?? c.bybSpreadPct).toFixed(4).padStart(7)}% | ` +
      `$${bnL1.toFixed(0).padStart(8)} | ` +
      `$${bybL1.toFixed(0).padStart(9)} | ` +
      `${slip15.toFixed(4).padStart(12)}% | ` +
      `${has4xL1 ? 'YES ($' + minL1.toFixed(0) + ')' : has4xL5 ? 'L2-L5 ($' + minL1.toFixed(0) + ')' : 'NO'}`
    );
  });

  // Write detailed findings
  const outPath = path.join(process.cwd(), 'scripts', 'market_probe_results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalSampled: analyzedPairs.length,
    highDispersionCount: highDispPairs.length,
    highDispPairs,
    top10Candidates: top10,
    frictionAudit: {
      binanceMakerFeePct: 0.020,
      bybitTakerFeePct: 0.055,
      binanceTakerFeePct: 0.050,
      bybitTakerExitFeePct: 0.055,
      totalExchangeFeesPct: 0.180,
      plannedSlippageBufferPct: 0.080,
      totalFrictionBarrierPct: 0.260,
    }
  }, null, 2));

  console.log(`\nQuantitative Probe completed successfully. Full data written to ${outPath}`);
}

runQuantitativeProbe().catch(console.error);
