## 2026-11-05T07:26:17Z
You are Forensic Auditor 1 (teamwork_auditor).
Your working directory is: C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\auditor_1\
Your parent is orchestrator (conversation ID: ebc83250-5b77-48fd-89ba-0c0e8d584d07).

CRITICAL REQUIREMENT:
Before doing anything else, read C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\ORIGINAL_REQUEST.md completely to understand all user requirements and acceptance criteria.
DO NOT modify any production trading code in web/ or active execution scripts! You are strictly read-only.

Your assigned scope:
Forensic Integrity Audit across the AI_Hedge_Cockpit research deliverables, codebase, and state files.

Perform comprehensive, unsparing forensic checks:
1. Zero Production Code Modification:
   - Run git checks and PowerShell file timestamp checks across `web/` and `scripts/`.
   - Verify that NO live production trading code in `web/lib/` or active execution scripts was modified during this phase.
2. Requirement R1 & Acceptance Criteria Verification:
   - Verify `docs/PROFIT_UPGRADE_RESEARCH_AUDIT.md` exists and covers ALL 10 key operational areas (maker-taker, latency, spread calculation, sizing/leverage, multi-corridor, funding rate prediction, carry exit, order book depth, risk management, fleet intelligence).
   - Verify each proposed upgrade contains quantitative projected profit impact, implementation complexity, risk assessment, and specific file references (including `web/lib/botEngine.ts` and `web/lib/makerTakerRouter.ts`).
   - Verify authentic telemetry forensics from `trade_audit_permanent.jsonl` (not fabricated numbers).
3. Requirement R2 & Acceptance Criteria Verification:
   - Verify `docs/UPGRADE_ARCHITECTURE_SPECIFICATIONS.md` and `plans/UPGRADE_TASK_PROMPT_TEMPLATES.md` exist.
   - Verify individual, standalone task prompt templates exist for each recommended upgrade with clear scope, technical requirements, verification criteria, and rollback procedures.
   - Verify Maker-Taker routing specification explicitly details transition from mock fills to real exchange limit orders (`GTX`/`PostOnly`) with 8s queue cancellation timeouts and taker fallbacks.
4. Requirement R3 & Acceptance Criteria Verification:
   - Verify `plans/PHASED_TEAM_EXECUTION_PLAN.md` exists, contains sequential phases, dependency DAG, pre-flight gates, and rollback procedures.
   - Verify execution plan references and incorporates existing verification scripts (specifically `scripts/generate_fleet_status_report.js` and `scripts/test_leverage_and_margin_calculator.js`).
5. Anti-Cheat & Anti-Facade Checks:
   - Verify no dummy/facade implementations, no hardcoded test outputs, no fake test assertions.
   - Verify all referenced files, functions, and lines in `web/` actually exist in the live codebase.

Deliverable:
Write your forensic report to `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\auditor_1\handoff.md` with:
- Summary of all forensic checks executed
- Concrete evidence and findings
- Binary verdict: either `CLEAN` or `INTEGRITY VIOLATION` (non-negotiable binary veto)

Send a completion message via `send_message` to orchestrator (ebc83250-5b77-48fd-89ba-0c0e8d584d07).
