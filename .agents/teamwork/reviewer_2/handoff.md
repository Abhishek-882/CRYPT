# Review & Adversarial Handoff Report: STATARB-OU-PERP Next.js Cockpit & Safety Invariants

**Reviewer**: `reviewer_2` (Roles: `reviewer`, `critic`)  
**Working Directory**: `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\.agents\teamwork\reviewer_2`  
**Target Milestone**: STATARB-OU-PERP Cockpit Page (`/convergence`), UI Components, Route Handlers, Navbar, and Safety Invariants (6 & 7)  
**Parent Conversation ID**: `c57762ae-f90e-4917-9e74-d8c563f89ec2`  
**Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

### 1.1 Next.js Production Build Command & Verbatim Output
**Command**:
```powershell
Set-Location 'C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web'; npm run build
```
**Exit Code**: `0`  
**Verbatim Output**:
```text
> safecoiner-cockpit@1.0.0 build
> next build

  ▲ Next.js 14.2.35
  - Environments: .env.local

   Creating an optimized production build ...
 ✓ Compiled successfully
   Skipping validation of types
   Skipping linting
   Collecting page data ...
   Generating static pages (0/18) ...
   Generating static pages (4/18) 
   Generating static pages (8/18) 
   Generating static pages (13/18) 
 ✓ Generating static pages (18/18)
   Finalizing page optimization ...
   Collecting build traces ...

Route (app)                              Size     First Load JS
├ ƒ /api/convergence/audit               0 B                0 B
├ ƒ /api/convergence/daemon              0 B                0 B
├ ƒ /api/convergence/radar               0 B                0 B
├ ○ /convergence                         15.4 kB         116 kB
```
*Note*: Next.js build succeeded because `web/next.config.mjs` specifies `typescript: { ignoreBuildErrors: true }` and `eslint: { ignoreDuringBuilds: true }`.

---

### 1.2 Vitest Unit Test Suite Execution & Output
**Command**:
```powershell
Set-Location 'C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web'; npx vitest run tests/unit/statarb/
```
**Exit Code**: `0`  
**Verbatim Output**:
```text
 RUN  v5.0.5 C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web

 ✓ tests/unit/statarb/invariantGuard.test.ts (29 tests) 13ms
 ✓ tests/unit/statarb/exitOptimizer.test.ts (33 tests) 14ms
 ✓ tests/unit/statarb/zScoreEngine.test.ts (20 tests) 13ms
 ✓ tests/unit/statarb/statArbEngine.test.ts (12 tests) 73ms
 ✓ tests/unit/statarb/ouCalibrator.test.ts (14 tests) 14ms
 ✓ tests/unit/statarb/orderRouter.test.ts (13 tests) 711ms

 Test Files  6 passed (6)
      Tests  121 passed (121)
   Duration  1.17s
```

---

### 1.3 Strict TypeScript Compiler Audit & Critical Route Defect
**Command**:
```powershell
Set-Location 'C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web'; npx tsc --noEmit --project tsconfig.json
```
**Exit Code**: `1`  
**Verbatim Output (Convergence Scope)**:
```text
app/api/convergence/audit/route.ts(122,35): error TS2551: Property 'getClosedPositions' does not exist on type 'StatArbStateStore'. Did you mean 'closePosition'?
app/api/convergence/audit/route.ts(160,54): error TS7006: Parameter 'pos' implicitly has an 'any' type.
app/api/convergence/audit/route.ts(160,59): error TS7006: Parameter 'index' implicitly has an 'any' type.
app/api/convergence/audit/route.ts(206,62): error TS7006: Parameter 'acc' implicitly has an 'any' type.
app/api/convergence/audit/route.ts(206,67): error TS7006: Parameter 'f' implicitly has an 'any' type.
app/api/convergence/audit/route.ts(208,38): error TS7006: Parameter 'f' implicitly has an 'any' type.
app/api/convergence/audit/route.ts(211,37): error TS7006: Parameter 'acc' implicitly has an 'any' type.
app/api/convergence/audit/route.ts(211,42): error TS7006: Parameter 'f' implicitly has an 'any' type.
```

