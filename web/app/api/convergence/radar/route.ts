import { NextRequest, NextResponse } from "next/server";
import {
  getInstrumentMapping,
  calibrateOrnsteinUhlenbeck,
  calculateBasisBps,
  calculateZScore,
  evaluateEntryGates,
  checkInvariant7StickyDecoupling,
  StatArbPair,
  OUParameters,
  DEFAULT_OU_PRIORS,
  StatArbStateStore,
  getDynamicUniverseScanner,
} from "@/lib/statarb";

export const dynamic = "force-dynamic";

declare global {
  // eslint-disable-next-line no-var
  var __statArbStore: StatArbStateStore | undefined;
  // eslint-disable-next-line no-var
  var __radarCache: { timestamp: number; data: unknown } | undefined;
  // eslint-disable-next-line no-var
  var __radarSpreadHistory: Map<string, number[]> | undefined;
}

function getRollingHistoryMap(): Map<string, number[]> {
  if (!globalThis.__radarSpreadHistory) {
    globalThis.__radarSpreadHistory = new Map<string, number[]>();
  }
  return globalThis.__radarSpreadHistory;
}

function getStore(): StatArbStateStore {
  if (!globalThis.__statArbStore) {
    globalThis.__statArbStore = new StatArbStateStore();
  }
  return globalThis.__statArbStore;
}

interface MonitoredConfig {
  canonical: string;
  basePrice: number;
  baseSpreadBps: number;
  theta: number;
  sigma: number;
  tier: "TIER 1" | "HIGH BETA" | "MEME COIN";
}

const DEFAULT_MONITORED: MonitoredConfig[] = [
  { canonical: "BTC", basePrice: 68500.0, baseSpreadBps: 2.5, theta: 0.12, sigma: 14.5, tier: "TIER 1" },
  { canonical: "ETH", basePrice: 2480.0, baseSpreadBps: 3.2, theta: 0.10, sigma: 18.0, tier: "TIER 1" },
  { canonical: "SOL", basePrice: 172.5, baseSpreadBps: 4.0, theta: 0.14, sigma: 22.0, tier: "TIER 1" },
  { canonical: "PEPE", basePrice: 0.0000098, baseSpreadBps: 29.5, theta: 0.22, sigma: 38.0, tier: "MEME COIN" },
  { canonical: "SATS", basePrice: 0.000285, baseSpreadBps: 31.0, theta: 0.20, sigma: 35.0, tier: "MEME COIN" },
  { canonical: "NEAR", basePrice: 4.85, baseSpreadBps: 18.5, theta: 0.15, sigma: 24.0, tier: "HIGH BETA" },
  { canonical: "SUI", basePrice: 2.15, baseSpreadBps: 21.0, theta: 0.18, sigma: 26.5, tier: "HIGH BETA" },
  { canonical: "AVAX", basePrice: 28.4, baseSpreadBps: 12.0, theta: 0.13, sigma: 21.0, tier: "TIER 1" },
  { canonical: "DOGE", basePrice: 0.165, baseSpreadBps: 15.0, theta: 0.16, sigma: 25.0, tier: "MEME COIN" },
  { canonical: "ARB", basePrice: 0.58, baseSpreadBps: 14.5, theta: 0.14, sigma: 23.0, tier: "HIGH BETA" },
  { canonical: "OP", basePrice: 1.62, baseSpreadBps: 16.0, theta: 0.15, sigma: 24.0, tier: "HIGH BETA" },
  { canonical: "LINK", basePrice: 12.2, baseSpreadBps: 9.5, theta: 0.11, sigma: 17.5, tier: "TIER 1" },
  { canonical: "APT", basePrice: 9.4, baseSpreadBps: 17.0, theta: 0.14, sigma: 22.5, tier: "HIGH BETA" },
  { canonical: "XRP", basePrice: 0.54, baseSpreadBps: 7.0, theta: 0.09, sigma: 15.0, tier: "TIER 1" },
  { canonical: "ADA", basePrice: 0.36, baseSpreadBps: 8.5, theta: 0.10, sigma: 16.0, tier: "TIER 1" },
];

