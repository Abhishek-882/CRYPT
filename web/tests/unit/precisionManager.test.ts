import { describe, it, expect } from "vitest";
import { PrecisionManager } from "@/lib/precisionManager";

describe("PrecisionManager", () => {
  it("derives correct decimal precision from step sizes", () => {
    expect(PrecisionManager.getPrecisionFromStep(1)).toBe(0);
    expect(PrecisionManager.getPrecisionFromStep(10)).toBe(0);
    expect(PrecisionManager.getPrecisionFromStep(100)).toBe(0);
    expect(PrecisionManager.getPrecisionFromStep(0.1)).toBe(1);
    expect(PrecisionManager.getPrecisionFromStep(0.01)).toBe(2);
    expect(PrecisionManager.getPrecisionFromStep(0.001)).toBe(3);
  });

  it("formats quantities cleanly without floating point errors", () => {
    expect(PrecisionManager.formatQuantity(32.46, 10)).toBe("30");
    expect(PrecisionManager.formatQuantity(9898.76, 100)).toBe("9800");
    expect(PrecisionManager.formatQuantity(0.00378, 0.001)).toBe("0.003");
    expect(PrecisionManager.formatQuantity(1.234, 0.1)).toBe("1.2");
  });

  it("reconciles conflicting step sizes across Binance (0.1) and Bybit (10) for SUI", () => {
    const suiPrice = 0.92;
    const targetNotional = 30.0; // ~$30 USD

    const reconciled = PrecisionManager.reconcileDualVenueQuantity(
      targetNotional,
      suiPrice,
      suiPrice,
      { stepSize: 0.1, minQty: 0.1, minNotional: 5.0 }, // Binance
      { stepSize: 10, minQty: 10, minNotional: 5.0 }     // Bybit (multiples of 10!)
    );

    expect(reconciled.valid).toBe(true);
    // Common step must be 10, so 32.6 units quantizes to 30 units
    expect(reconciled.qty).toBe(30);
    expect(reconciled.formattedQtyVenueA).toBe("30.0");
    expect(reconciled.formattedQtyVenueB).toBe("30");
    expect(reconciled.notionalVenueA).toBeGreaterThanOrEqual(5.0);
    expect(reconciled.notionalVenueB).toBeGreaterThanOrEqual(5.0);
  });

  it("reconciles 1000BONK with 100 step size constraint", () => {
    const bonkPrice = 0.0030;
    const targetNotional = 30.0;

    const reconciled = PrecisionManager.reconcileDualVenueQuantity(
      targetNotional,
      bonkPrice,
      bonkPrice,
      { stepSize: 1, minQty: 1, minNotional: 5.0 },   // Binance
      { stepSize: 100, minQty: 100, minNotional: 5.0 } // Bybit (multiples of 100!)
    );

    expect(reconciled.valid).toBe(true);
    expect(reconciled.qty % 100).toBe(0); // Must be a multiple of 100
    expect(reconciled.formattedQtyVenueB).toBe(reconciled.qty.toString());
  });
});
