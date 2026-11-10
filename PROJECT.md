# Project: Divergence Bot (Anti-Convergence Basis Expansion Engine) & /divergence Cockpit

## Architecture
Autonomous delta-neutral cross-exchange basis expansion trading engine operating between Binance USD-M Perpetuals and Bybit Linear Perpetuals, with dedicated Next.js `/divergence` cockpit page, state isolation, and zero-loss risk guards.

```
                   ┌─────────────────────────────────────────────────────────┐
                   │               Divergence Engine Daemon                  │
                   │               (State Store & FSM Loop)                  │
                   └───────────┬─────────────────────────────────┬───────────┘
                               │                                 │
           ┌───────────────────┴──────────┐       ┌──────────────┴───────────────────┐
           ▼                              ▼       ▼                                  ▼
┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
│   Dispersion Scanner    │   │   Order Execution       │   │  Exit & Risk Breakers   │
│ (24h Dispersion >=0.400%│   │   Router                │   │  - Relative Expansion   │
│  Live Comp <=0.100%     │   │  - Discrete Lot Quantum │   │    (>= +0.380%)         │
│  Anti-Collision <=5.000%│   │  - Leg 1 Maker Limit    │   │  - Net PnL >= +$0.0100  │
│  Directional DDI Skew)  │   │  - 8s Watchdog / 120ms  │   │  - Dynamic Carry Ratchet│
└──────────┬──────────────┘   │  - 500ms Reconciler     │   │  - Adverse Stop -0.150% │
           │                  │  - Leg 2 WS IOC Taker   │   │  - Stagnancy 180m/360m  │
           │                  │  - reduceOnly: true     │   └─────────────┬───────────┘
           │                  └───────────┬─────────────┘                 │
           ▼                              ▼                               ▼
┌─────────────────────────┐   ┌───────────────────────────────────────────────────────┐
│   Next.js API Routes    │   │                     Exchange Layer                    │
│ /api/divergence/radar   │   │           Binance USD-M    ↔    Bybit Linear          │
│ /api/divergence/daemon  │   │  (Post-Only Maker GTX)   (Sub-35ms WebSocket IOC)     │
│ /api/divergence/audit   │   └───────────────────────────────────────────────────────┘
└──────────┬──────────────┘
           ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                       Next.js Cockpit UI (/divergence)                              │
│  - DispersionRadar (SVG Canvas, Prime Expansion Zone)                               │
│  - CandidateFeed (5-gate checklist, deploy latch)                                   │
│  - ActivePositionsTable (signed relative progress, stagnancy timer, drift badges)   │
│  - AuditLedger (authentic receipts, zero mock seeds)                                │
│  - Navbar Integration (desktop & mobile dock >= 44px)                               │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Live Relative Basis ($b_t$) | Symmetric mid-price percentage basis $b_t = \frac{2(P_{BN} - P_{BYB})}{P_{BN} + P_{BYB}} \times 100\%$ | M2 | Survey |
| 2 | 24-Hour Peak Dispersion ($\Delta b_{24h}$) | Rolling 24-hour maximum absolute basis dislocation envelope | M2 | Survey |
| 3 | 24h Dispersion Gate | Filter requiring $\Delta b_{24h} \ge 0.400\%$ | M2 | Survey |
| 4 | Live Compression Gate | Filter asserting asset is coiled near parity $\|b_t\| \le 0.100\%$ | M2 | Survey |
| 5 | Anti-Collision Sanity Gate | Rejects pairs with extreme cross-venue disparity $\|P_{BN} - P_{BYB}\| / P_{mid} > 5.000\%$ | M2 | Survey |
| 6 | Directional Dispersion Index ($DDI_{24h}$) | Quantifies historical skewness in 24h dispersion envelope | M2 | Survey |
| 7 | Deterministic Direction Routing | Assigns Direction 1 (Long BN / Short BYB) vs Direction 2 (Short BN / Long BYB) | M2 | Survey |
| 8 | Compression Runway Buffer Guard | Ensures entry point leaves adequate room within 24h envelope | M2 | Survey |
| 9 | Carry Drag & Settlement Lockout | Protects against holding through adverse funding settlement | M3 | Survey |
| 10 | Relative Basis Expansion ($\Delta b_{expansion}$) | SOLE trigger for take-profit, measured relative to entry basis | M3 | Survey |
| 11 | Take-Profit & Zero-Loss Gate | Triggers exit only on expansion hurdle AND Net PnL $\ge +\$0.0100\text{ USDT}$ | M3 | Survey |
| 12 | Dynamic Take-Profit Carry Ratchet | Widens target basis by accumulated funding drag ($\Delta b_{target} + \|\sum r_{carry}\|$) | M3 | Survey |
| 13 | Adverse Divergence Stop-Loss | Immediate emergency unwind if basis diverges against trade by $\le -0.150\%$ | M3 | Survey |
| 14 | Dual-Horizon Stagnancy Breaker | Scratch exit at 180m; dynamic $+60\text{m}$ extension if expanding; 360m hard ceiling | M3 | Survey |
| 15 | Capital & Position Ceilings | Hard-locked: maxConcurrentPositions = 1, maxCapitalAllocationUsdt = $15.00 USDT | M1 | Survey |
| 16 | Discrete Lot Quantum Sizing | Sizes order quantities to exact LCM of step size and multipliers ($Save: \|\Delta_{net}\| < 0.001$) | M3 | Survey |
| 17 | Contract Multiplier Normalization | Normalizes non-standard contracts (1000PEPE, 10000SATS, etc.) | M3 | Survey |
| 18 | Leg 1 Post-Only Maker Dispatch | Top-of-book maker limit (GTX/PostOnly) with 8s timeout, micro-repricing, 120ms drift cancel | M3 | Survey |
| 19 | 500ms Partial Fill Reconciler | Balances executed Leg 1 quantity and prevents orphan exposure | M3 | Survey |
| 20 | Leg 2 Sub-35ms WebSocket IOC Taker | Dispatches immediate taker hedge upon Leg 1 fill; 500ms REST fallback | M3 | Survey |
| 21 | 3-Stage Emergency Market Unwind | Unwinds unhedged exposure or emergency stops: Stage 1 (0ms) $\to$ Stage 2 (100ms) $\to$ Stage 3 (200ms) | M3 | Survey |
| 22 | Mandatory `reduceOnly: true` Guard | Enforces position reduction on ALL exits, trims, and stops | M3 | Survey |
| 23 | Parameterized Daemon Lock Manager | Parameterized with `lockFileName?: string`, enabling `data/divergence_daemon.lock` | M1 | Survey |
| 24 | Pre-Dispatch In-Flight Intent Journal | Crash-recovery journal persisted to `data/divergence_inflight.json` before Leg 1 dispatch | M1 | Survey |
| 25 | Windows-Compatible Atomic Persistence | Atomic JSON persistence with EPERM/EBUSY fallback at `data/divergence_state.json` | M1 | Survey |
| 26 | Dual-Exchange Crash Recovery Protocol | Reconciles unhedged orphans or restarts active positions on engine boot | M1 | Survey |
| 27 | API Route `/api/divergence/daemon` | Engine control, telemetry, FSM transitions, and manual operations | M3 | Survey |
| 28 | API Route `/api/divergence/radar` | Real-time candidate opportunities stream with 2,500ms cache | M2 | Survey |
| 29 | API Route `/api/divergence/audit` | 100% genuine execution audit history verified from exchange receipts | M3 | Survey |
| 30 | Global Navbar Integration | Desktop nav row and mobile bottom dock link to `/divergence` with $\ge 44\text{px}$ touch target | M4 | Survey |
| 31 | Executive Telemetry HUD | 4-card executive strip (Engine Status, Radar Scanner, Active Exposure & Delta, Realized Net Alpha) | M4 | Survey |
| 32 | Dispersion Radar Canvas | Responsive SVG 2D scatter plot mapping 24h Peak Dispersion vs Live Basis with Prime Expansion Zone | M4 | Survey |
| 33 | Candidate Opportunity Feed | Ranked table of qualifying opportunities with 5-gate checklist and confirmation latch | M4 | Survey |
| 34 | Active Positions Table | Real-time hedged positions with signed relative expansion progress bar and stagnancy timers | M4 | Survey |
| 35 | Authentic Fill Audit Ledger | Real-money execution audit receipts with zero synthetic seed data | M4 | Survey |
| 36 | Daemon Controls & Drawer | Primary control buttons and parameter adjustment drawer | M4 | Survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Foundation, State & Lock Isolation | TypeScript types (`types.ts`), isolated state store (`divergence_state.json`), in-flight journal (`divergence_inflight.json`), parameterized `daemonLockManager.ts` (`lockFileName?: string`), capital limits hard-locked ($15.00 USDT, max 1 position) | none | DONE |
| M2 | 24h Dispersion Scanner & Radar API | `scanner.ts` (rolling 24h klines, $\Delta b_{24h} \ge 0.400\%$, $\|b_t\| \le 0.100\%$, anti-collision sanity $\le 5.000\%$, DDI direction routing), API route `web/app/api/divergence/radar/route.ts` | M1 | IN_PROGRESS |
| M3 | Strategy Engine & Execution Router | `engine.ts` (discrete lot quantum matching $\|\Delta_{net}\| < 0.001$, Leg 1 maker limit 8s/120ms, Leg 2 sub-35ms WS IOC taker, 500ms partial fill reconciler, mandatory `reduceOnly: true`, dynamic TP carry ratchet, net PnL $\ge +\$0.0100$ USDT, dual-horizon stagnancy breaker 180m/360m, adverse stop $\le -0.150\%$, client order IDs `div1_`/`div2_`), API routes `daemon/route.ts` and `audit/route.ts` | M1, M2 | PLANNED |
| M4 | Dedicated Cockpit UI Page (`/divergence`) | Next.js page at `web/app/divergence/page.tsx` with 2,500ms polling, background tab throttle, visibilitychange sync; components `DispersionRadar.tsx`, `CandidateFeed.tsx`, `ActivePositionsTable.tsx`, `AuditLedger.tsx`, `DivergenceTelemetryHUD.tsx`, `DaemonControls.tsx`; `Navbar.tsx` integration | M2, M3 | PLANNED |
| M5 | Full Test Suite Pass & Adversarial Hardening | Phase 1: 100% pass of E2E test suite (Tiers 1-4); Phase 2: Adversarial coverage hardening (Tier 5); Clean production build (`npm run build`); Certification of Zero BPS notation, Zero Legacy References, PAUSED Mode Default (`isRunning: false`), and Delta-Neutrality ($Save: \|\Delta_{net}\| < 0.001$) | M1, M2, M3, M4, E2E | PLANNED |
| E2E | E2E Testing Track | Comprehensive opaque-box test suite across Tiers 1-4 in `web/tests/unit/divergence/` and end-to-end integration tests; publishes `TEST_READY.md` | M1 (Interface Contracts) | DONE |

## Interface Contracts

### 1. State Store Contract (`web/lib/divergence/types.ts`)
```typescript
export interface DivergenceStateSchema {
  version: string;
  isRunning: boolean; // MUST DEFAULT TO false
  fsmState: 'PAUSED' | 'IDLE' | 'SCANNING' | 'BALANCING' | 'RECONCILING' | 'ACTIVE_EXPANDING' | 'EXITING' | 'SCRATCH_UNWINDING' | 'EMERGENCY_STOPPING' | 'EMERGENCY_KILLED';
  config: DivergenceConfig;
  activePositions: Record<string, DivergencePosition>;
  closedPositions: DivergenceClosedPosition[];
  telemetry: DivergenceTelemetry;
  lastUpdated: number;
}

