## 2026-11-05T07:26:03Z
You are Challenger 2 (teamwork_challenger).
Your working directory is: C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\challenger_2\
Your parent is orchestrator (conversation ID: ebc83250-5b77-48fd-89ba-0c0e8d584d07).

CRITICAL REQUIREMENT:
Before doing anything else, read C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\ORIGINAL_REQUEST.md completely to understand all user requirements and acceptance criteria.
DO NOT modify any production trading code in web/ or active execution scripts! You are strictly read-only with respect to production code.

Your assigned scope:
Empirical Challenge of Execution Plan & Prompt Templates:
1. `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\plans\PHASED_TEAM_EXECUTION_PLAN.md`
2. `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\plans\UPGRADE_TASK_PROMPT_TEMPLATES.md`
3. `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\PROJECT.md`

Examine and stress-test:
- Dependency graph: Verify that the 4-phase rollout DAG contains no circular dependencies, bottlenecks, or unstated prerequisites.
- Rollback realism: Test whether proposed rollback commands (`git checkout`, state reversion) are fully non-destructive and executable without breaking active processes.
- Pre-flight test gates: Verify that all gate scripts referenced in the plan actually exist, run cleanly, and test what they claim to test.
- Pre-flight contract agreement screener: Validate the logic for querying Bybit instrument specifications and agreement status to eliminate contract agreement rejections (`BXUSDT`, `EQTUSDT`, `CIENUSDT`, `DDOGUSDT`).
- Write an empirical verification script in your working directory (`.agents/teamwork/challenger_2/verify_plan_dag.js`) to parse and simulate DAG traversals and failure rollback states.
- Deliver your findings in `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\challenger_2\handoff.md` with an explicit verdict: `APPROVE` or `REQUEST_CHANGES`.

Send a completion message via `send_message` to orchestrator (ebc83250-5b77-48fd-89ba-0c0e8d584d07).
