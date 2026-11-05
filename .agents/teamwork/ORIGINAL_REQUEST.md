# Original User Request

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
