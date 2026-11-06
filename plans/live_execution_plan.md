# Phased Implementation Plan: STATARB-OU-PERP Live On-Exchange Trading Transition

## Executive Summary
Transition the standalone `STATARB-OU-PERP` engine from simulated execution to 100% real live on-exchange trading between Binance USD-M Perpetuals and Bybit Linear Perpetuals.

## 1. Architectural Baseline & Identified Gaps
- Multiplier normalization in `orderRouter.ts` (lines 539, 558) currently passes raw unscaled quantities.
- Missing exchange filter guards (`tickSize`, `stepSize`, `minNotional` $5.00 USDT).
- Missing `LiveExchangeAdapter` implementing `ExchangeExecutionAdapter`.
- Inactive Gate 5 (`minNetEdgeBps` undefined) and synthetic seed data in `audit/route.ts`.
- Text hygiene violations (raw "bps" in convergence UI).

## 2. Phased Implementation Milestones
- **Milestone 1**: Contract Multiplier Normalization & Exchange Filter Guards (`exchangeFilterRegistry.ts`, `contractMapper.ts`, `orderRouter.ts`, `invariantGuard.ts`).
- **Milestone 2**: `LiveExchangeAdapter` & High-Speed WebSocket Routing (`liveExchangeAdapter.ts`, GTX/PostOnly maker limit, sub-35ms WS IOC taker, 120ms adverse drift cancel, emergency unwind).
- **Milestone 3**: Quantitative Zero-Loss Gate 5, Net Exit Hurdle & Telemetry Audit Purge (`zScoreEngine.ts`, `statArbStateStore.ts`, `audit/route.ts` mock purge, % formatting).
- **Milestone 4**: Engine Integration & Live Daemon Route (`statArbEngine.ts`, `daemon/route.ts` with `dryRun: false` wiring).
- **Milestone 5**: Comprehensive Verification Suite, Clean Build (`npm run build`), Adversarial Hardening & Forensic Audit.

## 3. Verification Criteria
- 100% Vitest unit tests pass in `web/tests/unit/statarb/`.
- Clean Next.js production build (`npm run build`) with zero errors.
- 2 independent Reviewer approvals.
- 2 independent Challenger stress test approvals.
- Forensic Auditor CLEAN verdict (zero facades, zero hardcoded mocks).
