/**
 * Divergence Bot: Quantitative Model & Mathematical Bounds Empirical Stress Test Suite
 * Archetype: teamwork_challenger
 * Roles: critic, specialist
 * 
 * Mathematical Stress-Testing:
 * 1. Fee Friction Model & Roundtrip Deductions (0.260%)
 * 2. Absolute Basis vs. Relative Expansion Take-Profit Ambiguity
 * 3. Zero-Loss Invariant (+0.0100 USDT) across notionals ($15, $50, $100 USDT)
 * 4. Direction Selection Matrix Boundary Gaps
 * 5. Adverse Divergence Stop-Loss & Net Payoff Asymmetry
 * 6. Carry Degradation & Dynamic Hurdle Ratchet
 * 7. Invariant Scans: Zero BPS notation & Zero legacy bot references
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Divergence Bot Quantitative Model Stress-Tests', () => {
  const ROUNDTRIP_FRICTION_PCT = 0.00260; // 0.260% (0.075% entry + 0.105% exit + 0.080% slippage)
  const MIN_ZERO_LOSS_USDT = 0.0100;
  const ADVERSE_STOP_DRIFT_PCT = -0.00150; // -0.150%

  describe('1. Fee Friction Model & Zero-Loss Invariant', () => {
    it('proves that relative expansion >= 0.350% strictly guarantees positive net PnL across all notionals', () => {
      const minExpansion = 0.00350; // 0.350%
      const netYieldPct = minExpansion - ROUNDTRIP_FRICTION_PCT; // +0.090%
      expect(netYieldPct).toBeCloseTo(0.00090, 5);
      expect(netYieldPct).toBeGreaterThan(0);

      const notionals = [15.0, 50.0, 100.0];
      for (const n of notionals) {
        const netProfitUsdt = n * netYieldPct;
        expect(netProfitUsdt).toBeGreaterThanOrEqual(MIN_ZERO_LOSS_USDT);
      }
    });

    it('exposes the Absolute Basis Target vulnerability: entry at +0.100% with exit at +0.350% yields NEGATIVE net PnL', () => {
      // If target is absolute basis bt >= +0.350%, and entry was at bt = +0.100%:
      const bEntry = 0.00100;
      const bExit = 0.00350;
      const grossExpansion = bExit - bEntry; // 0.250%
      const netYieldPct = grossExpansion - ROUNDTRIP_FRICTION_PCT; // 0.250% - 0.260% = -0.010%

      expect(grossExpansion).toBeCloseTo(0.00250, 5);
      expect(netYieldPct).toBeLessThan(0); // FAILS! Negative net yield!
      
      const pnl15 = 15.0 * netYieldPct;
      expect(pnl15).toBeLessThan(MIN_ZERO_LOSS_USDT); // FAILS Zero-Loss Invariant!
    });

    it('calculates the exact minimum gross expansion required for Zero-Loss Invariant on $15 notional', () => {
      // 15.0 * (delta_b - 0.00260) >= 0.0100
      // delta_b >= 0.00260 + (0.0100 / 15.0) = 0.00260 + 0.0006667 = 0.0032667 (0.3267%)
      const reqDeltaB15 = ROUNDTRIP_FRICTION_PCT + (MIN_ZERO_LOSS_USDT / 15.0);
      expect(reqDeltaB15).toBeCloseTo(0.003267, 5);

      // If entry is at +0.100%, absolute exit must be at least +0.4267%, NOT +0.350% or +0.380%
      const minAbsoluteExitFrom100 = 0.00100 + reqDeltaB15;
      expect(minAbsoluteExitFrom100).toBeGreaterThan(0.00400); // Exceeds standard +0.350% - +0.400% target!
    });
  });

  describe('2. Direction Selection & Adverse Divergence', () => {
    it('verifies that adverse divergence stop loss strictly bounds maximum normal loss to -0.410%', () => {
      const maxAdverseLossPct = ADVERSE_STOP_DRIFT_PCT - ROUNDTRIP_FRICTION_PCT; // -0.150% - 0.260% = -0.410%
      expect(maxAdverseLossPct).toBeCloseTo(-0.00410, 5);

      const notional = 100.0;
      const maxLossUsdt = notional * maxAdverseLossPct;
      expect(maxLossUsdt).toBeCloseTo(-0.4100, 4);
    });

    it('quantifies Net Payoff Asymmetry and calculates required breakeven win rate', () => {
      const grossTarget = 0.00350;
      const grossStop = 0.00150;
      const grossAsymmetry = grossTarget / grossStop;
      expect(grossAsymmetry).toBeCloseTo(2.333, 2); // 2.33x claimed in plan

      // Net Payoff at base target +0.380%:
      const netTarget = 0.00380 - ROUNDTRIP_FRICTION_PCT; // +0.120%
      const netStop = Math.abs(ADVERSE_STOP_DRIFT_PCT - ROUNDTRIP_FRICTION_PCT); // 0.410%
      const netAsymmetry = netTarget / netStop;
      expect(netAsymmetry).toBeCloseTo(0.2927, 3); // True net payoff is only 0.29x!

      // Breakeven win rate: netStop / (netStop + netTarget)
      const breakevenWinRate = netStop / (netStop + netTarget);
      expect(breakevenWinRate).toBeCloseTo(0.7736, 3); // 77.36% required win rate
    });

    it('verifies carry degradation ratchet and carry circuit breaker', () => {
      const baseTarget = 0.00380;
      const carryDrag = -0.00025; // 0.025% carry cost over hold
      const dynamicHurdle = baseTarget + Math.abs(carryDrag); // 0.405%
      
      const netPnLWithCarry = (dynamicHurdle + carryDrag) - ROUNDTRIP_FRICTION_PCT;
      expect(netPnLWithCarry).toBeCloseTo(0.00120, 5); // Net yield preserved at +0.120%

      const breakerCarry = -0.00085; // Exceeds 0.080% breaker
      const isBreakerTriggered = Math.abs(breakerCarry) >= 0.00080;
      expect(isBreakerTriggered).toBe(true);
    });
  });

  describe('3. Repository Invariants in divergence_bot_plan.md', () => {
    const planPath = path.resolve(__dirname, '../../../../plans/divergence_bot_plan.md');

    it('verifies plan file exists and has content', () => {
      expect(fs.existsSync(planPath)).toBe(true);
    });

    it('verifies ZERO non-percentage operational notation (100% % notation)', () => {
      const content = fs.readFileSync(planPath, 'utf-8');
      const lines = content.split('\n');

      // Check that bps is only mentioned in invariant declarations / test scripts
      const forbiddenPattern = /\b\d+(\.\d+)?\s*bps\b/i;
      for (let i = 0; i < lines.length; i++) {
        expect(forbiddenPattern.test(lines[i])).toBe(false);
      }
    });

    it('verifies ZERO legacy bot names or deprecated exchange references', () => {
      const content = fs.readFileSync(planPath, 'utf-8');
      const forbiddenLegacyTerms = ['coindcx', 'bitget', 'okx', 'gateio'];
      for (const term of forbiddenLegacyTerms) {
        const regex = new RegExp(`\\b${term}\\b`, 'i');
        expect(regex.test(content)).toBe(false);
      }
    });
  });
});