**Direct Code Inspection in `web/app/api/convergence/audit/route.ts`**:
- Lines 121–123:
  ```typescript
  121:     const activePositions = store.getActivePositions();
  122:     const closedPositions = store.getClosedPositions();
  123:     const now = Date.now();
  ```
- Lines 227–233 (Catch Block):
  ```typescript
  227:   } catch (err: unknown) {
  228:     const message = err instanceof Error ? err.message : "Failed to retrieve audit log";
  229:     return NextResponse.json(
  230:       { success: false, error: message },
  231:       { status: 500 }
  232:     );
  233:   }
  ```
- Inspection of `web/lib/statarb/engine/statArbStateStore.ts` (lines 183–200):
  ```typescript
  public getState(): Readonly<StatArbEngineState> {
    return { ...this.state };
  }

  public getActivePositions(): StatArbPosition[] {
    return [...this.state.positions];
  }

  public getPositionById(id: string): StatArbPosition | undefined {
    return this.state.positions.find((p) => p.id === id);
  }
  ```
  `StatArbStateStore` **does not have a `getClosedPositions()` method**. Closed positions reside in `this.state.closedPositions` accessed via `store.getState().closedPositions`.

---

### 1.4 Synthetic Invariant 7 Filter Bypass in Radar Route
**Direct Code Inspection in `web/app/api/convergence/radar/route.ts` (lines 157–164)**:
```typescript
157:       // Generate synthetic 30m divergence history for sticky check
158:       const history30m = [
159:         Math.abs(grossBasisBps) / 100,
160:         Math.abs(grossBasisBps * 0.9) / 100,
161:         0.008, // touched below 1.0%
162:         Math.abs(grossBasisBps) / 100,
163:       ];
164:       const stickyCheck = checkInvariant7StickyDecoupling(history30m);
```
Line 161 hardcodes a constant `0.008` (representing 0.008% divergence). Invariant 7 evaluates `minDivergencePct < 1.0%`. Because `0.008 < 1.0%`, `stickyCheck.passed` evaluates to `true` on 100% of corridors evaluated by the radar scanner, regardless of actual structural divergence.

---

### 1.5 Frontend Implementation Verification
- `web/app/convergence/page.tsx`:
  - 347 lines, `"use client"` App Router page.
  - Implements 2.5s polling loop guarded by `document.hidden`.
  - Integrates `ConvergenceTelemetryHUD`, `ConvergenceZScoreChart`, `ConvergenceControls`, `ConvergenceRadarTable`, `ConvergenceExecutionAuditTable`.
  - Implements control dispatch handlers for `start`, `stop`, `kill`, `update_config`, and `close_position`.
- `web/components/convergence/ConvergenceTelemetryHUD.tsx`:
  - 209 lines. 4 KPI cards: Engine Status (with pulsing liveness indicator and uptime), Corridors & Best Gross Basis, Leg 2 WebSocket IOC Latency (sub-35ms indicator), and Net Realized PnL (net of all fees).
- `web/components/convergence/ConvergenceZScoreChart.tsx`:
  - 665 lines. Zero-dependency custom SVG charting (`viewBox="0 0 800 240"`).
  - Explicit threshold lines: $+2.20\sigma$ (Short BN / Long Bybit), $-2.20\sigma$ (Long BN / Short Bybit), $\pm 0.35\sigma$ shaded exit corridor, and $0.00\sigma$ parity line.
  - Interactive hover crosshair and companion theoretical Gaussian normal distribution bell curve with dynamic needle marker.
- `web/components/convergence/ConvergenceControls.tsx`:
  - 457 lines. Start, Pause, Emergency Kill-Switch with confirmation modal to prevent accidental halts, parameter configuration modal with numeric inputs and sliders, and reset-to-defaults functionality.
