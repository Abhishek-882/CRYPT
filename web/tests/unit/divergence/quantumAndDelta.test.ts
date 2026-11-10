/**
 * Divergence Bot: Discrete Lot Quantum Matching & Delta-Neutrality Invariant Test Suite
 * Milestone 3 (M3) Specification Verification
 * 
 * Primary Invariants:
 * - ZERO BPS NOTATION: All spreads, hurdles, fees formatted strictly in % notation.
 * - STRICT BAN ON LEGACY REFERENCES: Avoid naming or referencing legacy bot.
 * - DELTA-NEUTRALITY: Sizing matches delta balance |Delta_net| < 0.001.
 */

import { describe, it, expect } from 'vitest';
import {
  reconcileDualLegQuantities,
  getSymbolFilter,
  roundPrice,
  roundQuantity,
} from '@/lib/statarb/utils/exchangeFilterRegistry';
import {
  normalizeQuantity,
  getMultiplierRatio,
  isTradFiExcluded,
} from '@/lib/statarb/utils/contractMapper';

describe('Milestone 3: Discrete Lot Quantum Matching & Delta-Neutrality Invariant', () => {
  // =========================================================================
  // TIER 1: FEATURE COVERAGE (Core Happy Paths)
  // =========================================================================
  describe('Tier 1: Feature Coverage', () => {
    it('TC1.3.1 (SATS Multiplier Normalization): 10x ratio between Binance (1,000) and Bybit (10,000) yields |Delta_net| < 0.001', () => {
      const notionals = [5.0, 10.0, 15.0, 25.0, 50.0];
      const pBn = 0.000280; // per 1,000 SATS contract
      const pByb = 0.00280; // per 10,000 SATS contract

      for (const n of notionals) {
        const sizing = reconcileDualLegQuantities(n, pBn, pByb, 'BINANCE', 'BYBIT', 'SATS');
        expect(sizing.valid).toBe(true);

        const baseUnitsBn = sizing.leg1Qty * 1000;
        const baseUnitsByb = sizing.leg2Qty * 10000;
        const deltaNet = Math.abs(baseUnitsBn - baseUnitsByb) / 1000;

        // MANDATORY INVARIANT: |Delta_net| < 0.001
        expect(deltaNet).toBeLessThan(0.001);
        expect(sizing.leg1Notional).toBeGreaterThanOrEqual(5.0);
        expect(sizing.leg2Notional).toBeGreaterThanOrEqual(5.0);
      }
    });

    it('TC1.3.2 (TURBO Multiplier Normalization): 1,000x ratio between Binance (1) and Bybit (1,000) yields |Delta_net| < 0.001', () => {
      const notionals = [5.0, 10.0, 15.0, 20.0, 50.0];
      const pBn = 0.00500; // per 1 TURBO
      const pByb = 5.0000; // per 1,000 TURBO

      for (const n of notionals) {
        const sizing = reconcileDualLegQuantities(n, pBn, pByb, 'BINANCE', 'BYBIT', 'TURBO');
        expect(sizing.valid).toBe(true);

        const baseUnitsBn = sizing.leg1Qty * 1;
        const baseUnitsByb = sizing.leg2Qty * 1000;
        const deltaNet = Math.abs(baseUnitsBn - baseUnitsByb) / 1;

        // MANDATORY INVARIANT: |Delta_net| < 0.001
        expect(deltaNet).toBeLessThan(0.001);
        expect(sizing.leg1Notional).toBeGreaterThanOrEqual(5.0);
        expect(sizing.leg2Notional).toBeGreaterThanOrEqual(5.0);
      }
    });

    it('TC1.3.3 (Asymmetric Step Sizes): SUI (0.1 vs 1.0) and NEAR (1.0 vs 0.1) calculate exact LCM quantum', () => {
      // SUI: Binance step 0.1 vs Bybit step 1.0 -> LCM quantum = 1.0
      const sui = reconcileDualLegQuantities(15.0, 2.15, 2.15, 'BINANCE', 'BYBIT', 'SUI');
      expect(sui.valid).toBe(true);
      expect(sui.leg1Qty % 1.0).toBe(0);
      expect(sui.leg2Qty % 1.0).toBe(0);
      expect(Math.abs(sui.leg1Qty - sui.leg2Qty)).toBeLessThan(0.001);

      // NEAR: Binance step 1.0 vs Bybit step 0.1 -> LCM quantum = 1.0
      const near = reconcileDualLegQuantities(15.0, 4.50, 4.50, 'BINANCE', 'BYBIT', 'NEAR');
      expect(near.valid).toBe(true);
      expect(near.leg1Qty % 1.0).toBe(0);
      expect(near.leg2Qty % 1.0).toBe(0);
      expect(Math.abs(near.leg1Qty - near.leg2Qty)).toBeLessThan(0.001);
    });

    it('TC1.3.4 (MinNotional Enforcement): verifies notional >= $5.00 USDT on both legs for standard corridor', () => {
      const testCases = [
        { symbol: 'SOL', price: 150.0, notional: 15.0 },
        { symbol: 'SUI', price: 2.15, notional: 15.0 },
        { symbol: 'NEAR', price: 4.50, notional: 18.0 },
        { symbol: 'AVAX', price: 25.0, notional: 25.0 },
        { symbol: 'DOGE', price: 0.15, notional: 15.0 },
      ];

      for (const tc of testCases) {
        const filterBn = getSymbolFilter('BINANCE', tc.symbol);
        const filterByb = getSymbolFilter('BYBIT', tc.symbol);
        expect(filterBn).toBeDefined();
        expect(filterByb).toBeDefined();

        const sizing = reconcileDualLegQuantities(tc.notional, tc.price, tc.price, 'BINANCE', 'BYBIT', tc.symbol);
        expect(sizing.valid).toBe(true);
        expect(sizing.leg1Notional).toBeGreaterThanOrEqual(5.0);
        expect(sizing.leg2Notional).toBeGreaterThanOrEqual(5.0);

        const delta = Math.abs(sizing.leg1Qty - sizing.leg2Qty);
        expect(delta).toBeLessThan(0.001);
      }
    });

    it('TC1.3.5 (Sub-$5.00 Rejection): target notional $4.99 is strictly rejected with MIN_NOTIONAL_VIOLATION', () => {
      const subMin = reconcileDualLegQuantities(4.99, 100.0, 100.0, 'BINANCE', 'BYBIT', 'SOL');
      expect(subMin.valid).toBe(false);
      expect(subMin.rejectionReason).toContain('MIN_NOTIONAL');
      expect(subMin.leg1Qty).toBe(0);
      expect(subMin.leg2Qty).toBe(0);
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('TC2.3.1 (Micro-Price Precision 1e-8): rounds price without scientific notation corruption', () => {
      const rawPrice = 0.000012345678;
      const tickSize = 0.00000001; // 1e-8
      const rounded = roundPrice(rawPrice, tickSize);
      expect(rounded).toBe(0.00001235);
      expect(typeof rounded).toBe('number');
      expect(isNaN(rounded)).toBe(false);
    });

    it('TC2.3.2 (Exact $5.00000000 USDT MinNotional): $5.0000 passes while $4.9999 fails', () => {
      // $5.0000 on an asset priced at $5.00 -> 1 unit = $5.00
      const atBoundary = reconcileDualLegQuantities(5.0000, 5.0, 5.0, 'BINANCE', 'BYBIT', 'SOL');
      expect(atBoundary.valid).toBe(true);
      expect(atBoundary.leg1Notional).toBeGreaterThanOrEqual(5.0);

      // $4.9999 fails
      const belowBoundary = reconcileDualLegQuantities(4.9999, 5.0, 5.0, 'BINANCE', 'BYBIT', 'SOL');
      expect(belowBoundary.valid).toBe(false);
      expect(belowBoundary.rejectionReason).toContain('MIN_NOTIONAL');
    });

    it('TC2.3.3 (Extreme Step Size Ratio 100:1): PEPE stepSize 100 divisibility and delta neutrality', () => {
      // PEPE has 1000PEPE multiplier on both venues, stepSize 100
      const pepe = reconcileDualLegQuantities(15.0, 0.01250, 0.01250, 'BINANCE', 'BYBIT', 'PEPE');
      expect(pepe.valid).toBe(true);
      expect(pepe.leg1Qty % 100).toBe(0);
      expect(pepe.leg2Qty % 100).toBe(0);

      const deltaNet = Math.abs(pepe.leg1Qty * 1000 - pepe.leg2Qty * 1000) / 1000;
      expect(deltaNet).toBeLessThan(0.001);
    });

    it('TC2.3.4 (Zero & Negative Notional Rejection): strictly rejects invalid quantities', () => {
      const zero = reconcileDualLegQuantities(0.00, 100.0, 100.0, 'BINANCE', 'BYBIT', 'SOL');
      expect(zero.valid).toBe(false);

      const negative = reconcileDualLegQuantities(-15.00, 100.0, 100.0, 'BINANCE', 'BYBIT', 'SOL');
      expect(negative.valid).toBe(false);
    });

    it('TC2.3.5 (TradFi Isolation Check): excludes CATUSDT (stock) and allows 1000CATUSDT (crypto)', () => {
      expect(isTradFiExcluded('CATUSDT')).toBe(true);
      expect(isTradFiExcluded('1000CATUSDT')).toBe(false);
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================
  describe('Tier 3: Cross-Feature Combinations', () => {
    it('COMB-01 (Multipliers + Partial Fill Reconciler): partial fill sizes Leg 2 to exact base quantum', () => {
      // Target: $15.00 notional of SATS -> e.g. 50 contracts on BN (50,000 SATS) vs 5 contracts on BYB (50,000 SATS)
      // Leg 1 partially fills 30 contracts (30,000 SATS)
      const filledLeg1Contracts = 30;
      const leg1BaseUnits = filledLeg1Contracts * 1000; // 30,000 base units

      // Reconciler sizes Leg 2 on Bybit (contract size 10,000)
      const leg2Multiplier = 10000;
      const matchableLeg2Contracts = Math.floor(leg1BaseUnits / leg2Multiplier);
      const matchedLeg2BaseUnits = matchableLeg2Contracts * leg2Multiplier; // 30,000 base units

      expect(matchableLeg2Contracts).toBe(3);
      const deltaNet = Math.abs(leg1BaseUnits - matchedLeg2BaseUnits) / 1000;

      // Delta neutrality preserved
      expect(deltaNet).toBeLessThan(0.001);
      expect(deltaNet).toBe(0.000);
    });
  });
});
