# Project: STATARB-OU-PERP Standalone Convergence Sweeper & Cockpit

## Architecture
- **Engine Core (`web/lib/statarb/`)**: 100% standalone execution engine. Evaluates cross-exchange perpetual basis spreads across Binance USD-M and Bybit Linear perpetuals using continuous Ornstein-Uhlenbeck stochastic calculus.
- **Order Execution Layer**: Dispatches Leg 1 as Post-Only Maker limit (`GTX`/`PostOnly`) and Leg 2 as sub-35ms WebSocket IOC Taker hedge.
- **Safety Invariant Guard**: Enforces Invariant 6 (30-min low-watermark persistence breaker) and Invariant 7 (upstream sticky decoupling filter).
- **Exit Optimizer**: Enforces 75% basis compression or $|z_t| \le 0.35$ with strictly guaranteed Zero-Loss Exit ($\ge +\$0.01$ USDT net of all fees).
- **Cockpit Page (`web/app/convergence/page.tsx`)**: Dedicated Next.js 14 App Router UI with custom responsive SVG dynamic Z-score charts, live spread telemetry, controls, and trade execution audit table.
- **Automated Verification Suite (`web/tests/unit/statarb/`)**: Vitest test harness with synthetic price fixtures covering all mathematics, gating, execution, and invariants.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | OU Continuous Parameter Calibration | AR(1) OLS calibration recovering $\theta, \mu, \sigma, \tau$ | M1 | Survey |
| 2 | Real-Time Z-Score Engine | Rolling window spread normalization $z_t = (b_t - \mu)/\sigma_{\text{eq}}$ | M1 | Survey |
| 3 | Order Book Depth Cushion Analyzer | $\ge 4.0\times$ order size book depth within 10 bps verification | M1 | Survey |
| 4 | Bid-Ask Spread Filter | $\le 8.0$ bps spread cap on Binance & Bybit | M1 | Survey |
| 5 | Multi-Condition Entry Gating | $|z_t| \ge 2.2$, gross basis $\ge 28$ bps, depth $\ge 4\times$, spread $\le 8$ bps | M1 | Survey |
| 6 | Invariant 7 Sticky Decoupling Filter | Reject pairs whose divergence has not touched $< 1.0\%$ in 30 mins | M2 | Survey |
| 7 | Invariant 6 Persistence Breaker | Auto-close positions if divergence persists $\ge 1.0\%$ for 30 mins | M2 | Survey |
| 8 | Basis Compression Exit Gate | Exit when basis compresses $\ge 75\%$ from entry basis | M2 | Survey |
| 9 | Z-Score Normalization Exit Gate | Exit when $|z_t| \le 0.35$ | M2 | Survey |
| 10 | Guaranteed Zero-Loss Exit Enforcer | Block exit if net PnL $< +\$0.01$ USDT after all maker/taker fees | M2 | Survey |
| 11 | Leg 1 Post-Only Maker Execution | Place top-of-book GTX limit order with 8s timeout & adverse drift cancel | M3 | Survey |
| 12 | Sub-35ms WebSocket IOC Taker Hedge | Leg 2 WebSocket order sized strictly to Leg 1 fill quantity | M3 | Survey |
| 13 | Standalone Engine Loop | Autonomous scanning and position management with zero legacy dependencies | M3 | Survey |
| 14 | Standalone State Persistence | Atomic JSON persistence in `web/data/statarb_state.json` | M3 | Survey |
| 15 | Dedicated Next.js Route `/convergence` | App router client page in `web/app/convergence/page.tsx` | M4 | Survey |
| 16 | Dynamic SVG Z-Score Chart | Bespoke SVG chart with $\pm 2.2$ entry and $\pm 0.35$ exit bands | M4 | Survey |
| 17 | Telemetry HUD & Radar Table | Live KPI cards and monitored pair status radar | M4 | Survey |
| 18 | Live Controls & Settings Drawer | Start/Stop/Kill controls and configuration sliders | M4 | Survey |
| 19 | Trade Execution Audit Table | Active positions, fill timestamps, IOC latency in ms, and net PnL | M4 | Survey |
| 20 | Cockpit Navigation Integration | Link `/convergence` in `web/components/Navbar.tsx` | M4 | Survey |
| 21 | Convergence API Routes | `/api/convergence/daemon`, `/radar`, `/audit` | M4 | Survey |
| 22 | Synthetic Euler-Maruyama OU Fixture | Calibrator verification against stochastic trajectories | M5 (E2E) | Survey |
| 23 | Entry Gate Matrix Fixture | Test 6 permutations of pass/fail entry gating | M5 (E2E) | Survey |
| 24 | Execution Lifecycle & Partial Fill Fixture | Simulate Leg 1 fill, timeout cancel, partial fill sizing | M5 (E2E) | Survey |
| 25 | Invariant 6 & 7 Timeline Fixtures | 30-min continuous divergence and reset test sequences | M5 (E2E) | Survey |
| 26 | Zero-Loss Exit Gate Enforcer Fixture | Confirm exit blocking for $< +\$0.01$ and approval for $\ge +\$0.01$ | M5 (E2E) | Survey |
| 27 | Full E2E Strategy Test Runner | Complete automated test suite passing with exit code 0 | M5 (E2E) | Survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Math & Calibration Core | `web/lib/statarb/types.ts`, `ouCalibrator.ts`, `zScoreEngine.ts`, `bookDepthAnalyzer.ts` | none | PLANNED |
| M2 | Invariants & Exit Optimizer | `invariantGuard.ts` (Inv 6 & 7), `exitOptimizer.ts` (Zero-Loss & 75% compression) | M1 | PLANNED |
| M3 | Execution Router & Standalone Engine | `orderRouter.ts` (Maker + sub-35ms IOC), `statArbEngine.ts`, `statArbStateStore.ts` | M1, M2 | PLANNED |
| M4 | Dedicated Next.js Cockpit Page | `web/app/convergence/page.tsx`, components, API routes, `Navbar.tsx` | M1, M2, M3 | PLANNED |
| M5 | E2E Testing & Hardening | Full Vitest suite in `web/tests/unit/statarb/`, synthetic fixtures, audit verification | M1, M2, M3, M4 | PLANNED |

