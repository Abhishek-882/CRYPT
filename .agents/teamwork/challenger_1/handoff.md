# Empirical Challenge & Stress Verification Report: STATARB-OU-PERP

**Agent**: `teamwork_challenger_1` (Critic / Empirical Specialist)  
**Date**: 2026-11-06T15:43:30Z  
**Target Milestone**: STATARB-OU-PERP Standalone Convergence Sweeper & Cockpit  
**Verdict**: **APPROVE**

---

## 1. Observation

Direct observations and verbatim test outputs from empirical verification:

### A. Vitest Test Suite Execution
- **Command executed**: `Set-Location C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web; npx vitest run tests/unit/statarb/`
- **Output**:
  ```
  RUN  v5.0.5 C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web

   ✓ tests/unit/statarb/exitOptimizer.test.ts (33 tests) 13ms
   ✓ tests/unit/statarb/invariantGuard.test.ts (29 tests) 13ms
   ✓ tests/unit/statarb/statArbEngine.test.ts (12 tests) 82ms
   ✓ tests/unit/statarb/adversarialStress.test.ts (29 tests) 128ms
   ✓ tests/unit/statarb/zScoreEngine.test.ts (20 tests) 17ms
   ✓ tests/unit/statarb/ouCalibrator.test.ts (14 tests) 12ms
   ✓ tests/unit/statarb/orderRouter.test.ts (13 tests) 695ms

   Test Files  7 passed (7)
        Tests  150 passed (150)
     Duration  1.00s
  ```

### B. Mathematical Calibration & SDE Parameter Recovery
- In `web/lib/statarb/math/ouCalibrator.ts`:
  - Line 134: `theta = -Math.log(beta) / dt;`
  - Line 137: `halfLifeMinutes = theta > 1e-6 ? Math.LN2 / theta : 120.0;`
  - Line 141: `mu = rawAlpha / (1.0 - beta);`
  - Line 146: `continuousDiffusion = sigmaEpsilon * Math.sqrt((2.0 * theta) / denominator);`
  - Line 150: `calculatedEqSigma = sigmaEpsilon / Math.sqrt(denominator);`
  - Clamping boundaries: Lines 111-114 enforce `betaFloor = 0.01` and `betaCeil = 0.999`.
  - Zero-variance handling: Lines 90-102 return `DEFAULT_OU_PRIORS.minEquilibriumSigmaFloor` ($0.001$) preventing division by zero.
  - Sparse sample guard: Lines 49-61 return default priors when $N < 5$.

### C. Entry Gating Strict Boundaries
- In `web/lib/statarb/math/zScoreEngine.ts`:
  - Line 94: `const gate1Passed = absZScore >= config.minZScore;`
    * $|z_t| = 2.19$ evaluated to `false` [FAIL]
    * $|z_t| = 2.20$ evaluated to `true` [PASS]
    * $z_t = -2.19$ evaluated to `false` [FAIL]
    * $z_t = -2.20$ evaluated to `true` [PASS]
  - Line 102: `const gate2Passed = absBasis >= config.minGrossBasisBps;`
    * $|b_t| = 27.9$ bps evaluated to `false` [FAIL]
    * $|b_t| = 28.0$ bps evaluated to `true` [PASS]
    * $b_t = -27.9$ bps evaluated to `false` [FAIL]
    * $b_t = -28.0$ bps evaluated to `true` [PASS]
  - Line 114: `const gate3Passed = pair.orderBookDepthRatio >= config.minDepthRatio;`
    * Depth cushion $= 3.99\times$ evaluated to `false` [FAIL]
    * Depth cushion $= 4.00\times$ evaluated to `true` [PASS]
  - Lines 126-128: `const gate4Passed = pair.binanceSpreadBps <= config.maxSpreadBps && pair.bybitSpreadBps <= config.maxSpreadBps;`
    * Binance spread $= 8.01$ bps, Bybit $= 4.00$ bps evaluated to `false` [FAIL]
    * Binance spread $= 4.00$ bps, Bybit $= 8.01$ bps evaluated to `false` [FAIL]
    * Binance spread $= 8.00$ bps, Bybit $= 8.00$ bps evaluated to `true` [PASS]
  - Lines 143-151: Directional polarity alignment requires basis sign and z-score sign to match:
    * $b_t \ge +28.0$ and $z_t \ge +2.20 \to$ `SHORT_BINANCE_LONG_BYBIT`
    * $b_t \le -28.0$ and $z_t \le -2.20 \to$ `SHORT_BYBIT_LONG_BINANCE`
    * Sign mismatch (e.g. positive basis but negative z-score) evaluated to `passed: false`, `direction: undefined`.