export interface DivergenceConfig {
  maxConcurrentPositions: number; // Hard-locked: 1
  maxPositionsPerSymbol: number;   // Hard-locked: 1
  maxCapitalAllocationUsdt: number; // Hard-locked: 15.00
  orderNotionalUsdt: number;       // Hard-locked: 15.00
  minDispersion24hPercent: number; // 0.400%
  maxLiveCompressionPercent: number; // 0.100%
  antiCollisionSanityPercent: number; // 5.000%
  relativeExpansionTargetPercent: number; // 0.380% (range 0.350% - 0.400%)
  zeroLossNetHurdleUsdt: number;   // 0.0100 USDT
  adverseStopLossPercent: number;  // -0.150%
  nominalStagnancyMinutes: number; // 180m
  maxStagnancyCeilingMinutes: number; // 360m
  makerWatchdogMs: number;         // 8000ms
  adverseDriftWatchdogPercent: number; // 0.080%
  adverseDriftSampleMs: number;    // 120ms
  wsWatchdogTimeoutMs: number;     // 500ms
  partialFillReconcileMs: number;  // 500ms
}
```

### 2. Lock Manager Parameterization Contract (`web/lib/daemonLockManager.ts`)
```typescript
export interface AcquireLockOptions {
  lockFileName?: string; // defaults to 'bot_daemon.lock'
  force?: boolean;
}