## Interface Contracts
### `ouCalibrator` -> `zScoreEngine`
```typescript
interface OUParameters {
  theta: number;        // Speed of mean reversion
  mu: number;           // Long-term equilibrium basis (bps)
  sigma: number;        // Volatility of basis
  halfLifeMinutes: number; // ln(2) / theta
  equilibriumSigma: number; // sigma / sqrt(2*theta)
  rSquared: number;     // Regression goodness-of-fit
}
function calibrateOrnsteinUhlenbeck(observations: number[], dtMinutes?: number): OUParameters;
function calculateZScore(currentBasisBps: number, params: OUParameters): number;
```

### `zScoreEngine` -> `orderRouter`
```typescript
interface EntryGateResult {
  passed: boolean;
  zScore: number;
  basisBps: number;
  depthRatio: number;
  spreadBps: number;
  direction?: 'SHORT_BINANCE_LONG_BYBIT' | 'SHORT_BYBIT_LONG_BINANCE';
  reasons: string[];
}
function evaluateEntryGates(candidate: PairCandidate, params: OUParameters): EntryGateResult;
```

### `invariantGuard` -> `exitOptimizer` & `orderRouter`
```typescript
function checkInvariant7StickyDecoupling(divergenceHistory30m: number[]): { passed: boolean; minDivergence: number };
function checkInvariant6PersistenceBreaker(positionHoldMinutes: number, divergenceHistory30m: number[]): { triggered: boolean; durationMinutes: number };
function evaluateZeroLossExit(position: StatArbPosition, currentBasisBps: number, params: OUParameters): ExitGateResult;
```

## Code Layout
- `web/lib/statarb/types.ts` - Domain types
- `web/lib/statarb/math/` - Continuous OU calibration and z-score calculation
- `web/lib/statarb/execution/` - Order routing, zero-loss exit gate, invariant guards
- `web/lib/statarb/engine/` - Standalone engine scanning loop, state store, safety breakers
- `web/lib/statarb/index.ts` - Standalone strategy public facade
- `web/app/convergence/page.tsx` - Next.js Cockpit page
- `web/components/convergence/` - Dedicated UI components (HUD, SVG chart, radar, audit table, controls)
- `web/app/api/convergence/` - Backend API routes (daemon, radar, audit)
- `web/tests/unit/statarb/` - Automated unit and integration test suite with synthetic fixtures
