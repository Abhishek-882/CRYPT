# Original User Request

## Parameters

[skip-interview]
How this run was launched; not part of the task.

## Initial Request — 2026-11-05T06:51:00Z

Launch a mad research leader that explores every thought and every way for upgrades and boosting profits across the autonomous delta-neutral funding rate arbitrage bot codebase, delivering comprehensive architectural specifications, prompt templates, and a ready-to-launch team plan (/plan).

Working directory: C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
Integrity mode: development

## Requirements

### R1. Bot Audit and Profit-Boosting Upgrade Research
Perform an exhaustive research audit across the autonomous delta-neutral funding rate arbitrage codebase (`AI_Hedge_Cockpit`) and live telemetry to identify, evaluate, and prioritize every viable upgrade vector for maximizing net profitability and yield. Evaluate all key operational areas including maker vs. taker fee optimization with real exchange limit orders, execution latency and WebSocket/REST pipelines, spread calculation accuracy and candidate scoring, position sizing and dynamic leverage, multi-corridor exchange expansion, funding rate prediction and timing, carry continuation and exit strategies, order book depth analysis, protective risk management, and fleet intelligence. Do not modify live trading code directly during this research phase.

### R2. Upgrade Architecture Specifications and Actionable Prompts
For each high-conviction upgrade opportunity identified, produce detailed architectural specifications including quantitative profit-to-risk impact projections, prerequisite dependencies, and edge-case mitigations. Provide ready-to-use, modular task prompt templates tailored for subsequent specialized implementation agents to execute each upgrade cleanly.

### R3. Ready-to-Launch Team Execution Plan
Synthesize the prioritized upgrades and prompts into an end-to-end, phased team execution plan (/plan) detailing milestone sequencing, validation gates, risk controls, and resource allocation. Save all research reports, architectural specifications, prompt templates, and execution plans within the project repository under `docs/` and `plans/`.

## Acceptance Criteria

### Research Deliverables
- [ ] An audit document is written to `docs/` detailing concrete upgrade opportunities across all 10 key operational areas (fee optimization, execution speed, spread calculation, sizing/leverage, multi-corridor, funding rate prediction, exit strategies, risk management, order book depth, fleet intelligence).
- [ ] Each proposed upgrade includes quantitative projected profit impact, implementation complexity, risk assessment, and specific file references in the codebase (including `web/lib/botEngine.ts` and `web/lib/makerTakerRouter.ts`).
- [ ] No live production trading code in `web/` or active execution scripts is modified during this phase.

### Prompts and Implementation Specifications
- [ ] Individual, standalone task prompt templates are generated for each recommended upgrade, containing clear scope, technical requirements, and verification criteria for execution agents.
- [ ] The maker-taker routing specification explicitly details the transition from mock fills to real exchange limit orders with taker fallbacks.

### Team Execution Plan
- [ ] A phased execution plan (/plan) is saved to `plans/` containing sequential implementation phases, dependency graphs, pre-flight test gates, and rollback procedures.
- [ ] The execution plan references and incorporates existing verification scripts (including `scripts/generate_fleet_status_report.js`) for post-implementation validation.


## Follow-up — 2026-11-06T15:55:58Z

Remediation progress noted. Bot 3 is actively running live with 151/151 tests passing. Please complete the final 2 tasks (ouCalibrator numerical bounds & radar feed enrichment), execute the full verification gate (vitest, tsc, and build), and deliver your final summary.

## Follow-up — 2026-11-06T17:07:00Z

Transition the standalone `STATARB-OU-PERP` engine (Cross-Exchange Statistical Arbitrage & Ornstein-Uhlenbeck Convergence Sweeper between Binance USD-M Perpetuals and Bybit Linear Perpetuals) from simulated execution to 100% real live on-exchange trading. Research and improve the execution strategy to guarantee delta-neutrality, zero-loss discipline, and order-routing robustness under live market conditions.

Working directory: C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
Integrity mode: development

## Core Research & Execution Objectives

### 1. Contract Normalization & Delta-Neutrality Invariant
- Research and enforce contract multiplier normalization (e.g. 1,000 vs 10,000 units on SATS/PEPE) via `normalizeQuantity()` so Leg 2 IOC taker quantity exactly matches Leg 1 base exposure (|Delta_net| < 0.001).
- Implement exchange filter guards: round price to `tickSize` and quantity to `stepSize`, enforcing exchange `minNotional` ($5.00 USDT minimum) before order dispatch.

### 2. Live Exchange Adapter & High-Speed WebSocket Routing (`web/lib/statarb/execution/liveExchangeAdapter.ts`)
- Implement `LiveExchangeAdapter` implementing `ExchangeExecutionAdapter` using active credentials (`usr_admin_varsha` via `cryptoVault` / `web/.env.local`).
- Leg 1: Post-Only Maker Limit (GTX on Binance / PostOnly on Bybit) with 8-second watchdog, micro-repricing on book-cross rejections, and 120ms adverse drift cancel.
- Leg 2: Sub-35ms IOC Taker dispatched via `binanceTradeStream` / `bybitTradeStream` immediately upon Leg 1 fill confirmation.
- Emergency unwind guard to eliminate orphan legs if Leg 2 fails.