- `web/components/convergence/ConvergenceRadarTable.tsx`:
  - 414 lines. 15 monitored perpetual corridors. Sortable by Z-score, basis, half-life. Search filter and qualifying-only filter.
  - Displays all 5 required entry gate badges: `|z|>=2.2`, `B>=28`, `D>=4x`, `S<=8`, `INV7`.
- `web/components/convergence/ConvergenceExecutionAuditTable.tsx`:
  - 441 lines. Dual-tab table: Tab 1 Active Open Positions with basis compression % progress bar, Invariant 6 30-min countdown, and Zero-Loss Gate status; Tab 2 Completed Fills Historical Audit with Leg 1 Maker GTX fill, Leg 2 Bybit IOC fill, sub-35ms latency badge, and net PnL $\ge +\$0.01$ USDT zero-loss confirmation.
- `web/components/Navbar.tsx`:
  - Lines 58–64 & 151–172: `{ href: "/convergence", label: "Convergence", icon: Activity }` added to desktop navbar pill bar and mobile bottom dock (with WCAG 44px min-h touch target).

---

### 1.6 Safety Invariants Implementation Verification (`web/lib/statarb/execution/invariantGuard.ts`)
- **Invariant 6 (30-Minute Low-Watermark Persistence Breaker)** (lines 75–142):
  - Requires `holdMinutes >= 30` AND `minDivergencePct >= thresholdPct` (1.0% default).
  - If spread dipped $< 1.0\%$ at any point during the 30-minute window, the low-watermark timer resets (`triggered: false`).
  - If triggered, overrides the Zero-Loss Gate to liquidate structural basis decouplings.
- **Invariant 7 (Sticky Decoupling Filter)** (lines 156–206):
  - Pre-trade screener inspects 30-minute divergence trajectory.
  - Rejects pairs whose minimum divergence remained $\ge 1.0\%$ for all samples with error code `INVARIANT_7_STICKY_DECOUPLING_REJECTED`.
  - Passes pairs that touched $< 1.0\%$ within 30 minutes.
- Verified across 29 unit tests in `invariantGuard.test.ts`.

---

## 2. Logic Chain

1. **Root Cause Analysis of Route Runtime Defect (Observation 1.3)**:
   - Line 122 of `web/app/api/convergence/audit/route.ts` invokes `store.getClosedPositions()`.
   - `StatArbStateStore` implements `getActivePositions()` and `getState()`, but never implemented `getClosedPositions()`.
   - At runtime, evaluating `store.getClosedPositions()` throws `TypeError: store.getClosedPositions is not a function`.
   - The catch block in `audit/route.ts` intercepts this error and returns an HTTP 500 JSON response: `{ success: false, error: "store.getClosedPositions is not a function" }`.
   - In `web/app/convergence/page.tsx` line 106, `fetchAuditState` checks `if (res.ok)`. Because HTTP 500 is not OK, the response is discarded, leaving `activePositions` and `completedFills` permanently empty in the UI.
   - The production build (`npm run build`) succeeded only because `next.config.mjs` explicitly suppresses TypeScript compilation errors (`typescript: { ignoreBuildErrors: true }`).

2. **Adversarial Assessment of Invariant 7 Gate in Radar Table (Observation 1.4)**:
   - In `web/app/api/convergence/radar/route.ts`, lines 158–163 construct a synthetic 4-point divergence array containing `0.008`.
   - When `checkInvariant7StickyDecoupling(history30m)` runs, `Math.min(...history30m)` evaluates to `0.008%`.
   - Since `0.008% < 1.0%`, Invariant 7 evaluates to `passed: true` for every single corridor in the radar scan, regardless of whether its gross basis is 2.5 bps or 150.0 bps.
   - This bypasses the intended purpose of the 5-gate badge system in the radar table, blinding the operator to corridors experiencing sticky decoupling.

