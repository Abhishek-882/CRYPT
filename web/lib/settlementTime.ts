/**
 * Deterministic UTC funding settlement calculator for Binance & Bitget Perpetual Futures.
 * Supports dynamic multi-cycle funding intervals:
 * - 8h Standard: 00:00:00, 08:00:00, 16:00:00 UTC (3 payouts/day)
 * - 4h High-Vol: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC (6 payouts/day)
 * - 2h Rapid: Every 2 hours (12 payouts/day)
 * - 1h Hyper: Every hour on the hour (24 payouts/day)
 */

export function getDeterministicNextFundingTime(
  nowMs: number = Date.now(),
  intervalHours: number = 8
): number {
  const d = new Date(nowMs);
  const curUtcHours = d.getUTCHours();
  const validInterval = Math.max(1, Math.min(24, Math.floor(intervalHours || 8)));

  const nextMultiple = Math.floor(curUtcHours / validInterval) * validInterval + validInterval;
  const nextHour = nextMultiple % 24;
  const dayOffset = Math.floor(nextMultiple / 24);

  const target = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() + dayOffset,
      nextHour,
      0,
      0,
      0
    )
  );

  // Ensure target is strictly in the future even at boundary milliseconds
  while (target.getTime() <= nowMs) {
    target.setUTCHours(target.getUTCHours() + validInterval);
  }

  return target.getTime();
}

export function formatCountdown(
  targetMs: number,
  nowMs: number = Date.now(),
  intervalHours: number = 8
): string {
  let effectiveTarget = targetMs;
  // Support 10-digit unix timestamps in seconds
  if (effectiveTarget > 0 && effectiveTarget < 1e11) {
    effectiveTarget = effectiveTarget * 1000;
  }
  // If target is missing, not a number, or has already elapsed, roll over to the next future settlement
  if (!effectiveTarget || isNaN(effectiveTarget) || effectiveTarget <= nowMs) {
    effectiveTarget = getDeterministicNextFundingTime(nowMs, intervalHours);
  }
  const diff = Math.max(0, effectiveTarget - nowMs);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function getPayoutsPerDay(intervalHours: number = 8): number {
  const validInterval = Math.max(1, Math.min(24, Math.floor(intervalHours || 8)));
  return 24 / validInterval;
}

export function getSettlementCycleLabel(intervalHours: number = 8): string {
  const validInterval = Math.max(1, Math.min(24, Math.floor(intervalHours || 8)));
  return `${validInterval}h Cycle`;
}

export function calculateAnnualizedYield(spreadBps: number, intervalHours: number = 8): number {
  const payoutsPerDay = getPayoutsPerDay(intervalHours);
  return parseFloat(((Math.abs(spreadBps) * 0.01 * payoutsPerDay * 365)).toFixed(2));
}
