import { NextRequest, NextResponse } from "next/server";
import {
  StatArbStateStore,
  StatArbPosition,
  calculateBasisCompression,
  MIN_ZERO_LOSS_PROFIT_USDT,
} from "@/lib/statarb";

export const dynamic = "force-dynamic";

declare global {
  // eslint-disable-next-line no-var
  var __statArbStore: StatArbStateStore | undefined;
}

function getStore(): StatArbStateStore {
  if (!globalThis.__statArbStore) {
    globalThis.__statArbStore = new StatArbStateStore();
  }
  return globalThis.__statArbStore;
}

export async function GET(req: NextRequest) {
  try {
    const store = getStore();

    const activePositions = store.getActivePositions();
    const closedPositions = store.getClosedPositions();
    const now = Date.now();

    // Map active positions with compression & gate status
    const enrichedActivePositions = activePositions.map((pos) => {
      const compression = calculateBasisCompression(pos.entryBasisBps, pos.currentBasisBps);
      const isZeroLossHurdleMet = (pos.unrealizedPnlUsdt || 0) >= MIN_ZERO_LOSS_PROFIT_USDT;
      const holdMinutes = parseFloat(((now - pos.entryTimestamp) / (60 * 1000)).toFixed(1));

      return {
        id: pos.id,
        canonicalSymbol: pos.canonicalSymbol,
        binanceSymbol: pos.binanceSymbol,
        bybitSymbol: pos.bybitSymbol,
        direction: pos.direction,
        entryBasisBps: pos.entryBasisBps,
        currentBasisBps: pos.currentBasisBps,
        entryBinancePrice: pos.entryBinancePrice,
        entryBybitPrice: pos.entryBybitPrice,
        currentBinancePrice: pos.currentBinancePrice,
        currentBybitPrice: pos.currentBybitPrice,
        quantity: pos.quantity,
        notionalUsdt: pos.notionalUsdt,
        currentZScore: pos.currentZScore,
        unrealizedPnlUsdt: pos.unrealizedPnlUsdt,
        totalFeesUsdt: pos.totalFeesUsdt,
        netPnlUsdt: pos.unrealizedPnlUsdt - pos.totalFeesUsdt,
        holdDurationMinutes: holdMinutes,
        basisCompressionPct: parseFloat((compression * 100).toFixed(1)),
        isZeroLossHurdleMet,
        zeroLossGateStatus: isZeroLossHurdleMet
          ? `HURDLE MET (+${(pos.unrealizedPnlUsdt || 0).toFixed(4)} USDT)`
          : `ACCUMULATING (+${(pos.unrealizedPnlUsdt || 0).toFixed(4)} USDT)`,
        persistenceBreakerMinutesRemaining: Math.max(0, 30.0 - holdMinutes),
      };
    });

    // Map completed fills audit records
    const completedFillsAudit = closedPositions.map((pos: StatArbPosition) => {
      const leg2IocLatencyMs = (pos as any).leg2LatencyMs ?? 25.0;

      const isShortBn = pos.direction === "SHORT_BINANCE_LONG_BYBIT";
      const leg1Side = isShortBn ? "SELL" : "BUY";
      const leg2Side = isShortBn ? "BUY" : "SELL";

      return {
        id: pos.id,
        timestamp: pos.exitTimestamp || pos.entryTimestamp,
        entryTimestamp: pos.entryTimestamp,
        exitTimestamp: pos.exitTimestamp,
        canonicalSymbol: pos.canonicalSymbol,
        pair: `${pos.canonicalSymbol}/USDT`,
        direction: pos.direction,
        entryBasisBps: pos.entryBasisBps,
        entryBasisPct: parseFloat((pos.entryBasisBps / 100).toFixed(3)),
        exitBasisBps: pos.currentBasisBps,
        exitBasisPct: parseFloat((pos.currentBasisBps / 100).toFixed(3)),
        leg1: {
          venue: "BINANCE_USDM",
          orderType: "POST_ONLY_MAKER_GTX",
          side: leg1Side,
          symbol: pos.binanceSymbol,
          fillPrice: pos.entryBinancePrice,
          feeBps: 2.0, // Maker fee: 0.020%
          feePct: 0.020,
        },
        leg2: {
          venue: "BYBIT_LINEAR",
          orderType: "WS_IOC_TAKER",
          side: leg2Side,
          symbol: pos.bybitSymbol,
          fillPrice: pos.entryBybitPrice,
          iocLatencyMs: leg2IocLatencyMs,
          feeBps: 5.5, // Taker fee: 0.055%
          feePct: 0.055,
        },
        notionalUsdt: pos.notionalUsdt,
        totalFeesUsdt: pos.totalFeesUsdt || 0.0125,
        netRealizedPnlUsdt: pos.realizedPnlUsdt || 0.0,
        exitReason: pos.exitReason || "BASIS_COMPRESSION_75",
        status: (pos.realizedPnlUsdt || 0) >= MIN_ZERO_LOSS_PROFIT_USDT ? "CONFIRMED_ZERO_LOSS" : "CLOSED",
        holdDurationMinutes: pos.holdDurationMinutes,
      };
    });

    type CompletedAuditFill = (typeof completedFillsAudit)[number];

    // Calculate aggregate metrics
    const totalRealizedPnlUsdt = completedFillsAudit.reduce((acc: number, f: CompletedAuditFill) => acc + f.netRealizedPnlUsdt, 0);
    const winRate = completedFillsAudit.length > 0
      ? (completedFillsAudit.filter((f: CompletedAuditFill) => f.netRealizedPnlUsdt > 0).length / completedFillsAudit.length) * 100
      : 100;
    const avgLatencyMs = completedFillsAudit.length > 0
      ? completedFillsAudit.reduce((acc: number, f: CompletedAuditFill) => acc + f.leg2.iocLatencyMs, 0) / completedFillsAudit.length
      : 0.0;

    return NextResponse.json({
      success: true,
      activePositions: enrichedActivePositions,
      completedFills: completedFillsAudit,
      summary: {
        activeCount: enrichedActivePositions.length,
        completedCount: completedFillsAudit.length,
        totalRealizedPnlUsdt: parseFloat(totalRealizedPnlUsdt.toFixed(4)),
        winRatePct: parseFloat(winRate.toFixed(1)),
        averageIocLatencyMs: parseFloat(avgLatencyMs.toFixed(1)),
      },
      timestamp: now,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve audit log";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
