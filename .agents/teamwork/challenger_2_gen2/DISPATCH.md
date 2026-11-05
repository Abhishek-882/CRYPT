## 2026-11-05T07:48:05Z
You are Challenger 2 (Generation 2) (teamwork_challenger).
Your working directory is: C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\challenger_2_gen2\
Your parent is orchestrator (conversation ID: ebc83250-5b77-48fd-89ba-0c0e8d584d07).

CRITICAL REQUIREMENT:
Before doing anything else, read C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\ORIGINAL_REQUEST.md completely.
Also read Worker 2's handoff: C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\worker_remediation_2\handoff.md
DO NOT modify any production trading code in web/ or active execution scripts! You are strictly read-only with respect to production code.

Your assigned scope:
Empirical Re-Verification of Execution Plan & Prompt Templates:
1. `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\plans\PHASED_TEAM_EXECUTION_PLAN.md`
2. `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\plans\UPGRADE_TASK_PROMPT_TEMPLATES.md`
3. `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\PROJECT.md`

Examine and verify that all 5 operational remediations from Iteration 1 have been accurately applied:
1. Rollback procedures in prompt templates and plan eliminate `git checkout` and provide safe file-based backup/restoration (`Copy-Item <file>.ts.bak <file>.ts`).
2. Daemon lifecycle instructions document exact Node process commands (`npm run build && npx next start -p 3000` & `node scripts/run_daemon_24_7.js`) and note that `restart_services.bat` calls non-installed services with an interactive pause.
3. Intra-phase milestones modifying `botEngine.ts` are serialized (Phase 2: M2.1 before M2.2; Phase 3: M3.2 before M3.3) or enforce modular sub-library isolation.
4. M4.1 Kelly sizing is decoupled from M3.3 Hyperliquid connector in Section 3 Mermaid DAG and Section 2 scope.
5. Milestone Verification Gates and Pre-Flight Gates explicitly cite the new dedicated unit test files (`contractEligibility.test.ts`, `riskGate.test.ts`, `candidateScoring.test.ts`, `orderBookVwap.test.ts`, etc.).

Run verification commands:
- `node C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\challenger_2\verify_plan_dag.js`
- `node scripts/generate_fleet_status_report.js`
- `node scripts/test_leverage_and_margin_calculator.js`
- `cd web; npx vitest run tests/unit/adversarialOption2StrictSync.test.ts tests/unit/adversarialMacroYieldChallenge.test.ts tests/unit/makerTakerExecution.test.ts`

Deliver your findings to `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\challenger_2_gen2\handoff.md` with an explicit verdict: `APPROVE` or `REQUEST_CHANGES`.
Send a completion message via `send_message` to orchestrator (ebc83250-5b77-48fd-89ba-0c0e8d584d07).
