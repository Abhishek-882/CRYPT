# BRIEFING — 2026-11-07T01:18:00Z

## Mission
Coordinate, monitor, and independently audit the live operational verification of STATARB-OU-PERP running live on-exchange (dryRun: false, fsmState: RUNNING): order routing, Gate 0 pre-flight, 60-minute quarantine, delta neutrality (0.000 positions), authentic on-exchange ledgers (zero formulas), and rate limit consolidation (single bulk bookTicker on Binance, single linear tickers on Bybit).

## 🔒 My Identity
- Archetype: sentinel
- Working directory: C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\sentinel
- Orchestrator: c57762ae-f90e-4917-9e74-d8c563f89ec2 (completed)
- Victory Auditor: 16ef45db-e9e6-4070-9b80-7ddfd57ce9f3 (completed, VICTORY CONFIRMED)
- Current Interviewer: c1839757-690d-41d7-bbef-d680f0852bcf (completed & retired)
- Active Orchestrator: a38bffc0-58c4-4c4d-a91c-a2911250e8b5 (in progress)
- Active Victory Auditor: to be spawned on victory claim
- Cron 1 (Progress Reporting */8): 4512da14-fe8d-455e-9a2c-cb4080bbeae1/task-41
- Cron 2 (Liveness Check */10): 4512da14-fe8d-455e-9a2c-cb4080bbeae1/task-42
- Active Orchestrator (M2-M5): 9fd9800e-f91d-4139-b826-e97cd9cdd7ff
- Active Cron 1 (Progress Reporting */8): df86aa39-d1fa-4039-a43c-f7d7bdb1b817/task-40
- Active Cron 2 (Liveness Check */10): df86aa39-d1fa-4039-a43c-f7d7bdb1b817/task-42
- Active Victory Auditor (M2-M5): 4b7594aa-8376-4bc3-9dde-ba7853d7e0a3
- Active Orchestrator (Live Ops): ed9829c0-b9e2-4e7d-9d23-4c71db034f40
- Active Cron 1 (Progress Reporting */8): df86aa39-d1fa-4039-a43c-f7d7bdb1b817/task-277
- Active Cron 2 (Liveness Check */10): df86aa39-d1fa-4039-a43c-f7d7bdb1b817/task-279
- Active Victory Auditor (Live Ops): e45be4bf-dddb-485e-88a6-f9215825709f

## 🔒 Key Constraints
- No technical decisions — relay only
- Victory Audit is MANDATORY before reporting completion
- No modification of live trading code directly during this research phase (integrity mode: development)
- Audit document saved in docs/ covering 10 key operational areas
- Standalone task prompts generated for each recommended upgrade
- Phased team execution plan saved in plans/
- Original request file: C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\ORIGINAL_REQUEST.md
- Operate as a 100% standalone strategy without referencing or depending on any legacy bot systems. Under NO circumstances mention or reference any legacy basis bot.
- Continuous Ornstein-Uhlenbeck parameter calibration and real-time z-scores ($z_t = \frac{b_t - \mu_t}{\sigma_t}$).
- Entry gates: $|z_t| \ge 2.2$, gross basis $\ge 28.0$ bps, book depth $\ge 4.0\times$, bid-ask spread $\le 8.0$ bps.
- Order routing: Leg 1 Maker limit post-only, Leg 2 sub-35ms WebSocket IOC Taker hedge.
- Exit gates: basis compression $\ge 75\%$ or $|z_t| \le 0.35$ with guaranteed Zero-Loss Exit ($\ge +\$0.01$ USDT net of all fees).
- Invariant 6: 30-Minute Low-Watermark Persistence Breaker.
- Invariant 7: Sticky Decoupling Filter (reject pairs whose divergence has not touched $< 1.0\%$ within 30 minutes).
- Dedicated Next.js cockpit page at `/convergence` with live telemetry, z-score charts, spread monitor, bot controls, audit table.
- Comprehensive implementation plan artifact (/plan) with RequestFeedback: true.
- Automated test suite with synthetic price feed fixtures. Clean build with zero TypeScript errors.
- Standalone STATARB-OU-PERP real live on-exchange trading. Never paper trading, never simulation.
- 100% standalone architecture: Never mention, name, or reference any legacy basis bot.
- Zero "bps" notation: all spreads and price gaps formatted as percentages (%) in all user-facing documentation and UI artifacts.
- Zero-Loss Guarantee: Invariant 9 / Gate 5 (Pre-Flight Net-Edge >= 0.080%, accounting for Binance Maker fee 0.020% + Bybit Taker fee 0.055% + slippage buffer) and exit threshold (net profit >= +$0.01 USDT).
- Delta-neutrality invariant: Contract multiplier normalization via normalizeQuantity (|Delta_net| < 0.001) and exchange filter guards (tickSize, stepSize, minNotional >= $5.00 USDT).
- LiveExchangeAdapter: Leg 1 Post-Only Maker Limit (GTX / PostOnly) with 8s watchdog & 120ms adverse drift cancel; Leg 2 sub-35ms IOC Taker via WebSocket.
- Purge mock seed data in `/api/convergence/audit/route.ts`.
- Security Invariant: Never store PAT in `.git/config` or remote URL.
- Autonomous execution mode: user is sleeping, execute autonomously with NO questions.

## User Context
- **Last user request**: Live operational verification of STATARB-OU-PERP (live order routing, Gate 0, 60-min quarantine, 0.000 positions, authentic ledgers, rate limit consolidation).
- **Pending clarifications**: none
- **Delivered results**: Live operational verification mandates verified, independently audited, and certified with VICTORY CONFIRMED.

## Project Status
- **Phase**: complete

## Victory Audit Status
- **Triggered**: yes
- **Verdict**: VICTORY CONFIRMED
- **Retry count**: 0

## Artifact Index
- C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\ORIGINAL_REQUEST.md — Authoritative user request
- C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\sentinel\BRIEFING.md — Persistent working memory
- C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\sentinel\handoff.md — Sentinel handoff report
- C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\orchestrator_live_ops\ — Live Ops Orchestrator working directory
- C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\orchestrator_live_ops\handoff.md — Live Ops Orchestrator handoff report
- C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\victory_auditor_live_ops\ — Live Ops Victory Auditor working directory
- C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\victory_auditor_live_ops\handoff.md — Victory Auditor full report
- C:\Users\Administrator\.gemini\antigravity\brain\1d2bf9be-31cc-4a00-bea0-9564b0cbc34b\STATARB_LIVE_REAL_EXCHANGE_PLAN.md — Master plan
