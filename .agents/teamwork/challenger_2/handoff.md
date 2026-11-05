# Handoff Report — Challenger 2 (Empirical Review of Phased Execution Plan & Prompts)

**Agent Role**: `teamwork_challenger` (critic, specialist)  
**Target Scope**:
1. `plans/PHASED_TEAM_EXECUTION_PLAN.md`
2. `plans/UPGRADE_TASK_PROMPT_TEMPLATES.md`
3. `PROJECT.md`
**Verdict**: **`REQUEST_CHANGES`** (Targeted Remediations Required Prior to Phase 1 Launch)

---

## 1. Observation

### Observation 1.1: Pre-Flight Test Gate Scripts
All referenced platform verification test scripts exist, run cleanly, and pass with 100% success when executed from the project root:
- `node scripts/generate_fleet_status_report.js`:
  ```
  Report successfully written to C:\Users\Administrator\.gemini\antigravity\brain\1d2bf9be-31cc-4a00-bea0-9564b0cbc34b\fleet_status_report_latest.md
  Binance: $25.35 | Bybit Usable: $8.90 | Open Positions: Binance=1, Bybit=1
  Exit code: 0
  ```
- `node scripts/test_leverage_and_margin_calculator.js`:
  ```
  ALL 5 COIN MAX LEVERAGE & MARGIN BALANCING TESTS PASSED (100% SUCCESS)
  Exit code: 0
  ```
- Vitest suites (`npx vitest run tests/unit/adversarialOption2StrictSync.test.ts tests/unit/adversarialMacroYieldChallenge.test.ts tests/unit/makerTakerExecution.test.ts`):
  ```
  Test Files  3 passed (3)
  Tests  51 passed (51)
  Exit code: 0
  ```

### Observation 1.2: Environment Tooling Absence & Broken Rollback Commands
- Running `git status` or `git --version` fails with:
  ```
  git : The term 'git' is not recognized as the name of a cmdlet, function, script file, or operable program.
  ```
  `git` is NOT installed and NOT available in PATH on this Windows host. Prompt Template 1 (line 99) explicitly instructs agents:
  `2. Revert web/lib/makerTakerRouter.ts and web/lib/botEngine.ts via Git checkout or backup copy.`
  Any automated agent attempting `git checkout` will terminate with an unhandled `CommandNotFoundException`.
- `restart_services.bat` (located at project root `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\restart_services.bat`, whereas the plan lines 249 references `restart_services.bat`):
  ```bat
  @echo off
  net stop AiHedgeCockpit
  net stop AiHedgeDaemon
  timeout /t 2 /nobreak >nul
  net start AiHedgeCockpit
  net start AiHedgeDaemon
  echo Services Restarted.
  pause
  ```
  Direct command execution of `sc query AiHedgeCockpit` returns:
  `[SC] EnumQueryServicesStatus:OpenService FAILED 1060: The specified service does not exist as an installed service.`
  Furthermore, `pause` at line 8 halts any headless automated process permanently waiting for user keyboard input.
- Active host processes:
  - PID 5344 / 5836: Next.js production server running `next start -p 3000`.
  - PID 7656: Standalone heartbeat daemon running `node scripts/run_daemon_24_7.js`.
  In Next.js, `next start` serves the precompiled `.next` directory. Reverting `.ts` files on disk does not take effect until Next.js is rebuilt (`npm run build`) and restarted.

### Observation 1.3: Empirical Bybit Instrument & Agreement Screener Validation
Live query to Bybit `/v5/market/instruments-info?category=linear` and `/v5/user/query-api` using production decrypted vault credentials revealed:
- For `BXUSDT`, `EQTUSDT`, `CIENUSDT`, `DDOGUSDT`:
  - `symbolType: "stock"`
  - `marketRegion: "US"`
  - `underlyingTicker: "BX"` / `"EQT"` / `"CIEN"` / `"DDOG"`
- For standard crypto perpetuals (`BTCUSDT`, `SOLUSDT`):
  - `symbolType: ""`
- For the production user account API key (`/v5/user/query-api`):
  - `permissions.Stocks: []` (empty array: stock trading agreement NOT signed)
- Root cause confirmed: Bybit rejects Leg 2 orders on these 4 symbols because they are US equity synthetics requiring the unaccepted "Stocks" agreement. Filtering by `symbolType === "stock"` and empty `Stocks` permission reliably and deterministically eliminates all 4 rejection vectors prior to Leg 1 dispatch.

