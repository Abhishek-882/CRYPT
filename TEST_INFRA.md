# STATARB-OU-PERP: Test Infrastructure & Verification Framework

## 1. Test Philosophy & Architecture

The testing framework for `STATARB-OU-PERP` (Cross-Exchange Statistical Arbitrage & Ornstein-Uhlenbeck Price Convergence Sweeper) follows an **opaque-box, requirement-driven, 4-tier verification methodology**. 

Tests evaluate strictly against mathematical specifications, interface contracts, and real-world trading invariants defined in `PROJECT.md`, `spec_report.md`, and `ORIGINAL_REQUEST.md`. No test relies on private implementation details, dummy facade mocks that trivially pass, or hardcoded expected outputs without explicit derivation.

```
+---------------------------------------------------------------------------------------------------------+
|                                    4-TIER TEST VERIFICATION PYRAMID                                     |
+---------------------------------------------------------------------------------------------------------+
| Tier 4: Real-World Scenarios       | Stochastic Euler-Maruyama trajectories, noisy L2 feeds, depegs    |
| Tier 3: Combinatorial Permutations | All 2^4 = 16 gate combinations, directional reversals, partials  |
| Tier 2: Boundary & Corner Cases   | 2.19 vs 2.20, 27.9 vs 28.0 bps, 3.99x vs 4.00x, 8.01 vs 8.00 bps  |
| Tier 1: Core Feature Coverage      | AR(1) OLS recovery, z-score math, entry & exit gating, invariants  |
+---------------------------------------------------------------------------------------------------------+
```

### The 4 Tiers Defined

1. **Tier 1: Feature Coverage (Primary Behavior / Happy Paths)**
   - Verifies standard expected operational behavior of each standalone module.
   - Tests discrete AR(1) OLS parameter estimation ($\theta, \mu, \sigma, \tau_{1/2}, \sigma_{\text{eq}}, R^2$).
   - Tests normalized z-score calculation ($z_t = \frac{b_t - \mu}{\sigma_{\text{eq}}}$).
   - Tests 4-condition entry gating and directional signal generation (`SHORT_BINANCE_LONG_BYBIT` vs `SHORT_BYBIT_LONG_BINANCE`).

2. **Tier 2: Boundary & Corner Cases (Threshold Epsilon & Resilience)**
   - Strict epsilon boundaries testing single-unit quantization around gating thresholds:
     - Z-Score: $|z_t| = 2.19$ (FAIL) vs $|z_t| = 2.20$ (PASS).
     - Gross Basis: $|b_t| = 27.9$ bps (FAIL) vs $|b_t| = 28.0$ bps (PASS).
     - Orderbook Cushion: $\text{DepthRatio} = 3.99\times$ (FAIL) vs $\text{DepthRatio} = 4.00\times$ (PASS).
     - Bid-Ask Spread: $\text{Spread} = 8.01$ bps (FAIL) vs $\text{Spread} = 8.00$ bps (PASS).
   - Degenerate inputs: Zero-variance series (constant prices), explosive autoregressive coefficients ($\beta \ge 1.0 \implies$ clamped to $0.999$), anti-persistent oscillations ($\beta \le 0 \implies$ clamped to $0.01$).
   - Small sample fallbacks: Sparse series ($N < 5 \implies$ prior fallback $\theta=0.0866, \tau=8.0\text{m}, \sigma=5.0\text{ bps}$), non-finite inputs (`NaN`, `Infinity`, empty arrays).

3. **Tier 3: Combinatorial Permutations (Matrix Stress Testing)**
   - Evaluates the complete matrix of entry gate combinations where individual gates fail in isolation while all other gates pass.
   - Verifies that failure of *any single gate* strictly suppresses trade authorization (`passed = false`).
   - Verifies directional asymmetry handling: Positive basis dislocation ($+32.0$ bps, $+2.4\sigma$) vs negative basis dislocation ($-32.0$ bps, $-2.4\sigma$).

4. **Tier 4: Real-World Scenarios (Stochastic Simulation & Invariants)**
   - Parameter recovery on synthetic Euler-Maruyama stochastic differential equation (SDE) series:
     $$b_{k+1} = b_k + \theta(\mu - b_k)\Delta t + \sigma \sqrt{\Delta t} Z_k, \quad Z_k \sim \mathcal{N}(0, 1)$$
   - Long-run recovery of mean reversion speed $\theta$, equilibrium spread $\mu$, and stationary volatility $\sigma_{\text{eq}}$ within theoretical confidence bands.
   - Dynamic simulation of price shock trajectories, spread convergence, and volatility clustering.

---

## 2. Feature Inventory & Test Mapping

