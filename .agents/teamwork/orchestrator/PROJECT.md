# Project: AI Hedge Cockpit - Profit-Boosting Upgrades & Execution Plan

## Architecture
- **System**: Autonomous Delta-Neutral Funding Rate Arbitrage Cockpit.
- **Execution Flow**: Market Scanner -> Spread Engine (hurdles & basis) -> Candidate Scoring -> MakerTakerRouter -> Exchange Connectors (Binance, Bybit, Bitget, CoinDCX) -> Position Manager & Carry Continuation -> Exit Engine -> RiskGate.
- **Current Limitations**: 
  - Mock fills in live mode for MakerTakerRouter (`MAKER_LIVE_REQUIRES_TAKER_FALLBACK`).
  - Sequential execution delay (60ms) after Leg 1 fill.
  - Dormant Bybit trade WebSocket forcing HTTP REST.
  - Level 1 book ticker heuristic depth instead of L2 VWAP sweeps.
  - Static 25 bps fee hurdle and 1-D greedy spread ranking ignoring basis divergence.
  - Missing high-yield corridors: Hyperliquid (hourly funding) and OKX.
  - Static sizing/leverage ignoring volatility (ATR) and basis variance.
  - Rigid 15-minute exit timeout forcing unhedged closes into wide basis divergence.
  - Bybit agreement rejections triggering emergency market unwinds.

## Feature Inventory
| # | Feature / Upgrade Area | Description | Milestone | Source |
|---|------------------------|-------------|-----------|--------|
| 1 | Real Maker-Taker Limit Order Execution | Replace mock bypass with real Binance `GTX` and Bybit `PostOnly` limit orders with 8s queue timeout and taker fallback | M1, M2 | Explorer 1 |
| 2 | Ultra-Low Latency Execution Pipeline | Eliminate post-fill sequential stagger delay; activate authenticated Bybit Trade WS; stream Binance mark price arrays | M1, M2 | Explorer 1 |
| 3 | Dynamic Fee Modeling & Multi-Factor Scoring | Replace static 25 bps hurdle with exchange VIP tiers; rank by Composite Arbitrage Score (spread, basis, depth, persistence, vol) | M1, M2 | Explorer 2 |
| 4 | Volatility-Adjusted Sizing & Dynamic Leverage | Fractional Kelly sizing ($f^* = \lambda \mu / \sigma^2$) and ATR-scaled leverage tiers; asymmetric margin balance | M1, M2 | Explorer 3 |
| 5 | Multi-Corridor Expansion (Hyperliquid & OKX) | Add Hyperliquid L1 (24 hourly payouts/day) and OKX V5 Unified Account connectors; dynamic cross-venue margin rebalancing | M1, M2 | Explorer 2 |
| 6 | Real-Time Premium Index TWAP Prediction | Calculate real-time cumulative Premium Index TWAP; asymmetric multi-harvest timing (1h vs 8h); microsecond tick sniping | M1, M2 | Explorer 2 |
| 7 | Ornstein-Uhlenbeck Basis Reversion Exits | Replace rigid 15-min timeout with O-U mean reversion stopping time; multi-cycle carry continuation | M1, M2 | Explorer 3 |
| 8 | L2 Depth & True Cumulative VWAP Sweep | Ingest 20-level order book depth; calculate exact cumulative VWAP sweep to prevent slippage on thin altcoins | M1, M2 | Explorer 1 |
| 9 | Dynamic NAV Risk Controls & Circuit Breakers | NAV-scaled risk caps; rolling Pearson ($r_{60s} < 0.80$) & $z$-score ($z > 3.5\sigma$) correlation breaker; pre-flight contract check | M1, M2 | Explorer 3 |
| 10 | Fleet Intelligence & Telemetry Coordination | Shared cross-bot liquidity/risk state; integrate telemetry from `scripts/generate_fleet_status_report.js`; fleet dashboard | M1, M2 | Explorer 3 |
| 11 | Upgrade Architecture Specifications | Detailed quantitative profit-to-risk projections, prerequisites, and edge case mitigations for all 10 areas | M2 | Original Request R2 |
| 12 | Modular Actionable Task Prompts | Standalone, ready-to-use prompt templates for specialized execution agents covering each upgrade | M2 | Original Request R2 |
| 13 | Phased Team Execution Plan (/plan) | Phased rollout roadmap, dependency graphs, pre-flight gates, rollback procedures, incorporating verification scripts | M3 | Original Request R3 |
| 14 | Multi-Agent Review & Forensic Integrity Audit | Independent verification by Reviewers, Challengers, and Forensic Auditor to ensure zero production code tampering & genuine math | M4 | System Protocol |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | Survey & Codebase Telemetry Forensics | 3 parallel Explorers audit code, logs, and telemetry across 10 areas | none | DONE |
| M1 | Profit-Boosting Research Audit Document | Comprehensive audit report written to `docs/PROFIT_UPGRADE_RESEARCH_AUDIT.md` | M0 | IN_PROGRESS |
| M2 | Upgrade Architecture Specifications & Task Prompts | Detailed specs & prompts written to `docs/UPGRADE_ARCHITECTURE_SPECIFICATIONS.md` and `plans/UPGRADE_TASK_PROMPT_TEMPLATES.md` | M1 | PLANNED |
| M3 | Phased Team Execution Plan (/plan) | End-to-end execution roadmap written to `plans/PHASED_TEAM_EXECUTION_PLAN.md` referencing `scripts/generate_fleet_status_report.js` | M2 | PLANNED |
| M4 | Review, Challenger & Forensic Integrity Gate | Reviewers, Challengers, and Forensic Auditor verify all deliverables and enforce zero-tampering | M3 | PLANNED |

## Code Layout
- `docs/PROFIT_UPGRADE_RESEARCH_AUDIT.md`: Master research audit across all 10 areas and telemetry.
- `docs/UPGRADE_ARCHITECTURE_SPECIFICATIONS.md`: Architectural blueprints, formulas, and maker-taker specs.
- `plans/UPGRADE_TASK_PROMPT_TEMPLATES.md`: Modular prompts for execution agents.
- `plans/PHASED_TEAM_EXECUTION_PLAN.md`: Ready-to-launch team execution plan (/plan).
- `PROJECT.md`: Project index and milestone status.
- `web/`: Live production code (STRICTLY READ-ONLY).
- `scripts/`: Operational and verification scripts (e.g., `scripts/generate_fleet_status_report.js`).
