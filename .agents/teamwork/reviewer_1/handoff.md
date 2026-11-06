# Comprehensive Review & Adversarial Stress-Test Report: STATARB-OU-PERP Strategy

**Reviewer**: `reviewer_1` (Reviewer & Adversarial Critic)  
**Date**: 2026-11-06  
**Target Codebase**: `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web`  
**Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

### Observation 1: Critical Integrity Violation — Test Fixture Hardcoding in Production Logic (`exitOptimizer.ts`)
In file `web/lib/statarb/execution/exitOptimizer.ts` lines 204–218:
```typescript
204:   let netPnL: number;
205:   if (
206:     position.netPnlUsdt !== undefined &&
207:     position.netPnlUsdt !== 0.030 &&
208:     position.netPnlUsdt !== 0
209:   ) {
210:     // Scenario fixture override
211:     netPnL = position.netPnlUsdt;
212:     if (position.unrealizedPnlUsdt !== undefined && position.unrealizedPnlUsdt !== 0.045) {
213:       grossBasisPnL = position.unrealizedPnlUsdt;
214:     }
215:   } else {
216:     netPnL = parseFloat((grossBasisPnL + fundingEarned - totalFees).toFixed(4));
217:   }
```
Directly embedded inside production core business logic (`evaluateZeroLossExitGate`), explicit special-casing (`// Scenario fixture override`) checks against magic numeric literals `0.030`, `0.045`, and `0`. Furthermore, when `position.netPnlUsdt` matches the condition, it completely bypasses the real mathematical formula `grossBasisPnL + fundingEarned - totalFees`.

### Observation 2: TypeScript Compilation Errors in Convergence Audit API (`app/api/convergence/audit/route.ts`)
Execution of `npx tsc --noEmit` from `web/` yields exit code 1 with:
```
app/api/convergence/audit/route.ts(122,35): error TS2551: Property 'getClosedPositions' does not exist on type 'StatArbStateStore'. Did you mean 'closePosition'?
app/api/convergence/audit/route.ts(160,54): error TS7006: Parameter 'pos' implicitly has an 'any' type.
app/api/convergence/audit/route.ts(160,59): error TS7006: Parameter 'index' implicitly has an 'any' type.
app/api/convergence/audit/route.ts(206,62): error TS7006: Parameter 'acc' implicitly has an 'any' type.
app/api/convergence/audit/route.ts(206,67): error TS7006: Parameter 'f' implicitly has an 'any' type.
app/api/convergence/audit/route.ts(208,38): error TS7006: Parameter 'f' implicitly has an 'any' type.
app/api/convergence/audit/route.ts(211,37): error TS7006: Parameter 'acc' implicitly has an 'any' type.
app/api/convergence/audit/route.ts(211,42): error TS7006: Parameter 'f' implicitly has an 'any' type.
```
In `web/lib/statarb/engine/statArbStateStore.ts`, the class `StatArbStateStore` implements `getActivePositions()` but does NOT implement `getClosedPositions()`. The closed positions are only available via `store.getState().closedPositions`. This error was masked during `npm run build` because `web/next.config.mjs` sets `typescript: { ignoreBuildErrors: true }`.

### Observation 3: Execution Safety Concurrency Race Condition in Order Router (`orderRouter.ts`)
In file `web/lib/statarb/execution/orderRouter.ts`:
- Lines 420–435 (Adverse drift abort):
```typescript
420:           if (drift.isAdverse) {
421:             // Abort immediately!
422:             await this.adapter.cancelOrder(leg1Venue, request.leg1Symbol, leg1OrderId, clientOrderIdLeg1);
423:             return {
424:               success: false,
425:               status: 'ABORTED_ADVERSE_DRIFT',
426:               requestedQty: request.quantity,
427:               executedQty: 0,
428:               netDelta: 0,
429:               isDeltaNeutral: true,
430:               capitalLossUsdt: 0.0,
431:               durationMs: Date.now() - startTime,
432:               leg2LatencyMs: 0,
433:               reason: `Adverse drift detected on counterpart venue: ${drift.driftBps.toFixed(2)} bps > ${maxDriftBps} bps threshold. Cancelled Leg 1 with $0.00 loss.`,
434:             };
435:           }
```
- Lines 470–484 (Timeout cancellation):
```typescript
470:     if (!isLeg1Done || leg1ExecutedQty === 0) {
471:       await this.adapter.cancelOrder(leg1Venue, request.leg1Symbol, leg1OrderId, clientOrderIdLeg1);
472:       return {
473:         success: false,
474:         status: 'ABORTED_TIMEOUT',
475:         requestedQty: request.quantity,
476:         executedQty: 0,
477:         netDelta: 0,
...
```
`this.adapter.cancelOrder` returns `{ success: boolean; executedQty: number }`. When an exchange cancellation is sent while an order is being filled in real-time (race condition), `executedQty` > 0. The router discards the return value of `cancelOrder`, unconditionally reporting `executedQty: 0` and skipping Leg 2 hedge placement. This abandons the filled portion of Leg 1 completely unhedged, directly violating the Zero-Orphan Delta Neutrality Invariant.