export function acquireDaemonLock(opts?: AcquireLockOptions | boolean): Promise<DaemonLockPayload>;
export function releaseDaemonLock(opts?: AcquireLockOptions): Promise<void>;
export function isDaemonRunning(opts?: AcquireLockOptions): Promise<boolean>;
```

### 3. Scanner Contract (`web/lib/divergence/scanner.ts`)
```typescript
export interface DivergenceCandidate {
  symbol: string;
  binancePrice: number;
  bybitPrice: number;
  midPrice: number;
  liveBasisPercent: number; // bt
  dispersion24hPercent: number; // max |bt| over 24h
  ddi24h: number; // Directional Dispersion Index [-1, 1]
  suggestedDirection: 'LONG_BN_SHORT_BYB' | 'SHORT_BN_LONG_BYB';
  gatesPassed: {
    dispersion: boolean; // >= 0.400%
    compression: boolean; // <= 0.100%
    antiCollision: boolean; // <= 5.000%
    runwayBuffer: boolean;
    carryFeasibility: boolean;
  };
  netAlphaProjectedPercent: number;
  timestamp: number;
}

export function scanDivergenceUniverse(): Promise<DivergenceCandidate[]>;
```

### 4. Execution Router Contract (`web/lib/divergence/execution/orderRouter.ts`)
```typescript
export interface ExecutionResult {
  success: boolean;
  positionId?: string;
  leg1Fill?: OrderFillReceipt;
  leg2Fill?: OrderFillReceipt;
  reconciliationAction?: 'NONE' | 'TRIMMED' | 'UNWOUND';
  error?: string;
}

