/**
 * Dual-Venue Step Size & Decimal Precision Engine
 * Track SPEC-CORE / PRECISION-01
 * 
 * Reconciles conflicting lotSizeFilter, stepSize, and minNotional specifications across
 * Binance USD-M and Bybit Linear. Permanently eliminates error 10001 (qtyStep violation)
 * and orphan recovery market unwinds.
 */

export interface VenuePrecisionSpec {
  stepSize: number;       // e.g. 0.1 on Binance, 10 on Bybit for SUI
  minQty: number;         // e.g. 0.1
  minNotional: number;    // e.g. 5.0 USD
  tickSize: number;       // price tick precision
  pricePrecision: number;
  qtyPrecision: number;
}

export interface ReconciledOrderQuantity {
  valid: boolean;
  qty: number;
  formattedQtyVenueA: string;
  formattedQtyVenueB: string;
  notionalVenueA: number;
  notionalVenueB: number;
  rejectionReason?: string;
}

export class PrecisionManager {
  /**
   * Derive decimal precision from step size (e.g. 0.001 -> 3, 10 -> 0)
   */
  public static getPrecisionFromStep(step: number): number {
    if (!step || step >= 1) return 0;
    const str = step.toString();
    const dot = str.indexOf(".");
    if (dot === -1) return 0;
    return str.length - dot - 1;
  }

  /**
   * Format quantity to exact step size without floating point inaccuracies
   */
  public static formatQuantity(qty: number, stepSize: number): string {
    const precision = this.getPrecisionFromStep(stepSize);
    if (stepSize >= 1) {
      // Step size is an integer (e.g. 1, 10, 100)
      const integerStep = Math.round(stepSize);
      const quantized = Math.floor((qty + 1e-12) / integerStep) * integerStep;
      return quantized.toString();
    }
    // Step size is fractional (e.g. 0.1, 0.01, 0.001)
    const factor = Math.pow(10, precision);
    const quantized = Math.floor(Math.floor((qty + 1e-12) * factor) / Math.round(stepSize * factor)) * stepSize;
    return quantized.toFixed(precision);
  }

  /**
   * Reconcile order quantities between two venues to ensure strict delta-neutral symmetry
   * while complying with both exchanges' stepSize, minQty, and minNotional filters.
   */
  public static reconcileDualVenueQuantity(
    targetNotionalUsd: number,
    priceA: number,
    priceB: number,
    specA?: Partial<VenuePrecisionSpec>,
    specB?: Partial<VenuePrecisionSpec>
  ): ReconciledOrderQuantity {
    if (targetNotionalUsd <= 0 || priceA <= 0 || priceB <= 0) {
      return {
        valid: false,
        qty: 0,
        formattedQtyVenueA: "0",
        formattedQtyVenueB: "0",
        notionalVenueA: 0,
        notionalVenueB: 0,
        rejectionReason: "INVALID_INPUT_PARAMETERS",
      };
    }

    const stepA = specA?.stepSize || 1;
    const stepB = specB?.stepSize || 1;
    const minQtyA = specA?.minQty || stepA;
    const minQtyB = specB?.minQty || stepB;
    const minNotionalA = specA?.minNotional || 5.0;
    const minNotionalB = specB?.minNotional || 5.0;

    // 1. Calculate raw target quantity from average reference price
    const avgPrice = (priceA + priceB) / 2;
    let rawQty = targetNotionalUsd / avgPrice;

    // 2. Determine common step size constraint
    // For delta neutrality, both legs must execute the exact same quantity.
    // Therefore, the step size must satisfy both venues: commonStep = max(stepA, stepB)
    // (e.g. SUI: Binance step 0.1, Bybit step 10 => commonStep = 10)
    const commonStep = Math.max(stepA, stepB);
    const precision = this.getPrecisionFromStep(commonStep);

    // 3. Quantize quantity down to commonStep
    let quantizedQty: number;
    if (commonStep >= 1) {
      quantizedQty = Math.floor(rawQty / commonStep) * commonStep;
    } else {
      const factor = Math.pow(10, precision);
      quantizedQty = Math.floor(Math.round(rawQty * factor) / (commonStep * factor)) * commonStep;
    }

    // If quantized quantity is below minimum requirement, check if rounding up is feasible
    const minRequiredQty = Math.max(minQtyA, minQtyB, commonStep);
    if (quantizedQty < minRequiredQty) {
      quantizedQty = minRequiredQty;
    }

    // 4. Verify Notional on both legs
    const notionalA = quantizedQty * priceA;
    const notionalB = quantizedQty * priceB;

    if (notionalA < minNotionalA) {
      // Scale up to meet minNotionalA if within reasonable tolerance (up to 1.5x target)
      if (minNotionalA <= targetNotionalUsd * 1.5) {
        quantizedQty = Math.ceil(minNotionalA / priceA / commonStep) * commonStep;
      } else {
        return {
          valid: false,
          qty: 0,
          formattedQtyVenueA: "0",
          formattedQtyVenueB: "0",
          notionalVenueA: notionalA,
          notionalVenueB: notionalB,
          rejectionReason: `MIN_NOTIONAL_VIOLATION_VENUE_A: $${notionalA.toFixed(2)} < $${minNotionalA.toFixed(2)}`,
        };
      }
    }

    const finalNotionalA = quantizedQty * priceA;
    const finalNotionalB = quantizedQty * priceB;

    if (finalNotionalB < minNotionalB) {
      return {
        valid: false,
        qty: 0,
        formattedQtyVenueA: "0",
        formattedQtyVenueB: "0",
        notionalVenueA: finalNotionalA,
        notionalVenueB: finalNotionalB,
        rejectionReason: `MIN_NOTIONAL_VIOLATION_VENUE_B: $${finalNotionalB.toFixed(2)} < $${minNotionalB.toFixed(2)}`,
      };
    }

    // 5. Format formatted strings for Venue A and Venue B
    const formattedA = this.formatQuantity(quantizedQty, stepA);
    const formattedB = this.formatQuantity(quantizedQty, stepB);

    return {
      valid: true,
      qty: quantizedQty,
      formattedQtyVenueA: formattedA,
      formattedQtyVenueB: formattedB,
      notionalVenueA: parseFloat(finalNotionalA.toFixed(2)),
      notionalVenueB: parseFloat(finalNotionalB.toFixed(2)),
    };
  }
}