### D. Zero-Loss Exit Boundary (+0.0099 vs +0.0100 USDT)
- In `web/lib/statarb/execution/exitOptimizer.ts`:
  - Line 16: `export const MIN_ZERO_LOSS_PROFIT_USDT = 0.01;`
  - Line 219: `if (netPnL < MIN_ZERO_LOSS_PROFIT_USDT) return { exitAllowed: false, reason: 'BLOCKED_BY_ZERO_LOSS_GATE' };`
  - Line 360: `return { canExit: false, exitAllowed: false, exitType: 'HOLD_CARRY_FOR_PARITY', reason: gateResult.reason };`
  - Exact empirical boundary test results:
    * Net PnL $= +\$0.0099$ USDT $\to$ `exitAllowed: false`, `exitType: 'HOLD_CARRY_FOR_PARITY'` [BLOCKED]
    * Net PnL $= +\$0.00999$ USDT $\to$ `exitAllowed: false` [BLOCKED]
    * Net PnL $= +\$0.0100$ USDT $\to$ `exitAllowed: true`, `exitType: 'PROFITABLE_CONVERGENCE_EXIT'` [APPROVED]
    * Net PnL $= +\$0.01001$ USDT $\to$ `exitAllowed: true` [APPROVED]
  - Basis compression: $74.9\%$ compression evaluated to `false` [BLOCKED]; $75.0\%$ evaluated to `true` [APPROVED].
  - Z-score normalization: $|z_t| = 0.36$ evaluated to `false` [BLOCKED]; $|z_t| = 0.35$ evaluated to `true` [APPROVED].

### E. Invariant 6: 30-Minute Low-Watermark Persistence Breaker
- In `web/lib/statarb/execution/invariantGuard.ts`:
  - Lines 110-118: `if (holdMinutes < DEFAULT_PERSISTENCE_MINUTES) return { triggered: false };`
    * Hold duration $29.9$ minutes evaluated to `triggered: false` despite continuous $1.25\%$ divergence.
  - Lines 122-131: `if (minDivergencePct < thresholdPct) return { triggered: false };`
    * Reset sequence with dip to $0.94\%$ at minute 28 evaluated to `triggered: false` (`minDivergencePct: 0.94 < 1.00`).
    * Reset sequence with dip to $0.999\%$ at minute 28 evaluated to `triggered: false` (`minDivergencePct: 0.999 < 1.00`).
  - Lines 134-141: Continuous divergence $\ge 1.0\%$ for $30.0$ minutes evaluated to `triggered: true`.
  - Exactly $1.000\%$ flat divergence evaluated to `triggered: true` (`minDivergencePct: 1.000`).
  - Lines 309-327 of `exitOptimizer.ts`: When Invariant 6 triggers, it strictly overrides the Zero-Loss Gate to liquidate structural depegs (`exitType: 'STRUCTURAL_BASIS_DECOUPLING'`), even when mark-to-market net PnL is negative ($-\$0.0975$ USDT).

### F. Invariant 7: Upstream Sticky Decoupling Filter
- In `web/lib/statarb/execution/invariantGuard.ts`:
  - Lines 188-197: `if (minDivergencePct >= thresholdPct) return { passed: false, code: 'INVARIANT_7_STICKY_DECOUPLING_REJECTED' };`
    * Continuous trajectory with minimum divergence $1.04\% \ge 1.00\%$ evaluated to `passed: false` [REJECTED].
    * Trajectory flat at exactly $1.000\%$ evaluated to `passed: false` [REJECTED].
  - Trajectory that touched $0.999\%$ at minute 28 evaluated to `passed: true` (`minDivergencePct: 0.999 < 1.00`) [APPROVED].
  - Standard mean-reverting currency pairs ($0.15\%$ to $0.35\%$) evaluated to `passed: true` [APPROVED].
  - Negative Bybit-rich corridors ($-1.15\%$ to $-1.05\%$) evaluated via absolute value to $1.15\% \ge 1.00\%$ [REJECTED].

### G. Next.js Production Build
- **Command executed**: `Set-Location C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web; npm run build`
- **Output**:
  ```
  ✓ Compiled successfully
  ✓ Generating static pages (18/18)
  Route (app)                              Size     First Load JS
  ├ ƒ /api/convergence/audit               0 B                0 B
  ├ ƒ /api/convergence/daemon              0 B                0 B
  ├ ƒ /api/convergence/radar               0 B                0 B
  ├ ○ /convergence                         15.4 kB         116 kB
  ```
- Build completed with exit code `0`.

---

## 2. Logic Chain