export async function GET(req: NextRequest) {
  try {
    const store = getStore();
    const config = store.getState().config;
    const now = Date.now();

    // In-memory 2,500ms cache to guarantee optimal exchange rate limit conservation
    if (globalThis.__radarCache && (now - globalThis.__radarCache.timestamp < 2500)) {
      return NextResponse.json(globalThis.__radarCache.data);
    }

    // Dynamic Universe Discovery across all mutual Binance & Bybit perpetuals
    const scanner = getDynamicUniverseScanner();
    const universeOutput = await scanner.scanUniverse(store.getState().positions);

    const radarItems = [];
    const statArbPairs: StatArbPair[] = [];

    for (const pair of universeOutput.tier1Pairs) {
      statArbPairs.push(pair);
      const ouParams = universeOutput.ouParamsMap.get(pair.canonicalSymbol) || {
        theta: 0.12,
        mu: 0.0,
        sigma: 15.0,
        halfLifeMinutes: 5.8,
        equilibriumSigma: 21.65,
        rSquared: 0.88,
        sampleCount: 120,
        lastUpdated: now,
      };

      const zScore = universeOutput.zScoreMap.get(pair.canonicalSymbol) ?? calculateZScore(pair.grossBasisBps, ouParams);
      const gateResult = evaluateEntryGates(pair, ouParams, config.entryGate);

      // Invariant 7 evaluation from rolling divergence history (active only when invariant7Enabled is true)
      const isInv7Enabled = config.invariant7Enabled !== false;
      const history30m = universeOutput.rollingHistoryMap.get(pair.canonicalSymbol) || [];
      const stickyCheck = checkInvariant7StickyDecoupling(history30m);

      const zGatePassed = Math.abs(zScore) >= config.entryGate.minZScore;
      const basisGatePassed = Math.abs(pair.grossBasisBps) >= config.entryGate.minGrossBasisBps;
      const depthGatePassed = pair.orderBookDepthRatio >= config.entryGate.minDepthRatio;
      const spreadGatePassed =
        pair.binanceSpreadBps <= config.entryGate.maxSpreadBps &&
        pair.bybitSpreadBps <= config.entryGate.maxSpreadBps;
      const inv7GatePassed = !isInv7Enabled || stickyCheck.passed;
      const minNetEdgeBps = config.entryGate.minNetEdgeBps !== undefined ? config.entryGate.minNetEdgeBps : 8.0;
      const netEdgeGatePassed = (gateResult.netExpectedEdgeBps ?? 0) >= minNetEdgeBps;

      const allGatesPassed =
        zGatePassed &&
        basisGatePassed &&
        depthGatePassed &&
        spreadGatePassed &&
        inv7GatePassed &&
        netEdgeGatePassed;

      const direction = pair.grossBasisBps >= 0 ? "SHORT_BINANCE_LONG_BYBIT" : "SHORT_BYBIT_LONG_BINANCE";

      radarItems.push({
        canonicalSymbol: pair.canonicalSymbol,
        binanceSymbol: pair.binanceSymbol,
        bybitSymbol: pair.bybitSymbol,
        multiplier: pair.multiplier,
        tier: Math.abs(pair.grossBasisBps) >= 24.0 ? "DISLOCATED" : "CORRIDOR",
        binanceMid: pair.binanceMid,
        bybitMid: pair.bybitMid,
        grossBasisBps: pair.grossBasisBps,
        ouTheta: ouParams.theta,
        halfLifeMinutes: ouParams.halfLifeMinutes,
        equilibriumSigma: ouParams.equilibriumSigma,
        zScore,
        depthRatio: pair.orderBookDepthRatio,
        binanceSpreadBps: pair.binanceSpreadBps,
        bybitSpreadBps: pair.bybitSpreadBps,
        direction,
        gateBadges: {
          zScore: zGatePassed,
          basis: basisGatePassed,
          depth: depthGatePassed,
          spread: spreadGatePassed,
          invariant7: inv7GatePassed,
          invariant7Enabled: isInv7Enabled,
          netEdge: netEdgeGatePassed,
          allPassed: allGatesPassed,
        },
        reasons: gateResult.reasons,
        lastUpdated: now,
      });
    }

    // Sort by absolute Z-score descending so highest conviction opportunities appear first
    radarItems.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

    // Update monitored pairs in state store
    store.updateMonitoredPairs(statArbPairs);

    const responsePayload = {
      success: true,
      monitoredCount: radarItems.length,
      qualifyingCount: radarItems.filter((r) => r.gateBadges.allPassed).length,
      pairs: radarItems,
      timestamp: now,
    };

    // Cache response for 2,500ms
    globalThis.__radarCache = {
      timestamp: now,
      data: responsePayload,
    };

    return NextResponse.json(responsePayload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate radar scan";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