3. **Core Quality & Contract Adherence (Observation 1.5 & 1.6)**:
   - All requested UI components, charts, KPI cards, and controls are implemented with exceptional fidelity.
   - The underlying mathematical models in `ouCalibrator.ts`, `zScoreEngine.ts`, `exitOptimizer.ts`, and `invariantGuard.ts` are mathematically sound and pass 121 unit tests.
   - The Navbar integration is complete for both desktop and mobile viewports.
   - However, because the audit API route crashes at runtime with HTTP 500, the work product cannot be approved in its current state without remediation.

---

## 3. Caveats

1. **Mock Exchange Adapters in Offline Testing**: Offline unit tests in `tests/unit/statarb/` run against mock adapters. Live trading on Binance USD-M and Bybit Linear Perpetuals requires real API credentials and active WebSocket connections.
2. **Pre-existing Legacy Type Errors**: Legacy files (`lib/botEngine.ts` and `app/api/coins/route.ts`) have pre-existing type errors outside of the STATARB-OU-PERP scope. The review scope is restricted to `web/app/convergence`, `web/components/convergence`, `web/app/api/convergence`, `web/lib/statarb/execution/invariantGuard.ts`, and `web/components/Navbar.tsx`.

---

## 4. Conclusion

**Verdict: REQUEST_CHANGES**

The STATARB-OU-PERP frontend cockpit and safety invariants represent high-quality quantitative work with extensive test coverage (121 passing tests). However, changes are required to address two findings:

### Critical Finding (Must Fix)
- **Defect**: `web/app/api/convergence/audit/route.ts` line 122 calls non-existent method `store.getClosedPositions()`, throwing an uncaught `TypeError` at runtime and causing `GET /api/convergence/audit` to fail with HTTP 500.
- **Required Fix**:
  1. Add public getter `public getClosedPositions(): StatArbPosition[] { return [...this.state.closedPositions]; }` to `web/lib/statarb/engine/statArbStateStore.ts` (or update `audit/route.ts` line 122 to use `store.getState().closedPositions`).
  2. Resolve parameter implicit `any` types in `audit/route.ts` lines 160, 206, 208, 211.
  3. Ensure `npx tsc --noEmit` passes with 0 errors on `app/api/convergence/audit/route.ts`.

### Major Finding (Should Fix)
- **Defect**: `web/app/api/convergence/radar/route.ts` line 161 hardcodes `0.008` (0.008%) into `history30m`, artificially forcing Invariant 7 to always pass for every corridor in the radar scan.
- **Required Fix**: Derive `history30m` from the pair's actual gross basis spread history (or an unadulterated trajectory) without the hardcoded `0.008` touch, allowing Invariant 7 to legitimately fail on corridors with persistent depegs $\ge 1.0\%$.

---

## 5. Verification Method

To independently verify these findings:

1. **Verify Audit Route TypeScript Error**:
   ```powershell
   Set-Location 'C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web'
   npx tsc --noEmit --project tsconfig.json
   ```
   *Expected Result*: TS2551 on line 122 of `app/api/convergence/audit/route.ts` indicating `getClosedPositions` does not exist on `StatArbStateStore`.

2. **Verify Next.js Production Build**:
   ```powershell
   Set-Location 'C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web'
   npm run build
   ```
   *Expected Result*: Exits with code 0 (masking TS errors due to `ignoreBuildErrors: true`).

3. **Verify StatArb Vitest Suite**:
   ```powershell
   Set-Location 'C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web'
   npx vitest run tests/unit/statarb/
   ```
   *Expected Result*: 6 test files passed, 121 tests passed.

4. **Verify Invariant 7 Synthetic Bypass**:
   Inspect lines 157–164 in `web/app/api/convergence/radar/route.ts` to confirm hardcoded `0.008` constant.

5. **Invalidation Conditions**:
   - `StatArbStateStore.prototype.getClosedPositions` is implemented or `audit/route.ts` uses `store.getState().closedPositions`.
   - `npx tsc --noEmit` runs on `app/api/convergence/audit/route.ts` without errors.
   - `history30m` in `radar/route.ts` reflects genuine or realistic divergence without hardcoded `< 1.0%` touches.