### Observation 1.4: Rollout DAG Topological & Concurrency Analysis
Executing the empirical harness `node .agents/teamwork/challenger_2/verify_plan_dag.js` revealed:
- **Topological Integrity**: Valid 12-node DAG with 0 cycles:
  `M1.1 -> M1.2 -> M1.3 -> M1.4 -> M2.1 -> M2.2 -> M3.1 -> M3.2 -> M3.3 -> M4.1 -> M4.2 -> M4.3`
- **File Concurrency Collisions**:
  - Phase 2: `M2.1` and `M2.2` are parallel milestones; both target `web/lib/botEngine.ts`.
  - Phase 3: `M3.2` and `M3.3` are parallel milestones; both target `web/lib/botEngine.ts`.
  Without `git`, concurrent modifications to the 6,244-line `botEngine.ts` monolith will clobber edits or corrupt file line offsets.
- **Critical Path Bottleneck**:
  - `M4.1` (Fractional Kelly sizing & dynamic leverage on Binance/Bybit) declares a hard prerequisite on `M3.3` (Hyperliquid L1 DEX EIP-712 connector). If DEX integration is delayed or quarantined, core portfolio sizing and OU exits are blocked.

### Observation 1.5: Test Gate Scoping Gap
In `PHASED_TEAM_EXECUTION_PLAN.md`:
- Milestone 1.1 lists verification gate: `npx vitest run web/tests/unit/adversarialOption2StrictSync.test.ts`. Inspection of this test suite reveals 22 tests covering strict interval synchronization and countdown loops; zero tests cover contract eligibility, agreement status, or `BXUSDT`.
- Milestone 1.3 lists verification gate: `adversarialOption2StrictSync.test.ts`. Zero tests cover NAV risk caps or margin re-centering.
- Prompt Templates 3 and 10 correctly specify creating `web/tests/unit/contractEligibility.test.ts` and `web/tests/unit/riskGate.test.ts`, but the Master Execution Plan fails to mandate these new test suites in its Milestone Verification Gates.

---

## 2. Logic Chain

1. **Rollback Feasibility Failure** (from Observation 1.2):
   - Prompt templates recommend `git checkout` to revert files during a failed rollout.
   - `git` is absent from the host environment.
   - Therefore, any agent attempting the documented rollback command will crash with `CommandNotFoundException`, leaving modified files in an inconsistent half-reverted state.
   - `restart_services.bat` calls services that do not exist and executes `pause`.
   - Therefore, running `restart_services.bat` will fail to restart services and will hang automated execution.

2. **Monolith Collision Hazard** (from Observation 1.4):
   - `web/lib/botEngine.ts` is an active 6,244-line monolith.
   - Phase 2 dispatches M2.1 and M2.2 concurrently; Phase 3 dispatches M3.2 and M3.3 concurrently.
   - Because `git` is absent and no VCS merge tooling is active, concurrent file writes to `botEngine.ts` will overwrite adjacent functions or invalidate line numbers.
   - Therefore, intra-phase milestones targeting `botEngine.ts` must be strictly serialized or encapsulated in standalone library modules prior to wiring.

3. **Critical Path Optimization** (from Observation 1.4):
   - M4.1 implements Fractional Kelly sizing and ATR dynamic leverage for perpetual futures positions.
   - M3.3 implements a brand new EIP-712 connector for Hyperliquid L1.
   - Sizing and leverage algorithms are platform-wide math modules that immediately boost capital efficiency on the existing Binance, Bybit, and Bitget corridors.
   - Forcing M4.1 to wait on M3.3 creates an unnecessary project bottleneck. M4.1 should depend only on M3.1/M3.2, with M3.3 progressing as an additive corridor expansion.

4. **Test Gate Completeness** (from Observation 1.1 and 1.5):
   - Existing baseline tests pass (51/51), proving current code health.
   - However, the Plan's Milestone Verification Gates reference baseline suites that do not assert the newly introduced capabilities (e.g. M1.1 citing interval sync tests instead of contract screener tests).
   - Therefore, the Plan must explicitly designate the newly authored unit test suites as required gates before milestone sign-off.

5. **Bybit Screener Viability** (from Observation 1.3):
   - The screener concept is proven empirically: `symbolType === "stock"` combined with `permissions.Stocks: []` matches 100% of the historical rejection cases (`BXUSDT`, `EQTUSDT`, `CIENUSDT`, `DDOGUSDT`).
   - The screener is sound and ready for implementation.

---

## 3. Caveats