### 3. Quantitative Zero-Loss Gate & Fee Friction Invariant
- Enforce Gate 5 (Pre-Flight Net-Edge): Gross spread must exceed 0.080% (covering Binance 0.020% Maker fee + Bybit 0.055% Taker fee + slippage buffer).
- Enforce Exit Optimizer: Mandatory net profit hurdle of >= +$0.0100 USDT after deducting all roundtrip exchange fees.
- Enforce Invariant 6 (30 min persistence breaker) and Invariant 7 (sticky decoupling).

### 4. Engine Integration & Telemetry Integrity
- Wire `LiveExchangeAdapter` into `StatArbEngine` and `web/app/api/convergence/daemon/route.ts` when `dryRun: false`.
- Purge mock seed data from `web/app/api/convergence/audit/route.ts` so all audit metrics reflect 100% genuine on-exchange execution.

### 5. Verification Suite & Clean Build
- Update unit tests in `web/tests/unit/statarb/` to verify multiplier normalization, filter guards, and live adapter behavior under mock network conditions.
- Ensure a clean Next.js build (`npm run build`) with zero TypeScript errors.

## Acceptance Criteria
- [ ] Comprehensive implementation plan artifact (`/plan`) presented for user review (`RequestFeedback: true`).
- [ ] Contract multiplier normalization strictly enforced across Binance and Bybit.
- [ ] `LiveExchangeAdapter` dispatches signed Post-Only Maker (Leg 1) and WebSocket IOC Taker (Leg 2).
- [ ] Gate 5 (0.080% net edge) and zero-loss exit (>= +$0.01 USDT) verified.
- [ ] Mock seed data purged from audit logs.
- [ ] Zero references to any legacy basis bot; all spreads/gaps formatted in % (zero "bps").
- [ ] Vitest unit tests pass and `npm run build` succeeds with 0 errors.

## Follow-up — 2026-11-06T19:35:34Z

Transition the standalone STATARB-OU-PERP engine (Cross-Exchange Statistical Arbitrage & Ornstein-Uhlenbeck Convergence Sweeper between Binance USD-M Perpetuals and Bybit Linear Perpetuals) from simulated execution to 100% real live on-exchange trading.

Working directory: C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
Integrity mode: development

Resume execution directly from Milestone 2 of C:\Users\Administrator\.gemini\antigravity\brain\1d2bf9be-31cc-4a00-bea0-9564b0cbc34b\STATARB_LIVE_REAL_EXCHANGE_PLAN.md:
1. Milestone 2: Build `web/lib/statarb/execution/liveExchangeAdapter.ts` implementing `ExchangeExecutionAdapter` using live credentials (`usr_admin_varsha` via `cryptoVault` / `web/.env.local`).
   - Leg 1: Post-Only Maker Limit (`GTX` on Binance / `PostOnly` on Bybit) with book-cross micro-repricing, 8s watchdog, and 120ms adverse drift cancel.
   - Leg 2: Sub-35ms WebSocket IOC Taker via `binanceTradeStream` / `bybitTradeStream` with emergency market unwind.
2. Milestone 3:
   - Enforce Gate 5 (Pre-Flight Net-Edge >= 0.080% in `zScoreEngine.ts`, `statArbStateStore.ts`, and `radar/route.ts`).
   - Enforce Zero-Loss Exit Gate (>= +$0.0100 USDT net of all roundtrip fees).
   - Purge mock seed trades (`ensureInitialSeedData`) and synthetic latencies from `web/app/api/convergence/audit/route.ts` so telemetry reflects genuine on-exchange execution only.
   - Ensure all spreads and price gaps in UI components are formatted strictly in % (zero "bps" notation).
3. Milestone 4: Wire `LiveExchangeAdapter` into `StatArbEngine` and `web/app/api/convergence/daemon/route.ts` when `dryRun: false`.
4. Milestone 5:
   - Run unit tests in `web/tests/unit/statarb/` (all must pass).
   - Run clean production build (`npm run build`) with zero errors.
   - Launch the bot in live execution mode (`dryRun: false`) and verify active running status.

Strict Constraints:
- Zero mentions, names, or references to any legacy basis bot across code, docs, and UI.
- All spreads and price gaps formatted in % (never "bps").
- The user is sleeping: execute autonomously with NO questions.

## Follow-up — 2026-11-06T19:54:34Z

All 5 Milestones of STATARB-OU-PERP Live Real-Exchange Trading Plan have been completed, verified with 152/152 passing Vitest tests, cleanly built with npm run build (0 errors), and the production live daemon is running in dryRun: false with LiveExchangeAdapter, Gate 5 net edge hurdle (>= 0.080%), zero-loss exit hurdle (>= +$0.0100 USDT), mock seed data completely purged, and 100% percentage notation throughout. Updated picture has been rendered to new_bot_trade_table.png.

## Follow-up — 2026-11-07T01:17:22Z

Resume active duties as Live Real-Exchange Trading Lead. The convergence engine STATARB-OU-PERP is now LIVE ON-EXCHANGE (dryRun: false, fsmState: RUNNING).
1. Verify live order routing, Gate 0 pre-flight, and 60-minute quarantine protection.
2. Confirm both Binance and Bybit positions remain 0.000 (delta neutral) or properly hedged.
3. Validate that all closed trades and active telemetry reflect 100% authentic on-exchange ledgers (zero formulas).
4. Verify rate limit consolidation (single bulk bookTicker on Binance, single linear tickers on Bybit).
Report your live operational verification findings.