1. **Continuous OU SDE Calibration**:
   - The continuous Ornstein-Uhlenbeck stochastic process $db_t = \theta (\mu - b_t) dt + \sigma dW_t$ discretizes into the exact AR(1) recurrence $b_{t+1} = \mu(1 - e^{-\theta \Delta t}) + e^{-\theta \Delta t} b_t + \epsilon_t$.
   - OLS regression recovers $\beta = e^{-\theta \Delta t}$ and $\alpha = \mu(1 - \beta)$.
   - Inverting yields $\theta = -\ln(\beta) / \Delta t$ and $\mu = \alpha / (1 - \beta)$.
   - By matching conditional variance $\text{Var}(\epsilon_t) = \frac{\sigma^2}{2\theta} (1 - e^{-2\theta \Delta t}) = \frac{\sigma^2}{2\theta}(1 - \beta^2)$, the continuous volatility is recovered as $\sigma = \sigma_\epsilon \sqrt{\frac{2\theta}{1 - \beta^2}}$, and the unconditional equilibrium standard deviation is $\sigma_{\text{eq}} = \frac{\sigma}{\sqrt{2\theta}} = \frac{\sigma_\epsilon}{\sqrt{1 - \beta^2}}$.
   - Empirically observed in `Focus 1` test suite: deterministic AR(1) decay with $\beta = 0.88, \mu = 4.5$ produced calibrated parameters matching analytical expectations to 5 decimal places ($R^2 > 0.9999$).
   - Stationary bounds $\beta \in [0.01, 0.999]$ successfully prevent explosive divergence or negative velocity.

2. **Entry Gate Strictness**:
   - Boundary tests in `Focus 2A` verified that the 4 gates behave as strict half-open / closed intervals:
     * $|z_t| \ge 2.20$: $2.19$ fails, $2.20$ passes.
     * $|b_t| \ge 28.0$ bps: $27.9$ fails, $28.0$ passes.
     * $\text{DepthRatio} \ge 4.00\times$: $3.99\times$ fails, $4.00\times$ passes.
     * $\text{Spread} \le 8.00$ bps: $8.01$ fails, $8.00$ passes.
   - Dual-venue and dual-direction symmetry confirmed: positive basis with positive z-score routes to Binance short / Bybit long; negative basis with negative z-score routes to Bybit short / Binance long. Any sign divergence is blocked.

3. **Guaranteed Zero-Loss Invariant**:
   - The exit optimizer enforces $\text{Net PnL} \ge +\$0.0100$ USDT net of Binance Maker (2.0 bps) + Bybit Taker (5.5 bps) entry and exit fees.
   - In `Focus 2B`, positions with Net PnL of $+\$0.0099$ USDT or $+\$0.00999$ USDT are strictly rejected from exiting (`BLOCKED_BY_ZERO_LOSS_GATE`) and held in `HOLD_CARRY_FOR_PARITY`.
   - At exactly $+\$0.0100$ USDT, exit is approved (`PROFITABLE_CONVERGENCE_EXIT`).

4. **Persistence Breakers (Invariants 6 & 7)**:
   - Invariant 6 monitors hold duration and spread divergence: if hold duration $< 30$ minutes, it cannot trigger. If spread dips below $1.0\%$ at any point (e.g. sample 28 dips to $0.94\%$ or $0.999\%$), `minDivergencePct < 1.0` and the timer resets. Only when all samples in $\ge 30$ min remain $\ge 1.0\%$ does it trigger.
   - When triggered, Invariant 6 overrides the Zero-Loss Gate to prevent unbounded losses on structurally unpegged tokens.
   - Invariant 7 acts upstream before entry: if the minimum divergence observed across the rolling 30-minute window is $\ge 1.0\%$, the pair is rejected as permanently decoupled. If it touched $< 1.0\%$, it passes.

5. **Full System Integration & Build Health**:
   - All 7 unit test files in `tests/unit/statarb/` (including the 29-test adversarial stress harness) pass with 150/150 tests passing.
   - Production compilation via `npm run build` completed cleanly, bundling the Next.js App Router convergence cockpit and API routes.

---

## 3. Adversarial Review Challenge Summary