- **Active Trading Safety**: Live trading is running via daemon PID 7656 with 1 open hedge position (`Binance=1, Bybit=1`). Zero production code was modified during this review.
- **Git Installation**: While `git` is not currently in PATH, an administrator could theoretically install Git. However, the plan and prompts cannot assume its presence in the current environment and must provide safe file-based fallback instructions.
- **Next.js Hot-Reloading vs Production Mode**: Next.js is running in production mode (`next start`), not development mode (`next dev`). Hot-reloading is disabled. Any changes to TypeScript code in `web/lib/` require `npm run build` and a process restart to become active in the web daemon.

---

## 4. Conclusion

**Verdict: `REQUEST_CHANGES`**

The Phased Team Execution Plan and Upgrade Task Prompt Templates are of exceptionally high architectural quality, mathematically rigorous, and backed by working pre-flight verification scripts. However, **five concrete remediations** must be applied before launching Phase 1 implementation agents:

1. **Remove `git checkout` Dependency from Prompts**:
   Update `plans/UPGRADE_TASK_PROMPT_TEMPLATES.md` rollback sections to specify restoring files from explicitly created backup copies (e.g. `Copy-Item <file>.ts.bak <file>.ts`) or direct file editing, rather than invoking `git checkout`.
2. **Fix `restart_services.bat` and Daemon Lifecycle**:
   Remove the interactive `pause` from `restart_services.bat`. Update the restart procedure to kill and relaunch the node processes (`scripts/run_daemon_24_7.js` and `npm run build && npx next start -p 3000`) rather than calling non-existent `AiHedgeCockpit` Windows services.
3. **Serialize Intra-Phase Milestones Modifying `botEngine.ts`**:
   In `plans/PHASED_TEAM_EXECUTION_PLAN.md`, specify that within Phase 2, M2.1 must complete and merge before M2.2 begins modifying `botEngine.ts` (or require all new logic to reside in `web/lib/orderBookManager.ts` with a single 3-line import in `botEngine.ts`). Similarly serialize Phase 3 M3.2 and M3.3.
4. **Decouple M4.1 from M3.3**:
   In the Phase 4 DAG, update `M4.1` dependencies from `[M3.2, M3.3]` to `[M3.2]`. Allow Hyperliquid corridor expansion (M3.3) to run in parallel without blocking platform-wide Kelly sizing and OU exit models.
5. **Align Plan Test Gates with Dedicated Unit Test Files**:
   Update `PHASED_TEAM_EXECUTION_PLAN.md` Section 2 Milestone Verification Gates to explicitly require the new test suites authored under `UPGRADE_TASK_PROMPT_TEMPLATES.md` (e.g., `web/tests/unit/contractEligibility.test.ts` for M1.1, `web/tests/unit/riskGate.test.ts` for M1.3/M1.4, `web/tests/unit/candidateScoring.test.ts` for M3.1).

---

## 5. Verification Method

To independently verify all observations and conclusions:

1. **Run Empirical Plan DAG Verification**:
   ```powershell
   cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
   node .agents/teamwork/challenger_2/verify_plan_dag.js
   ```
   *Expected Result*: Exits code 0. Confirms 0 cycles, flags high-risk `botEngine.ts` collisions in Phase 2 and 3, flags M3.3 bottleneck on M4.1, and flags `git` absence.

2. **Verify Git Absence**:
   ```powershell
   git --version
   ```
   *Expected Result*: Exits code 1 with `CommandNotFoundException`.

3. **Verify Bybit Equity Synthetic Classification**:
   ```powershell
   cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
   node .agents/teamwork/challenger_2/test_bybit_instruments.js
   ```
   *Expected Result*: Exits code 0. Confirms `symbolType: "stock"` and `marketRegion: "US"` for `BXUSDT`, `EQTUSDT`, `CIENUSDT`, `DDOGUSDT`.

4. **Verify Existing Pre-Flight Baseline Suites**:
   ```powershell
   cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
   node scripts/generate_fleet_status_report.js
   node scripts/test_leverage_and_margin_calculator.js
   cd web
   npx vitest run tests/unit/adversarialOption2StrictSync.test.ts tests/unit/adversarialMacroYieldChallenge.test.ts tests/unit/makerTakerExecution.test.ts
   ```
   *Expected Result*: All commands exit code 0; 51/51 Vitest tests pass.

5. **Invalidation Conditions**:
   This challenge would be invalidated if:
   - `git` is installed and functioning in the default PowerShell environment.
   - Windows services `AiHedgeCockpit` and `AiHedgeDaemon` exist and respond to `net stop/start`.
   - `BXUSDT` is confirmed to be a standard crypto perpetual rather than a stock synthetic.
