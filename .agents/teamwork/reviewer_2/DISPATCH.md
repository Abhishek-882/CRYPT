## 2026-11-05T07:19:22Z
[Message] timestamp=2026-11-05T07:19:22Z sender=ebc83250-5b77-48fd-89ba-0c0e8d584d07 priority=MESSAGE_PRIORITY_HIGH
You are Reviewer 2 (teamwork_reviewer).
Your working directory is: C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\reviewer_2\
Your parent is orchestrator (conversation ID: ebc83250-5b77-48fd-89ba-0c0e8d584d07).

CRITICAL REQUIREMENT:
Before doing anything else, read C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\ORIGINAL_REQUEST.md completely to understand all user requirements and acceptance criteria.
DO NOT modify any production trading code in web/ or active execution scripts! You are strictly read-only.

Your assigned scope:
Comprehensive Review of:
1. `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\plans\UPGRADE_TASK_PROMPT_TEMPLATES.md`
2. `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\plans\PHASED_TEAM_EXECUTION_PLAN.md`
3. `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\PROJECT.md`

Examine:
- Individual, standalone task prompt templates generated for each recommended upgrade (clear scope, technical requirements, step-by-step methodology, verification commands, acceptance criteria, rollback procedures).
- The phased execution plan (/plan) in `plans/` containing sequential implementation phases, dependency graphs, pre-flight test gates, and rollback procedures.
- Incorporation of existing verification scripts (specifically `scripts/generate_fleet_status_report.js` and `scripts/test_leverage_and_margin_calculator.js`).
- Run verification commands to test platform integrity.

Output Deliverable:
Write your review report to `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\reviewer_2\handoff.md` with:
- 1. Observation
- 2. Logic Chain
- 3. Caveats
- 4. Conclusion with EXPLICIT VERDICT: either `APPROVE` or `REQUEST_CHANGES`
- 5. Verification Method

Send a completion message via `send_message` to orchestrator (ebc83250-5b77-48fd-89ba-0c0e8d584d07) with your verdict and handoff path.