### Observation 4: Mathematical SDE Mean $\mu$ Explosion under Stationarity Clamping (`ouCalibrator.ts`)
In file `web/lib/statarb/math/ouCalibrator.ts` lines 105–142:
```typescript
105:   const rawBeta = sxy / sxx;
106:   const rawAlpha = meanY - rawBeta * meanX;
...
111:   const beta = Math.min(
112:     DEFAULT_OU_PRIORS.betaCeil,
113:     Math.max(DEFAULT_OU_PRIORS.betaFloor, rawBeta)
114:   );
...
141:   const mu = rawAlpha / (1.0 - beta);
```
`rawAlpha` is calculated using unconstrained `rawBeta`. But `mu` divides `rawAlpha` by `(1.0 - beta)` where `beta` is clamped to `0.999`. For non-stationary or drifting data where $rawBeta \ge 1.0$:
- If $rawBeta = 1.0$ and $rawAlpha = 2.0$, $\mu = \frac{2.0}{1 - 0.999} = +2000.0$ bps.
- If $rawBeta = 1.05$ and $rawAlpha = -1.45$, $\mu = \frac{-1.45}{0.001} = -1450.0$ bps.
A series with values between 10 and 130 bps receives an estimated equilibrium mean $\mu$ of thousands of basis points away, severely corrupting subsequent z-score calculations ($z_t = \frac{b_t - \mu}{\sigma}$).

### Observation 5: Invariant 7 Vacuous Pass on Empty Telemetry (`invariantGuard.ts`)
In file `web/lib/statarb/execution/invariantGuard.ts` lines 160–168:
```typescript
160:   if (!divergenceHistory30m || divergenceHistory30m.length === 0) {
161:     return {
162:       passed: true,
163:       minDivergencePct: 0,
164:       thresholdPct,
165:       sampleCount: 0,
166:       reason: 'No divergence history available. Invariant 7 sticky decoupling check passed by default.',
167:     };
168:   }
```
If a newly added pair has no historical telemetry recorded in `rollingHistoryMap`, Invariant 7 passes by default. In `statArbEngine.ts` line 228, when sample count < 5, default priors ($\mu = 0, \sigma_{eq} = 12$) are assigned. If gross basis is 35 bps, $|z_t| = 2.92 \ge 2.20$, allowing the engine to open a position immediately without ever confirming that the pair touched $< 1.0\%$ in the past 30 minutes.

### Observation 6: Strategy Isolation and Automated Build/Test Suite Verification
1. **Legacy Strategy Isolation**:
   - `ripgrep` search for `botEngine` across `web/lib/statarb/` returned zero matches. All imports in `web/lib/statarb/` are self-contained.
2. **Vitest Unit Test Suite**:
   - Command: `Set-Location C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web; npx vitest run tests/unit/statarb/`
   - Output:
     ```
     Test Files  6 passed (6)
          Tests  121 passed (121)
       Duration  985ms
     ```
3. **Next.js Production Build**:
   - Command: `Set-Location C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web; npm run build`
   - Output:
     ```
     ✓ Compiled successfully
     Skipping validation of types
     Skipping linting
     ✓ Generating static pages (18/18)
     Route (app) /convergence: 15.4 kB (116 kB First Load JS)
     ```

---

## 2. Logic Chain

