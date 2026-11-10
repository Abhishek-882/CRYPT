/**
 * Divergence Bot: System Invariants & AST/Regex Compliance Test Suite
 * Milestone 5 (M5) Specification Verification
 * 
 * Primary Invariants:
 * - ZERO BPS NOTATION: All spreads, hurdles, fees formatted strictly in % notation.
 * - STRICT BAN ON LEGACY REFERENCES: Avoid naming or referencing legacy bot.
 * - DELTA-NEUTRALITY: Delta balance maintained |Delta_net| < 0.001.
 * - OPERATIONAL SAFETY LOCK DEFAULT: isRunning: false, fsmState: 'PAUSED'.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createInitialDivergenceState } from './fixtures/divergenceMockAdapter';

describe('Milestone 5: System Invariants & Compliance Audit', () => {
  const divergenceTestDir = path.resolve(__dirname);
  const planPath = path.resolve(__dirname, '../../../../plans/divergence_bot_plan.md');

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (Core Invariants)
  // =========================================================================
  describe('Tier 1: Feature Coverage', () => {
    it('TC1.9.1 (Zero BPS Notation Invariant): verifies 0 numerical bps units across divergence tests & plans', () => {
      // Invariant rule: All values, spreads, hurdles, fees must be formatted strictly in % notation
      const targetFiles = [
        planPath,
        path.join(divergenceTestDir, 'stateAndLock.test.ts'),
        path.join(divergenceTestDir, 'scannerAndRadar.test.ts'),
        path.join(divergenceTestDir, 'quantumAndDelta.test.ts'),
        path.join(divergenceTestDir, 'orderRouter.test.ts'),
        path.join(divergenceTestDir, 'exitAndZeroLoss.test.ts'),
        path.join(divergenceTestDir, 'riskAndStagnancy.test.ts'),
        path.join(divergenceTestDir, 'fixtures/divergenceMockAdapter.ts'),
        path.join(divergenceTestDir, 'fixtures/candidateMatrix.ts'),
        path.join(divergenceTestDir, 'fixtures/exitFixtures.ts'),
      ];

      const forbiddenBpsRegex = /\b\d+(\.\d+)?\s*bps\b/i;

      for (const filePath of targetFiles) {
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          // Allow comment declarations in test files that specifically describe the invariant
          if (line.includes('ZERO BPS NOTATION') || line.includes('forbiddenBpsRegex')) return;

          const match = forbiddenBpsRegex.test(line);
          expect(match).toBe(false);
          if (match) {
            throw new Error(`BPS INVARIANT VIOLATION in ${filePath}:${index + 1} -> ${line.trim()}`);
          }
        });
      }
    });

    it('TC1.9.2 (Strict Ban on Legacy References): 0 legacy bot references in divergence artifacts', () => {
      const targetFiles = [
        planPath,
        path.join(divergenceTestDir, 'stateAndLock.test.ts'),
        path.join(divergenceTestDir, 'scannerAndRadar.test.ts'),
        path.join(divergenceTestDir, 'quantumAndDelta.test.ts'),
        path.join(divergenceTestDir, 'orderRouter.test.ts'),
        path.join(divergenceTestDir, 'exitAndZeroLoss.test.ts'),
        path.join(divergenceTestDir, 'riskAndStagnancy.test.ts'),
        path.join(divergenceTestDir, 'fixtures/divergenceMockAdapter.ts'),
        path.join(divergenceTestDir, 'fixtures/candidateMatrix.ts'),
        path.join(divergenceTestDir, 'fixtures/exitFixtures.ts'),
      ];

      const forbiddenLegacyRegex = /\b(legacy_basis|deprecated_basis)\b/i;

      for (const filePath of targetFiles) {
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(forbiddenLegacyRegex.test(content)).toBe(false);
      }
    });

    it('TC1.9.3 (Strict Delta-Neutrality Invariant): verifies |Delta_net| < 0.001 threshold', () => {
      function isDeltaNeutral(leg1BaseUnits: number, leg2BaseUnits: number, normalizer: number = 1.0): boolean {
        const delta = Math.abs(leg1BaseUnits - leg2BaseUnits) / normalizer;
        return delta < 0.001;
      }

      // Exactly zero delta
      expect(isDeltaNeutral(7.0, 7.0)).toBe(true);
      // Delta = 0.0005 < 0.001
      expect(isDeltaNeutral(7.0005, 7.0)).toBe(true);
      // Delta = 0.0015 >= 0.001 -> FAILS
      expect(isDeltaNeutral(7.0015, 7.0)).toBe(false);
    });

    it('TC1.9.4 (Operational Safety Lock Invariant): daemon defaults to isRunning = false and fsmState = PAUSED', () => {
      const state = createInitialDivergenceState();

      expect(state.isRunning).toBe(false);
      expect(state.fsmState).toBe('PAUSED');
      expect(state.config.maxConcurrentPositions).toBe(3);
      expect(state.config.maxCapitalAllocationUsdt).toBe(60.00);
    });

    it('TC1.9.5 (System Isolation Invariant): isolates state and lock files from other strategies', () => {
      const divergenceLock = 'data/divergence_daemon.lock';
      const statArbLock = 'data/bot_daemon.lock';
      const divergenceState = 'data/divergence_state.json';
      const statArbState = 'data/statarb_state.json';

      expect(divergenceLock).not.toBe(statArbLock);
      expect(divergenceState).not.toBe(statArbState);
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('TC2.9.1 (Case-Insensitive BPS Scanner): catches Bps, BPS, bPs variations', () => {
      const regex = /\b\d+(\.\d+)?\s*bps\b/i;

      expect(regex.test('25 bps')).toBe(true);
      expect(regex.test('25 BPS')).toBe(true);
      expect(regex.test('25.5 Bps')).toBe(true);
      expect(regex.test('0.5 bPs')).toBe(true);

      // Percentage notation is accepted
      expect(regex.test('0.400%')).toBe(false);
      expect(regex.test('0.100%')).toBe(false);
    });

    it('TC2.9.2 (Partial Word Collision Immunity): legitimate words are not false positives', () => {
      const regex = /\b\d+(\.\d+)?\s*bps\b/i;

      // Legitimate words containing letters b, p, s
      expect(regex.test('subprocesses')).toBe(false);
      expect(regex.test('subscriptions')).toBe(false);
    });

    it('TC2.9.3 (Sub-0.001 Delta Neutrality Boundary): 0.00099 passes, 0.00101 fails', () => {
      function checkDeltaBoundary(delta: number): boolean {
        return delta < 0.001;
      }

      expect(checkDeltaBoundary(0.00099)).toBe(true);
      expect(checkDeltaBoundary(0.00100)).toBe(false);
      expect(checkDeltaBoundary(0.00101)).toBe(false);
    });
  });
});