| Challenge Dimension | Target | Attack Scenario | Actual Behavior | Result |
|---|---|---|---|---|
| **Mathematical SDE Recovery** | `ouCalibrator.ts` | Feed explosive linear drift $\beta \ge 1.0$ or anti-persistent flip $\beta \le 0$ | Beta clamped to $[0.01, 0.999]$; finite $\theta > 0$ and $\sigma_{\text{eq}} > 0$ returned | **PASS** |
| **Zero Variance Feed** | `ouCalibrator.ts` | Constant price series (frozen feeds) | SXX/SYY $\le 10^{-12}$ detected; returns floor $\sigma_{\text{eq}} = 0.001$, no NaN or zero division | **PASS** |
| **Gate 1 Boundary** | `zScoreEngine.ts` | $z_t = 2.19$ vs $2.20$, $-2.19$ vs $-2.20$ | $2.19$ rejected, $2.20$ approved; polarity matched | **PASS** |
| **Gate 2 Boundary** | `zScoreEngine.ts` | Gross basis $27.9$ vs $28.0$ bps | $27.9$ rejected, $28.0$ approved | **PASS** |
| **Gate 3 Boundary** | `zScoreEngine.ts` | Depth cushion $3.99\times$ vs $4.00\times$ | $3.99\times$ rejected, $4.00\times$ approved | **PASS** |
| **Gate 4 Boundary** | `zScoreEngine.ts` | Bid-ask spread $8.01$ vs $8.00$ bps | $8.01$ rejected on either venue, $8.00$ approved | **PASS** |
| **Zero-Loss Floor** | `exitOptimizer.ts` | Net PnL $= +\$0.0099$ vs $+\$0.0100$ USDT | $+\$0.0099$ blocked (`HOLD_CARRY_FOR_PARITY`), $+\$0.0100$ approved | **PASS** |
| **Invariant 6 Persistence** | `invariantGuard.ts` | Spread continuously $\ge 1.0\%$ for $30$m | Triggers breaker; overrides zero-loss gate | **PASS** |
| **Invariant 6 Minute 28 Reset** | `invariantGuard.ts` | Spread dips to $0.94\%$ / $0.999\%$ at min 28 | `minDivergencePct < 1.0` resets timer; does NOT trigger | **PASS** |
| **Invariant 7 Sticky Filter** | `invariantGuard.ts` | Min divergence in 30m window $\ge 1.0\%$ | Rejects pair candidate (`INVARIANT_7_STICKY_DECOUPLING_REJECTED`) | **PASS** |
| **Invariant 7 Recovery** | `invariantGuard.ts` | Min divergence touched $0.999\%$ in 30m window | Passes candidate (`passed: true`) | **PASS** |

---

## 4. Caveats

- **Network I/O**: The unit and adversarial test suites execute against mock exchange execution adapters and synthetic L2 order book fixtures rather than live exchange WebSockets (as per test isolation requirements). Real WebSocket IOC roundtrip latency on live exchanges depends on network collocation (sub-35ms targeted).
- **Historical Window Warm-up**: In live production, Invariant 7 and continuous OU calibration require at least 5 to 30 minutes of historical 1-minute spread samples to graduate from default prior baseline to unconstrained OLS.

---

## 5. Conclusion

**Verdict: APPROVE**

The `STATARB-OU-PERP` implementation passes all empirical adversarial tests:
1. Continuous Ornstein-Uhlenbeck calibration and real-time z-score formulas are mathematically exact and numerically stable under boundary conditions and dirty feeds.
2. All entry gating boundaries ($2.19$ vs $2.20$, $27.9$ vs $28.0$ bps, $3.99\times$ vs $4.00\times$, $8.01$ vs $8.00$ bps) operate strictly without false positives or leaking trades.
3. The Guaranteed Zero-Loss Exit enforces the $+\$0.0100$ USDT net hurdle with precision, blocking $+\$0.0099$ USDT while permitting $+\$0.0100$ USDT.
4. Invariant 6 and Invariant 7 correctly monitor 30-minute low-watermark persistence, reset on minute-28 dips, and enforce structural decoupling protection.
5. All 150 automated tests pass cleanly, and the production application compiles without build errors.

---

## 6. Verification Method

To independently verify these empirical results:

1. **Run Vitest Test Suite**:
   ```powershell
   Set-Location C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
   npx vitest run tests/unit/statarb/
   ```
   *Expected outcome*: 7 test files passed, 150 tests passed, 0 failures.

2. **Run Dedicated Adversarial Stress Harness**:
   ```powershell
   Set-Location C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
   npx vitest run tests/unit/statarb/adversarialStress.test.ts
   ```
   *Expected outcome*: 29 tests passed, verifying all SDE recovery, boundary thresholds, zero-loss exit, and Invariant 6/7 sequences.

3. **Verify Next.js Production Build**:
   ```powershell
   Set-Location C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
   npm run build
   ```
   *Expected outcome*: Exit code 0 with `/convergence` page and API routes `/api/convergence/daemon`, `/api/convergence/radar`, `/api/convergence/audit` generated.

4. **Invalidation Conditions**:
   - Any test failure in `tests/unit/statarb/`.
   - Any situation where $|z_t| = 2.19$ or gross basis $= 27.9$ bps triggers an entry signal.
   - Any situation where Net PnL $= +\$0.0099$ USDT is allowed to exit via convergence.
   - Any failure of Invariant 6 to reset when divergence dips below $1.0\%$.