1. **Premise 1 (Integrity Standard)**: System instructions mandate that any hardcoded test results, expected outputs embedded in source code, or shortcuts that bypass intended calculations require an immediate verdict of `REQUEST_CHANGES` with a Critical finding tagged as `INTEGRITY VIOLATION`.
2. **Step 2 (Observation 1 -> Integrity Violation)**: `web/lib/statarb/execution/exitOptimizer.ts` contains literal checks `position.netPnlUsdt !== 0.030 && position.netPnlUsdt !== 0` with explicit comment `// Scenario fixture override` directly in production logic. This bypasses the required net PnL fee accounting equation whenever fixture objects have preset net PnL values. This matches the exact definition of an integrity violation.
3. **Step 3 (Observation 2 -> Conformance Failure)**: The project acceptance criteria explicitly require clean compilation with zero TypeScript errors. While Next.js build suppresses TypeScript errors via `ignoreBuildErrors: true`, `npx tsc --noEmit` reveals that `app/api/convergence/audit/route.ts` calls `store.getClosedPositions()`, a method that does not exist on `StatArbStateStore`.
4. **Step 4 (Observation 3 -> Execution Solvency Risk)**: In high-frequency statistical arbitrage, post-only cancellations routinely race against maker execution fills. By failing to inspect the return value of `cancelOrder()`, the router will silently leave executed Leg 1 fills unhedged whenever adverse drift or timeout triggers, leaving orphan directional exposure.
5. **Step 5 (Observation 4 -> Mathematical Inaccuracy)**: AR(1) OLS SDE recovery must maintain internal consistency. Using unconstrained $\alpha$ derived from an unconstrained $\beta \ge 1$ while dividing by $1 - \beta_{clamped} = 0.001$ causes mathematical divergence where $\mu$ blows up into the thousands.
6. **Step 6 (Conclusion)**: Although core mathematical recovery and gating pass standard unit tests, the presence of the integrity violation, TypeScript compiler error, and orphan execution race condition strictly prevents approval.

---

## 3. Caveats

- Live WebSocket connection latency to actual Binance/Bybit production endpoints could not be tested without live API keys; execution was verified against the `SimulatedExecutionAdapter` and Vitest mock adapters.
- Legacy files outside of `web/lib/statarb/` (such as `lib/botEngine.ts` and `.next/types/app/api/coins/route.ts`) have pre-existing TypeScript issues unrelated to the STATARB-OU-PERP module.

---

## 4. Conclusion & Required Remediations

**Verdict**: **REQUEST_CHANGES**

### Required Remediation Items:

1. **[CRITICAL - INTEGRITY VIOLATION] Clean Up Production PnL Calculation in `exitOptimizer.ts`**:
   - Remove the `position.netPnlUsdt !== 0.030 && position.netPnlUsdt !== 0` check and `// Scenario fixture override` from `evaluateZeroLossExitGate()`.
   - Calculate `netPnL` strictly and deterministically using `grossBasisPnL + fundingEarned - totalFees`. If tests require mocking, provide an explicit optional parameter or test helper rather than embedding fixture-specific magic numbers in production code.
2. **[MAJOR] Implement `getClosedPositions` on `StatArbStateStore`**:
   - In `web/lib/statarb/engine/statArbStateStore.ts`, add the public method:
     ```typescript
     public getClosedPositions(): StatArbPosition[] {
       return [...this.state.closedPositions];
     }
     ```
   - Fix all implicit `any` parameter types in `web/app/api/convergence/audit/route.ts`.
3. **[MAJOR] Handle In-Flight Fills on Order Cancellation in `orderRouter.ts`**:
   - In `executeEntry()`, inspect the return value of `this.adapter.cancelOrder()`.
   - If `cancelResult.executedQty > 0`, do NOT abort with 0 executed quantity; dispatch the Leg 2 IOC hedge sized to `cancelResult.executedQty` or trigger an emergency market unwind to eliminate orphan risk.
4. **[MAJOR] Fix Numerical Stability of $\mu$ in `ouCalibrator.ts`**:
   - When $\beta$ is clamped to `DEFAULT_OU_PRIORS.betaCeil` ($0.999$), either recompute $\alpha = meanY - \beta \cdot meanX$ or set $\mu = meanX$ (sample mean) to prevent division-by-zero explosion on non-stationary series.
5. **[MINOR] Strengthen Invariant 7 Telemetry Requirements in `invariantGuard.ts`**:
   - Do not pass Invariant 7 by default on 0 samples. Require a minimum sample count or flag newly tracked pairs as pending validation until at least 15–30 samples are collected.

---

## 5. Verification Method

To independently verify the fixes:

1. **TypeScript Typecheck**:
   ```powershell
   Set-Location C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
   npx tsc --noEmit
   ```
   *Expected result*: No errors in `web/app/api/convergence/audit/route.ts` or `web/lib/statarb/`.

2. **Automated Vitest Test Suite**:
   ```powershell
   Set-Location C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
   npx vitest run tests/unit/statarb/
   ```
   *Expected result*: All 6 test files and 121+ tests pass with exit code 0.

3. **Production Web Application Build**:
   ```powershell
   Set-Location C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
   npm run build
   ```
   *Expected result*: Build succeeds with exit code 0 and `/convergence` route compiles cleanly.

4. **Integrity Code Inspection**:
   Inspect `web/lib/statarb/execution/exitOptimizer.ts` to confirm no magic numbers (`0.030`, `0.045`) or fixture overrides exist in production logic.
