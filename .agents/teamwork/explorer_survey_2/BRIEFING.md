# BRIEFING — 2026-11-05T07:05:00Z

## Mission
Investigate Arbitrage Analytics, Spread Calculation, Candidate Scoring, Multi-Corridor Expansion, and Funding Rate Prediction in AI_Hedge_Cockpit (Areas 3, 5, 6) and deliver report.md.

## 🔒 My Identity
- Archetype: teamwork_explorer
- Roles: explorer, analyst, synthesist
- Working directory: C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\explorer_survey_2
- Original parent: ebc83250-5b77-48fd-89ba-0c0e8d584d07
- Milestone: explorer_survey_2

## 🔒 Key Constraints
- Read-only investigation — do NOT modify any production trading code in web/ or active execution scripts
- All outputs written to C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\explorer_survey_2\
- Deliver comprehensive technical report.md covering Areas 3, 5, 6 with exact line numbers, code analysis, upgrade vectors with quantitative profit impact, risk mitigation, and architecture proposals.

## Current Parent
- Conversation ID: ebc83250-5b77-48fd-89ba-0c0e8d584d07
- Updated: 2026-11-05T07:05:00Z

## Investigation State
- **Explored paths**:
  * `web/lib/spreadCalculation.ts`
  * `web/lib/botEngine.ts`
  * `web/lib/exchangeFundingMeta.ts`
  * `web/lib/settlementTime.ts`
  * `web/lib/makerTakerRouter.ts`
  * `web/lib/bybitSigner.ts`, `web/lib/bybitStreamManager.ts`
  * `web/lib/coindcxSigner.ts`, `web/lib/coindcxTradeStream.ts`
  * `web/lib/binanceSigner.ts`, `web/lib/bitgetSigner.ts`
  * `web/components/AllCoinsScanner.tsx`
  * `scripts/execute_all_backtests.py`, `scripts/test_spread_combinations.js`
- **Key findings**:
  * Static fee hurdle (25 bps) and minimum gross spread (35 bps) creates false negatives and false positives.
  * Sorting is strictly 1-D by raw spread, ignoring basis divergence, liquidity depth, and rate persistence.
  * Codebase supports 4 venues (Binance, Bitget, Bybit, CoinDCX) across 6 corridors. OKX and Hyperliquid are completely absent.
  * Capital is siloed per exchange with no cross-venue margin rebalancing.
  * Zero funding rate prediction model: static lastFundingRate is used without tracking the cumulative Premium Index TWAP accumulator.
  * Zero rate half-life / Ornstein-Uhlenbeck mean-reversion modeling.
- **Unexplored areas**: Production live trade modification (strictly avoided as per read-only constraints).

## Key Decisions Made
- Authored comprehensive 7-section report in `report.md` with 9 actionable upgrade vectors, quantitative profit projections, complexity estimates, risk mitigations, and interface specifications.
- Prepared 5-component `handoff.md`.

## Artifact Index
- DISPATCH.md — Initial dispatch log
- BRIEFING.md — Persistent context & identity
- progress.md — Heartbeat and status
- report.md — Final comprehensive technical investigation report (Areas 3, 5, 6)
- handoff.md — 5-component handoff report
