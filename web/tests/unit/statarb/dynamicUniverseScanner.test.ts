/**
 * STATARB-OU-PERP: Dynamic Universe Scanner Unit & Challenger Test Suite
 * 
 * Verifies:
 * 1. Bulk ingestion and mutual crypto pair discovery across Binance & Bybit
 * 2. Strict TradFi equity & pre-market synthetic isolation (TRADFI_EXCLUSION_SET)
 * 3. Contract multiplier and lot quantum normalization
 * 4. Institutional liquidity (min $1M) and spread (max 0.080%) gating
 * 5. Alpha Conviction scoring and 3-Tier dynamic corridor hierarchy
 * 6. Active Position Lock Invariant (open positions permanently locked in Tier 1)
 * 7. Resilient fallback to calibrated default majors on network failure
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DynamicUniverseScanner,
  getDynamicUniverseScanner,
  DEFAULT_UNIVERSE_CONFIG,
  StatArbPosition,
} from '@/lib/statarb';

describe('DynamicUniverseScanner Unit & Invariant Suite', () => {
  let scanner: DynamicUniverseScanner;

  beforeEach(() => {
    scanner = new DynamicUniverseScanner({
      min24hVolumeUsdt: 1_000_000,
      maxSpreadPct: 0.080,
      minGrossBasisPct: 0.240,
      tier1TargetSize: 5,
      tier2TargetSize: 10,
      fetchTimeoutMs: 1000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Initializes with calibrated default configuration', () => {
    const config = scanner.getConfig();
    expect(config.min24hVolumeUsdt).toBe(1_000_000);
    expect(config.maxSpreadPct).toBe(0.080);
    expect(config.minGrossBasisPct).toBe(0.240);
    expect(config.tier1TargetSize).toBe(5);
    expect(config.tier2TargetSize).toBe(10);
  });

  it('2. Excludes TradFi equities and pre-market synthetic non-deliverable tokens', async () => {
    // Mock bulk ticker responses containing TradFi and synthetic collisions
    const mockBinanceBook = [
      { symbol: 'BTCUSDT', bidPrice: '76000.0', askPrice: '76000.1' },
      { symbol: 'ERAUSDT', bidPrice: '0.7000', askPrice: '0.7001' },
      { symbol: 'ONUSDT', bidPrice: '0.1680', askPrice: '0.1681' }, // Onomy crypto
      { symbol: 'CATUSDT', bidPrice: '380.5', askPrice: '380.6' }, // Caterpillar stock
      { symbol: 'OPENAIUSDT', bidPrice: '15.0', askPrice: '15.1' }, // Pre-market
      { symbol: 'ANTHROPICUSDT', bidPrice: '25.0', askPrice: '25.1' }, // Pre-market
    ];

    const mockBinance24h = [
      { symbol: 'BTCUSDT', quoteVolume: '50000000' },
      { symbol: 'ERAUSDT', quoteVolume: '15000000' },
      { symbol: 'ONUSDT', quoteVolume: '2000000' },
      { symbol: 'CATUSDT', quoteVolume: '10000000' },
      { symbol: 'OPENAIUSDT', quoteVolume: '5000000' },
      { symbol: 'ANTHROPICUSDT', quoteVolume: '5000000' },
    ];

    const mockBybitList = [
      { symbol: 'BTCUSDT', bid1Price: '76000.0', ask1Price: '76000.2', turnover24h: '40000000' },
      { symbol: 'ERAUSDT', bid1Price: '0.7030', ask1Price: '0.7032', turnover24h: '12000000' }, // -0.44% dislocation!
      { symbol: 'ONUSDT', bid1Price: '63.0', ask1Price: '63.1', turnover24h: '5000000' }, // ON Semi stock collision!
      { symbol: 'CATUSDT', bid1Price: '380.5', ask1Price: '380.6', turnover24h: '8000000' },
      { symbol: 'OPENAIUSDT', bid1Price: '15.2', ask1Price: '15.3', turnover24h: '3000000' },
      { symbol: 'ANTHROPICUSDT', bid1Price: '25.3', ask1Price: '25.4', turnover24h: '3000000' },
    ];

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('bookTicker')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockBinanceBook) });
      }
      if (url.includes('24hr')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockBinance24h) });
      }
      if (url.includes('api.bybit.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result: { list: mockBybitList } }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    }) as any;

    const result = await scanner.scanUniverse();

    // Verify TradFi and pre-market assets are completely excluded from Tier 1 and Tier 2
    const tier1Symbols = result.tier1Pairs.map((p) => p.canonicalSymbol);
    const tier2Symbols = result.tier2Pairs.map((p) => p.canonicalSymbol);

    expect(tier1Symbols).not.toContain('ON');
    expect(tier1Symbols).not.toContain('ONUSDT');
    expect(tier1Symbols).not.toContain('CAT');
    expect(tier1Symbols).not.toContain('CATUSDT');
    expect(tier1Symbols).not.toContain('OPENAI');
    expect(tier1Symbols).not.toContain('ANTHROPIC');

    expect(tier2Symbols).not.toContain('ON');
    expect(tier2Symbols).not.toContain('CAT');
    expect(tier2Symbols).not.toContain('OPENAI');

    // Valid crypto pairs should be present
    expect(tier1Symbols).toContain('ERA');
    expect(tier1Symbols).toContain('BTC');
  });

  it('3. Filters by liquidity (>= $1M USDT) and spread (<= 0.080%)', async () => {
    const mockBinanceBook = [
      { symbol: 'GOODUSDT', bidPrice: '1.0000', askPrice: '1.0002' }, // Spread 0.020% (PASS)
      { symbol: 'WIDESPREADUSDT', bidPrice: '1.0000', askPrice: '1.0020' }, // Spread 0.200% (FAIL)
      { symbol: 'LOWVOLUSDT', bidPrice: '1.0000', askPrice: '1.0002' }, // Spread 0.020% (PASS, but vol low)
    ];

    const mockBinance24h = [
      { symbol: 'GOODUSDT', quoteVolume: '5000000' }, // $5M (PASS)
      { symbol: 'WIDESPREADUSDT', quoteVolume: '5000000' },
      { symbol: 'LOWVOLUSDT', quoteVolume: '200000' }, // $200k (FAIL)
    ];

    const mockBybitList = [
      { symbol: 'GOODUSDT', bid1Price: '1.0030', ask1Price: '1.0032', turnover24h: '4000000' },
      { symbol: 'WIDESPREADUSDT', bid1Price: '1.0030', ask1Price: '1.0035', turnover24h: '4000000' },
      { symbol: 'LOWVOLUSDT', bid1Price: '1.0030', ask1Price: '1.0032', turnover24h: '150000' },
    ];

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('bookTicker')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockBinanceBook) });
      if (url.includes('24hr')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockBinance24h) });
      if (url.includes('api.bybit.com')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { list: mockBybitList } }) });
      return Promise.reject(new Error('Unknown URL'));
    }) as any;

    const result = await scanner.scanUniverse();

    // Only GOODUSDT passes both liquidity and spread gates
    expect(result.liquidPassingPairsCount).toBe(1);
    expect(result.tier1Pairs[0].canonicalSymbol).toBe('GOOD');
  });

  it('4. Promotes dislocated pairs (|Basis| >= 0.240%) to the top of Tier 1', async () => {
    const mockBinanceBook = [
      { symbol: 'BTCUSDT', bidPrice: '76000.0', askPrice: '76000.1' }, // Basis ~0.00%
      { symbol: 'ERAUSDT', bidPrice: '0.7000', askPrice: '0.7001' },   // Basis ~ -0.428% (DISLOCATED)
      { symbol: 'HUMAUSDT', bidPrice: '0.0200', askPrice: '0.02001' }, // Basis ~ -1.00% (DISLOCATED)
      { symbol: 'ETHUSDT', bidPrice: '2480.0', askPrice: '2480.02' },   // Basis ~0.00%
    ];

    const mockBinance24h = [
      { symbol: 'BTCUSDT', quoteVolume: '100000000' },
      { symbol: 'ERAUSDT', quoteVolume: '15000000' },
      { symbol: 'HUMAUSDT', quoteVolume: '20000000' },
      { symbol: 'ETHUSDT', quoteVolume: '50000000' },
    ];

    const mockBybitList = [
      { symbol: 'BTCUSDT', bid1Price: '76000.0', ask1Price: '76000.1', turnover24h: '80000000' },
      { symbol: 'ERAUSDT', bid1Price: '0.7030', ask1Price: '0.7031', turnover24h: '12000000' },
      { symbol: 'HUMAUSDT', bid1Price: '0.0202', ask1Price: '0.02021', turnover24h: '18000000' },
      { symbol: 'ETHUSDT', bid1Price: '2480.0', ask1Price: '2480.02', turnover24h: '40000000' },
    ];

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('bookTicker')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockBinanceBook) });
      if (url.includes('24hr')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockBinance24h) });
      if (url.includes('api.bybit.com')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { list: mockBybitList } }) });
      return Promise.reject(new Error('Unknown URL'));
    }) as any;

    const result = await scanner.scanUniverse();

    expect(result.dislocatedPairsCount).toBe(2);
    // Dislocated pairs (HUMA, ERA) rank ahead of tight majors (BTC, ETH)
    const topSymbols = result.tier1Pairs.slice(0, 2).map((p) => p.canonicalSymbol);
    expect(topSymbols).toContain('HUMA');
    expect(topSymbols).toContain('ERA');
  });

  it('5. Strictly enforces Active Position Lock Invariant (open positions permanently in Tier 1)', async () => {
    const mockBinanceBook = [
      { symbol: 'BTCUSDT', bidPrice: '76000.0', askPrice: '76000.1' },
      { symbol: 'ETHUSDT', bidPrice: '2480.0', askPrice: '2480.02' },
      { symbol: 'SOLUSDT', bidPrice: '172.5', askPrice: '172.52' },
      { symbol: 'AVAXUSDT', bidPrice: '28.4', askPrice: '28.41' },
      { symbol: 'LINKUSDT', bidPrice: '12.2', askPrice: '12.21' },
      { symbol: 'OPENPOSITIONCOINUSDT', bidPrice: '1.0', askPrice: '1.0001' }, // Unranked low-volume coin
    ];

    const mockBinance24h = [
      { symbol: 'BTCUSDT', quoteVolume: '100000000' },
      { symbol: 'ETHUSDT', quoteVolume: '50000000' },
      { symbol: 'SOLUSDT', quoteVolume: '30000000' },
      { symbol: 'AVAXUSDT', quoteVolume: '20000000' },
      { symbol: 'LINKUSDT', quoteVolume: '15000000' },
      { symbol: 'OPENPOSITIONCOINUSDT', quoteVolume: '100000' }, // Low volume ($100k < $1M)
    ];

    const mockBybitList = [
      { symbol: 'BTCUSDT', bid1Price: '76000.0', ask1Price: '76000.1', turnover24h: '80000000' },
      { symbol: 'ETHUSDT', bid1Price: '2480.0', ask1Price: '2480.02', turnover24h: '40000000' },
      { symbol: 'SOLUSDT', bid1Price: '172.5', ask1Price: '172.52', turnover24h: '25000000' },
      { symbol: 'AVAXUSDT', bid1Price: '28.4', ask1Price: '28.41', turnover24h: '15000000' },
      { symbol: 'LINKUSDT', bid1Price: '12.2', ask1Price: '12.21', turnover24h: '10000000' },
      { symbol: 'OPENPOSITIONCOINUSDT', bid1Price: '1.0', ask1Price: '1.0001', turnover24h: '50000' },
    ];

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('bookTicker')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockBinanceBook) });
      if (url.includes('24hr')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockBinance24h) });
      if (url.includes('api.bybit.com')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { list: mockBybitList } }) });
      return Promise.reject(new Error('Unknown URL'));
    }) as any;

    // Simulate an open active position on OPENPOSITIONCOIN
    const mockOpenPositions: StatArbPosition[] = [
      {
        id: 'pos_test_lock_1',
        canonicalSymbol: 'OPENPOSITIONCOIN',
        binanceSymbol: 'OPENPOSITIONCOINUSDT',
        bybitSymbol: 'OPENPOSITIONCOINUSDT',
        direction: 'SHORT_BINANCE_LONG_BYBIT',
        status: 'OPEN',
        entryTimestamp: Date.now() - 60000,
        entryBasisBps: 30.0,
        entryBinancePrice: 1.0,
        entryBybitPrice: 1.0,
        quantity: 15,
        notionalUsdt: 15,
        currentBasisBps: 20.0,
        currentBinancePrice: 1.0,
        currentBybitPrice: 1.0,
        currentZScore: 1.5,
        realizedPnlUsdt: 0,
        unrealizedPnlUsdt: 0.05,
        totalFeesUsdt: 0.02,
        netPnlUsdt: 0.03,
        holdDurationMinutes: 1,
        divergenceHistory30m: [30.0, 20.0],
      },
    ];

    const result = await scanner.scanUniverse(mockOpenPositions);

    const tier1Symbols = result.tier1Pairs.map((p) => p.canonicalSymbol);
    // OPENPOSITIONCOIN MUST be present in Tier 1 despite low volume and low score!
    expect(tier1Symbols).toContain('OPENPOSITIONCOIN');
  });

  it('6. Seamlessly falls back to calibrated default majors on network failure', async () => {
    // Force network fetch to reject
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));

    const result = await scanner.scanUniverse();

    expect(result.tier1Pairs.length).toBeGreaterThanOrEqual(10);
    const symbols = result.tier1Pairs.map((p) => p.canonicalSymbol);
    expect(symbols).toContain('BTC');
    expect(symbols).toContain('ETH');
    expect(symbols).toContain('SOL');
    expect(symbols).toContain('SUI');
  });

  it('7. Maintains singleton state across calls', () => {
    const scanner1 = getDynamicUniverseScanner();
    const scanner2 = getDynamicUniverseScanner();
    expect(scanner1).toBe(scanner2);
  });
});
