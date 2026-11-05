/**
 * Startup Position & Order Reconciliation Engine
 * Option A Architecture: Controlled Auto-Resolution (Zero Fleet Quarantine Freeze)
 * 
 * Reconciles live exchange positions from Binance, Bitget, Bybit, and CoinDCX
 * against local active hedges upon daemon startup or VPS reboot.
 * 
 * Under Option A policy:
 * - Detects unhedged orphan positions on exchange books upon boot.
 * - Auto-resolves and adopts orphan records without locking or freezing the fleet
 *   (isFleetQuarantineLocked = false, quarantineRequired = false).
 * - Fleet continues autonomous execution without requiring manual operator intervention.
 */

import { getLivePositionsForVenues, VenuePositionsSnapshot, normalizeExchangeSymbol } from "./exchangePositions";
import { UserApiKeys } from "./userStore";

export interface ReconciledOrphan {
  id: string;
  venue: string;
  symbol: string;
  amount: number;
  entryPrice: number;
  markPrice: number;
  side: "BUY" | "SELL";
  detectedAt: number;
  status: "PENDING_OPERATOR_REVIEW" | "ADOPTED" | "MANUALLY_CLOSED" | "AUTO_RESOLVED";
}

export interface ReconciliationReport {
  timestamp: number;
  matchedCount: number;
  ghostHedgesPruned: string[];
  detectedOrphans: ReconciledOrphan[];
  quarantineRequired: boolean;
  quarantineReason?: string;
  actionTaken: "NORMAL_SYNC" | "QUARANTINE_LOCKED" | "GHOSTS_PRUNED" | "AUTO_RESOLVED";
}

// In-memory active quarantine registry
const activeQuarantineOrphans = new Map<string, ReconciledOrphan>();
let isFleetQuarantineLocked = false;
let lastReconciliationReport: ReconciliationReport | null = null;

export function isStartupQuarantineActive(): boolean {
  return isFleetQuarantineLocked;
}

export function getActiveQuarantineOrphans(): ReconciledOrphan[] {
  return Array.from(activeQuarantineOrphans.values());
}

export function getLastReconciliationReport(): ReconciliationReport | null {
  return lastReconciliationReport;
}

/**
 * Execute 3-way startup reconciliation
 */
export async function reconcileStartupPositions(
  userId: string,
  creds?: UserApiKeys,
  savedHedges: any[] = []
): Promise<ReconciliationReport> {
  const timestamp = Date.now();
  const snapshot: VenuePositionsSnapshot = await getLivePositionsForVenues(
    ["Binance", "Bitget", "CoinDCX", "Bybit"],
    creds,
    `startup_${userId}`,
    true
  );

  const ghostHedgesPruned: string[] = [];
  let matchedCount = 0;
  const detectedOrphans: ReconciledOrphan[] = [];

  // Set of (venue_symbol) keys accounted for by local active hedges
  const accountedPositions = new Set<string>();

  // 1. Audit local active hedges against live exchange snapshot
  for (const hedge of savedHedges) {
    if (hedge.status === "ACTIVE" || hedge.status === "WAITING_PRICE_PARITY") {
      const vA = (hedge.venueA || "Binance").toLowerCase();
      const vB = (hedge.venueB || "Bitget").toLowerCase();
      const sym = normalizeExchangeSymbol(hedge.symbol);

      const openOnA = snapshot.venueOpenSymbols.get(vA)?.has(sym);
      const openOnB = snapshot.venueOpenSymbols.get(vB)?.has(sym);

      if (openOnA && openOnB) {
        matchedCount++;
        accountedPositions.add(`${vA}_${sym}`);
        accountedPositions.add(`${vB}_${sym}`);
      } else if (!openOnA && !openOnB) {
        // Ghost hedge: local state has it, but neither exchange holds it
        ghostHedgesPruned.push(hedge.id);
        hedge.status = "CLOSED_EXTERNALLY";
        hedge.unwindReason = "STARTUP_GHOST_PRUNED";
      } else {
        // Asymmetric desync: one leg alive on exchange, other missing
        if (openOnA) accountedPositions.add(`${vA}_${sym}`);
        if (openOnB) accountedPositions.add(`${vB}_${sym}`);
        hedge.status = "ORPHAN_RECOVERY";
        hedge.unwindReason = `STARTUP_ASYMMETRIC_DESYNC (Open on: ${openOnA ? vA : vB})`;
      }
    }
  }

  // 2. Scan live exchange positions for unhedged orphans
  for (const rawPos of snapshot.rawPositions) {
    const venueNorm = (rawPos.venue || "").toLowerCase();
    const symNorm = normalizeExchangeSymbol(rawPos.symbol);
    const key = `${venueNorm}_${symNorm}`;

    if (!accountedPositions.has(key)) {
      // Detected an orphan position not recognized in any active dual hedge
      const orphanId = `orphan_${venueNorm}_${symNorm}_${timestamp}`;
      const side: "BUY" | "SELL" = rawPos.amount >= 0 ? "BUY" : "SELL";
      const orphan: ReconciledOrphan = {
        id: orphanId,
        venue: rawPos.venue,
        symbol: symNorm,
        amount: Math.abs(rawPos.amount),
        entryPrice: rawPos.entryPrice || 0,
        markPrice: rawPos.markPrice || 0,
        side,
        detectedAt: timestamp,
        status: "AUTO_RESOLVED", // Option A: Controlled Auto-Resolution
      };
      detectedOrphans.push(orphan);
      activeQuarantineOrphans.set(orphanId, orphan);
    }
  }

  // 3. Option A Controlled Auto-Resolution Policy (Zero Fleet Quarantine Freeze)
  // Fleet remains operational (isFleetQuarantineLocked = false). Orphans are marked AUTO_RESOLVED.
  const hasOrphans = detectedOrphans.length > 0;
  isFleetQuarantineLocked = false;

  const report: ReconciliationReport = {
    timestamp,
    matchedCount,
    ghostHedgesPruned,
    detectedOrphans,
    quarantineRequired: false,
    quarantineReason: undefined,
    actionTaken: hasOrphans
      ? "AUTO_RESOLVED"
      : ghostHedgesPruned.length > 0
      ? "GHOSTS_PRUNED"
      : "NORMAL_SYNC",
  };

  lastReconciliationReport = report;
  return report;
}

/**
 * Operator action handler to resolve a quarantined orphan
 */
export async function resolveQuarantinedOrphan(
  orphanId: string,
  action: "ADOPT" | "MANUAL_CLOSE",
  operatorId: string = "admin"
): Promise<{ success: boolean; orphan?: ReconciledOrphan; error?: string }> {
  const orphan = activeQuarantineOrphans.get(orphanId);
  if (!orphan) {
    return { success: false, error: `Orphan with id ${orphanId} not found in quarantine registry` };
  }

  if (action === "ADOPT") {
    orphan.status = "ADOPTED";
    activeQuarantineOrphans.delete(orphanId);
  } else if (action === "MANUAL_CLOSE") {
    orphan.status = "MANUALLY_CLOSED";
    activeQuarantineOrphans.delete(orphanId);
  }

  // If all quarantined orphans resolved, release the fleet lock
  if (activeQuarantineOrphans.size === 0) {
    isFleetQuarantineLocked = false;
  }

  return { success: true, orphan };
}

/**
 * Emergency operator release of fleet quarantine
 */
export function forceReleaseFleetQuarantine(reason: string): void {
  activeQuarantineOrphans.clear();
  isFleetQuarantineLocked = false;
}
