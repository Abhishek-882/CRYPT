/**
 * Liquidation & Dynamic Stop-Loss Calculator
 * Option B Locked Architecture: Dynamic Liquidation Buffer Stop Loss
 * 
 * In dual-venue arbitrage and basis funding collection, rigid dollar cuts (e.g. fixed $50)
 * cut winning convergence trades prematurely during normal basis spread expansion (MAE breathing room rule).
 * 
 * Instead, this module computes broker-side disaster stop levels dynamically at 40-50% of the
 * distance between entry price and exchange liquidation price. This guarantees hardware protection
 * against exchange liquidation cascades while preserving quantitative breathing room for convergence.
 */

export interface DynamicStopLossResult {
  entryPrice: number;
  leverage: number;
  positionSide: "BUY" | "SELL";
  stopSide: "BUY" | "SELL";
  estimatedLiquidationPrice: number;
  stopPrice: number;
  distanceToLiquidationPct: number;
  stopDistancePct: number;
}

/**
 * Compute the dynamic liquidation buffer stop-loss price for a crypto futures position.
 * 
 * @param positionSide "BUY" for Long, "SELL" for Short
 * @param entryPrice Average entry price of the filled leg
 * @param leverage Venue leverage (e.g. 5, 10, 20)
 * @param maintenanceMarginRate Maintenance margin rate (default 0.005 = 0.5%)
 * @param bufferRatio Fraction of distance to liquidation where stop is placed (default 0.50 = 50% buffer)
 */
export function calculateDynamicLiquidationStop(
  positionSide: "BUY" | "SELL",
  entryPrice: number,
  leverage: number,
  maintenanceMarginRate: number = 0.005,
  bufferRatio: number = 0.50
): DynamicStopLossResult {
  const safeLeverage = Math.max(1, leverage || 10);
  const safeEntry = Math.max(0.00000001, entryPrice);
  const clampedBuffer = Math.min(0.80, Math.max(0.20, bufferRatio));

  // Theoretical isolated liquidation formula:
  // Long (BUY): liqPrice = entry * (1 - (1 / leverage) + MMR)
  // Short (SELL): liqPrice = entry * (1 + (1 / leverage) - MMR)
  const marginFraction = 1 / safeLeverage;
  const mmr = Math.min(marginFraction * 0.5, Math.max(0.001, maintenanceMarginRate));

  let estimatedLiquidationPrice = 0;
  let stopPrice = 0;
  let stopSide: "BUY" | "SELL" = "SELL";

  if (positionSide.toUpperCase() === "BUY") {
    // LONG position -> Stop is a SELL
    stopSide = "SELL";
    const deltaToLiq = safeEntry * (marginFraction - mmr);
    estimatedLiquidationPrice = Math.max(0.00000001, safeEntry - deltaToLiq);
    // Stop placed at bufferRatio of the distance towards liquidation price
    stopPrice = safeEntry - (deltaToLiq * clampedBuffer);
  } else {
    // SHORT position -> Stop is a BUY
    stopSide = "BUY";
    const deltaToLiq = safeEntry * (marginFraction - mmr);
    estimatedLiquidationPrice = safeEntry + deltaToLiq;
    // Stop placed at bufferRatio of the distance towards liquidation price
    stopPrice = safeEntry + (deltaToLiq * clampedBuffer);
  }

  // Round stop price to 4 decimal places or appropriate precision
  const precision = safeEntry > 1000 ? 2 : safeEntry > 1 ? 4 : 6;
  const roundedStop = parseFloat(stopPrice.toFixed(precision));
  const roundedLiq = parseFloat(estimatedLiquidationPrice.toFixed(precision));

  const distanceToLiquidationPct = parseFloat(
    ((Math.abs(roundedLiq - safeEntry) / safeEntry) * 100).toFixed(2)
  );
  const stopDistancePct = parseFloat(
    ((Math.abs(roundedStop - safeEntry) / safeEntry) * 100).toFixed(2)
  );

  return {
    entryPrice: safeEntry,
    leverage: safeLeverage,
    positionSide: positionSide.toUpperCase() as "BUY" | "SELL",
    stopSide,
    estimatedLiquidationPrice: roundedLiq,
    stopPrice: roundedStop,
    distanceToLiquidationPct,
    stopDistancePct,
  };
}