export function executeDivergenceEntry(
  candidate: DivergenceCandidate,
  config: DivergenceConfig
): Promise<ExecutionResult>;

export function executeDivergenceExit(
  position: DivergencePosition,
  reason: 'EXPANSION_TP' | 'STAGNANCY_SCRATCH' | 'ADVERSE_STOP' | 'MANUAL_UNWIND' | 'EMERGENCY_KILL',
  config: DivergenceConfig
): Promise<ExecutionResult>;
```

## Code Layout
- `web/lib/daemonLockManager.ts` — Parameterized lock manager with `lockFileName?: string`
- `web/lib/divergence/types.ts` — Core TypeScript definitions & state schemas
- `web/lib/divergence/scanner.ts` — 24h rolling dispersion & live compression scanner
- `web/lib/divergence/engine.ts` — FSM state machine, entry gating, dynamic TP carry ratchet, and stagnancy breakers
- `web/lib/divergence/execution/orderRouter.ts` — Leg 1 Maker limit, Leg 2 sub-35ms WS IOC taker, 500ms reconciler, and 3-stage emergency unwind
- `web/lib/divergence/store/stateStore.ts` — Atomic Windows-safe state store & in-flight intent journal
- `web/app/api/divergence/daemon/route.ts` — Daemon lifecycle and control API
- `web/app/api/divergence/radar/route.ts` — Real-time candidate feed API with 2,500ms caching
- `web/app/api/divergence/audit/route.ts` — 100% authentic fill ledger API
- `web/app/divergence/page.tsx` — Dedicated Next.js cockpit page with 2,500ms visibility-aware polling
- `web/components/Navbar.tsx` — Updated navigation bar with `/divergence` link (desktop + mobile dock >= 44px)
- `web/components/divergence/` — Specialized cockpit UI components (`DispersionRadar.tsx`, `CandidateFeed.tsx`, `ActivePositionsTable.tsx`, `AuditLedger.tsx`, `DivergenceTelemetryHUD.tsx`, `DaemonControls.tsx`)
- `web/tests/unit/divergence/` — Comprehensive unit test suites (M1 through M5)
- `data/divergence_state.json` — Isolated state file
- `data/divergence_inflight.json` — In-flight intent journal
- `data/divergence_daemon.lock` — Dedicated daemon lockfile