| # | Feature Inventory Item | Test Target File | Tier | Coverage Focus |
|---|------------------------|------------------|------|----------------|
| 1 | Continuous OU Parameter Calibration | `tests/unit/statarb/ouCalibrator.test.ts` | Tier 1 | AR(1) OLS regression, recovery of $\theta, \mu, \sigma, \tau_{1/2}, R^2$ |
| 2 | Small Sample & Sparse Fallbacks | `tests/unit/statarb/ouCalibrator.test.ts` | Tier 2 | $N < 5$ default priors, $N < 30$ sample handling, empty input resilience |
| 3 | Stationarity Safeguards & Clamping | `tests/unit/statarb/ouCalibrator.test.ts` | Tier 2 | $\beta \ge 1.0$ explosive clamp ($0.999$), $\beta \le 0$ anti-persistent clamp ($0.01$) |
| 4 | Zero Variance / Constant Series Handling | `tests/unit/statarb/ouCalibrator.test.ts` | Tier 2 | Constant basis, zero denominator protection, fallback equilibrium sigma |
| 5 | Synthetic Euler-Maruyama SDE Recovery | `tests/unit/statarb/ouCalibrator.test.ts` | Tier 4 | Stochastic trajectory fitting, parameter recovery within statistical tolerances |
| 6 | Real-Time Z-Score Standardization | `tests/unit/statarb/zScoreEngine.test.ts` | Tier 1 | Linear normalization $z_t = (b_t - \mu)/\sigma_{\text{eq}}$, zero sigma guard |
| 7 | Basis Points (bps) Calculation | `tests/unit/statarb/zScoreEngine.test.ts` | Tier 1 | $((P_{\text{BN}} - P_{\text{BYB}}) / P_{\text{BYB}}) \times 10^4$ precision |
| 8 | Multi-Condition Entry Gating (4 Gates) | `tests/unit/statarb/zScoreEngine.test.ts` | Tier 1 | Concurrent evaluation of all 4 pre-flight gates |
| 9 | Boundary Epsilon Testing | `tests/unit/statarb/zScoreEngine.test.ts` | Tier 2 | Border values: $2.19$ vs $2.20$, $27.9$ vs $28.0$ bps, $3.99\times$ vs $4.00\times$, $8.01$ vs $8.00$ bps |
| 10 | Directional Execution Assignment | `tests/unit/statarb/zScoreEngine.test.ts` | Tier 1 | `SHORT_BN_LONG_BYB` ($+b, +z$) vs `SHORT_BYB_LONG_BN` ($-b, -z$) |
| 11 | Entry Gate Combinatorial Matrix | `tests/unit/statarb/zScoreEngine.test.ts` | Tier 3 | Complete permutation grid: single gate failures, partial failures, custom config overrides |
| 12 | Trade Signal Dispatch Formatting | `tests/unit/statarb/zScoreEngine.test.ts` | Tier 1 | Unique signal ID, payload integrity, pass/fail gating reasons |

---

## 3. Test Runner & Execution Commands

The project uses **Vitest** configured in `web/vitest.config.ts`. All test paths are co-located under `web/tests/unit/statarb/`.

### Run All StatArb Tests
```powershell
Set-Location "C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web"
npx vitest run tests/unit/statarb/
```

### Run Specific Test Suites
```powershell
# OU Calibrator Suite
Set-Location "C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web"
npx vitest run tests/unit/statarb/ouCalibrator.test.ts

# Z-Score Engine & Entry Gating Suite
Set-Location "C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web"
npx vitest run tests/unit/statarb/zScoreEngine.test.ts
```

### Continuous Watch Mode (Development)
```powershell
Set-Location "C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web"
npx vitest watch tests/unit/statarb/
```

---

## 4. Test Fixtures Catalog

Located in `web/tests/unit/statarb/fixtures/`:

1. **`ouGenerator.ts`**:
   - Euler-Maruyama stochastic simulator: $b_{k+1} = b_k + \theta(\mu - b_k)\Delta t + \sigma \sqrt{\Delta t} Z_k$.
   - Deterministic seedable pseudo-random number generator (Mulberry32 + Box-Muller normal transform) ensuring 100% reproducible CI test runs.
   - Deterministic exponential decay trajectory generator for pure calibration validation without stochastic variance.
   - Ground truth parameter bundles for standard market regimes (low volatility, high mean-reversion, persistent drift).

2. **`entryGateMatrix.ts`**:
   - Comprehensive permutation test cases for entry gate evaluation.
   - Full combinatorial matrix:
     - Clean Pass (Binance rich): $z = +2.40, b = +32.0\text{ bps}, \text{depth} = 5.0\times, \text{spread} = 4.0\text{ bps}$.
     - Clean Pass (Bybit rich): $z = -2.40, b = -32.0\text{ bps}, \text{depth} = 5.0\times, \text{spread} = 4.0\text{ bps}$.
     - Failure Cases: Low Z-Score only, Low Basis only, Shallow Depth only, Wide Binance Spread only, Wide Bybit Spread only, Conflicting Polarities.
     - Borderline Pair Scenarios testing exact floating point boundaries ($2.19$ vs $2.20$, $27.9$ vs $28.0$ bps, $3.99\times$ vs $4.00\times$, $8.01$ vs $8.00$ bps).
