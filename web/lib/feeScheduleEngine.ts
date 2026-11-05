/**
 * Dynamic VIP Tier Fee Schedule Engine
 * Track SPEC-03 / PROTOCOL-02
 * 
 * Computes exact corridor transaction fees, maker rebates, and tax friction dynamically.
 */

export interface VenueFeeRate {
  venue: string;
  makerFeeBps: number;
  takerFeeBps: number;
  taxRatePct: number; // e.g. 0.18 for 18% GST on CoinDCX
}

export const VENUE_FEE_SCHEDULE: Record<string, VenueFeeRate> = {
  binance: { venue: "Binance", makerFeeBps: 2.0, takerFeeBps: 5.0, taxRatePct: 0.0 },
  bybit: { venue: "Bybit", makerFeeBps: 2.0, takerFeeBps: 5.5, taxRatePct: 0.0 },
  bitget: { venue: "Bitget", makerFeeBps: 2.0, takerFeeBps: 6.0, taxRatePct: 0.0 },
  coindcx: { venue: "CoinDCX", makerFeeBps: 5.0, takerFeeBps: 5.0, taxRatePct: 0.18 }, // 18% GST
};

export interface CorridorFeeBreakdown {
  venueA: string;
  venueB: string;
  leg1OpenBps: number;
  leg2OpenBps: number;
  leg1CloseBps: number;
  leg2CloseBps: number;
  taxBps: number;
  totalRoundTripBps: number;
  feeSavedVsDualTakerBps: number;
}

export class FeeScheduleEngine {
  /**
   * Calculate corridor round-trip transaction friction
   */
  public calculateCorridorFees(
    venueA: string,
    venueB: string,
    isMakerLeg1: boolean = true
  ): CorridorFeeBreakdown {
    const vA = venueA.toLowerCase();
    const vB = venueB.toLowerCase();

    const rateA = VENUE_FEE_SCHEDULE[vA] || {
      venue: venueA,
      makerFeeBps: 2.0,
      takerFeeBps: 5.0,
      taxRatePct: 0.0,
    };
    const rateB = VENUE_FEE_SCHEDULE[vB] || {
      venue: venueB,
      makerFeeBps: 2.0,
      takerFeeBps: 5.5,
      taxRatePct: 0.0,
    };

    const leg1OpenBps = isMakerLeg1 ? rateA.makerFeeBps : rateA.takerFeeBps;
    const leg2OpenBps = rateB.takerFeeBps; // Leg 2 is always IOC taker for 0 orphan exposure
    const leg1CloseBps = isMakerLeg1 ? rateA.makerFeeBps : rateA.takerFeeBps;
    const leg2CloseBps = rateB.takerFeeBps;

    const baseFriction = leg1OpenBps + leg2OpenBps + leg1CloseBps + leg2CloseBps;
    const taxA = (leg1OpenBps + leg1CloseBps) * rateA.taxRatePct;
    const taxB = (leg2OpenBps + leg2CloseBps) * rateB.taxRatePct;
    const totalTaxBps = parseFloat((taxA + taxB).toFixed(2));

    const totalRoundTripBps = parseFloat((baseFriction + totalTaxBps).toFixed(2));

    // Calculate baseline dual taker fee for comparison
    const dualTakerBase = (rateA.takerFeeBps * 2) + (rateB.takerFeeBps * 2);
    const dualTakerTax = (rateA.takerFeeBps * 2 * rateA.taxRatePct) + (rateB.takerFeeBps * 2 * rateB.taxRatePct);
    const dualTakerTotal = dualTakerBase + dualTakerTax;

    const feeSavedVsDualTakerBps = parseFloat(Math.max(0, dualTakerTotal - totalRoundTripBps).toFixed(2));

    return {
      venueA: rateA.venue,
      venueB: rateB.venue,
      leg1OpenBps,
      leg2OpenBps,
      leg1CloseBps,
      leg2CloseBps,
      taxBps: totalTaxBps,
      totalRoundTripBps,
      feeSavedVsDualTakerBps,
    };
  }
}

export const globalFeeScheduleEngine = new FeeScheduleEngine();
