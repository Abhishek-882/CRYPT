# Original User Request

## Initial Request — 2026-11-10T10:17:11Z

Execute and implement the 8-phase Master Roadmap in the SafeCoiner Quant Cockpit codebase (`web/`) to resolve multi-tenant isolation vulnerabilities and deploy the Auto-Adaptive Layer 7 Zero-Loss Dynamic Exit Engine for production hardening.

Working directory: C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
Integrity mode: development

Reference: C:\Users\Administrator\.gemini\antigravity\brain\1d2bf9be-31cc-4a00-bea0-9564b0cbc34b\MULTI_TENANT_ARCHITECTURE_HIDDEN_VULNERABILITY_AUDIT.md

## Requirements

### R1. Daemon Lock Scoping & Reference Counting (Phase 1)
Refactor daemon lock management in `web/app/api/bot/daemon/route.ts` and `web/lib/daemonLockManager.ts` so that daemon locks are reference-counted across active tenants, preventing premature global OS lock release when a single tenant pauses.

### R2. Strict Credential Isolation & Admin Secret Fallback Stripping (Phase 2)
Remove `ADMIN_*` and `SYSTEM_DEFAULT_*` credential fallbacks for non-admin accounts in `web/lib/botEngine.ts`. Ensure non-admin bots require their own exchange API keys and throw explicit errors if credentials are missing.

### R3. Tenant-Scoped In-Flight Entry Locks & Fleet Mutexes (Phase 3)
Scope in-flight entry locks and fleet mutexes by tenant and symbol (`${userId}_${symbol}`) in `web/lib/botEngine.ts` and `web/lib/fleetDispatcher.ts` to allow concurrent execution across different tenants on the same trading pair.

### R4. Auto-Adaptive Layer 7 Zero-Loss Dynamic Exit Engine (Phase 4)
In `web/lib/divergence/engine.ts`, `web/lib/exitOptimizer.ts`, `web/lib/divergence/types.ts`, and `web/lib/divergence/store/stateStore.ts`, replace the static $0.01 USDT exit profit floor with dynamic calculation scaling with `orderNotionalUsdt` and user configuration, maintaining a hard safety floor of $0.0100 USDT while supporting user override via UI and API.

### R5. Paper Trading Isolation, Coin Quarantine Scoping, Daemon Auth, and Simulation Mode (Phases 5-8)
- Phase 5: Isolate paper trading ledgers and wallets in `web/lib/paperTradingEngine.ts`, eliminating non-admin fallbacks to root admin data files (`data/paper_positions.json` and `data/paper_wallet.json`).
- Phase 6: Scope coin quarantine caller in `web/app/api/close/route.ts` by passing `userId` to `lockFlattenedCoinForBot()`.
- Phase 7: Add session token authentication via `getAuthenticatedUser()` to GET and POST routes in `web/app/api/divergence/daemon/route.ts`.
- Phase 8: Introduce `bot.mode = "paper"` routing in `web/lib/botEngine.ts` for autonomous 24/7 delta-neutral simulation.

### R6. Architectural Constraints & Verification
- Strict ZERO BPS NOTATION across all code comments, user-facing reports, and artifacts: use `%` notation exclusively.
- Modern terminology only: ban legacy bot references.
- Preserve all existing docstrings and comments.
- Live external API calls are permitted if configured.
- The team decides how to construct and execute automated verification tests covering all 8 phases.

## Acceptance Criteria

### Functional & Multi-Tenant Verification
- [ ] Daemon lock remains active when one active tenant stops while other active tenants continue running.
- [ ] Non-admin accounts with missing exchange credentials fail cleanly without falling back to administrator exchange keys or balances.
- [ ] Concurrent symbol entries by different tenants on the same symbol do not reject due to shared process-level entry locks.
- [ ] Auto-adaptive exit hurdle dynamically scales with order notional sizing while honoring user override and enforcing the hard safety floor of $0.0100 USDT.
- [ ] Paper trading positions and wallet files for non-admin tenants operate independently without reading from or overwriting root administrator paper data files.
- [ ] Manual coin close quarantines the coin exclusively for the authenticated user's bot.
- [ ] Unauthenticated requests to `/api/divergence/daemon` are rejected.
- [ ] Paper simulation mode (`bot.mode = "paper"`) executes simulated delta-neutral cycles in the background without requiring live exchange keys.
- [ ] All modified code, docstrings, and artifacts strictly use `%` notation with zero instances of BPS notation.
- [ ] Existing docstrings and comments are preserved across modified files.
- [ ] Automated end-to-end and unit tests verifying the 8 phases are implemented and pass.


## Follow-up — 2026-11-10T10:18:49Z

CRITICAL SCOPE UPDATE FROM USER:
The user has explicitly instructed: "no need paper trading etc remove those in plan".

Please immediately remove and skip:
- Phase 5: Paper Trading Isolation (`web/lib/paperTradingEngine.ts`, `data/paper_positions.json`, `data/paper_wallet.json`)
- Phase 8: Autonomous Daemon Paper Simulation Mode (`bot.mode = "paper"` in `web/lib/botEngine.ts`)

The active scope is now strictly focused on live on-exchange trading, multi-tenant security/lock isolation, and the Auto-Adaptive Layer 7 Zero-Loss Dynamic Exit Engine:
1. Phase 1: Daemon Lock Scoping & Reference Counting (`web/app/api/bot/daemon/route.ts`, `web/lib/daemonLockManager.ts`)
2. Phase 2: Strict Credential Isolation & Admin Secret Fallback Stripping (`web/lib/botEngine.ts`)
3. Phase 3: Tenant-Scoped In-Flight Entry Locks & Fleet Mutexes (`web/lib/botEngine.ts`, `web/lib/fleetDispatcher.ts`)
4. Phase 4: Auto-Adaptive Layer 7 Zero-Loss Dynamic Exit Engine (`web/lib/divergence/engine.ts`, `web/lib/exitOptimizer.ts`, `web/lib/divergence/types.ts`, `web/lib/divergence/store/stateStore.ts`)
5. Phase 5 (formerly Phase 6): Coin Quarantine Caller Scoping (`web/app/api/close/route.ts`)
6. Phase 6 (formerly Phase 7): Divergence Daemon Route Authentication (`web/app/api/divergence/daemon/route.ts`)

Please adjust your execution plan accordingly and confirm.


## Follow-up — 2026-11-10T10:19:08Z
CRITICAL SCOPE UPDATE FROM USER:
The user has explicitly instructed: "no need paper trading etc remove those in plan".

Please immediately remove and skip:
- Phase 5: Paper Trading Isolation (`web/lib/paperTradingEngine.ts`, `data/paper_positions.json`, `data/paper_wallet.json`)
- Phase 8: Autonomous Daemon Paper Simulation Mode (`bot.mode = "paper"` in `web/lib/botEngine.ts`)

The active scope is now strictly focused on live on-exchange trading, multi-tenant security/lock isolation, and the Auto-Adaptive Layer 7 Zero-Loss Dynamic Exit Engine:
1. Phase 1: Daemon Lock Scoping & Reference Counting (`web/app/api/bot/daemon/route.ts`, `web/lib/daemonLockManager.ts`)
2. Phase 2: Strict Credential Isolation & Admin Secret Fallback Stripping (`web/lib/botEngine.ts`)
3. Phase 3: Tenant-Scoped In-Flight Entry Locks & Fleet Mutexes (`web/lib/botEngine.ts`, `web/lib/fleetDispatcher.ts`)
4. Phase 4: Auto-Adaptive Layer 7 Zero-Loss Dynamic Exit Engine (`web/lib/divergence/engine.ts`, `web/lib/exitOptimizer.ts`, `web/lib/divergence/types.ts`, `web/lib/divergence/store/stateStore.ts`)
5. Phase 5 (formerly Phase 6): Coin Quarantine Caller Scoping (`web/app/api/close/route.ts`)
6. Phase 6 (formerly Phase 7): Divergence Daemon Route Authentication (`web/app/api/divergence/daemon/route.ts`)

Please adjust your execution plan accordingly, record this update in your plan and briefing, and proceed with the 6 active phases.


## Follow-up — 2026-11-10T10:32:18Z

CRITICAL ARCHITECTURAL SPECIFICATION UPDATE FOR PHASE 4 (Auto-Adaptive Layer 7 Dynamic Exit Floor):

The user has clarified the sizing model, leverage structure, and linear scaling requirement:
1. Capital Structure:
   - Sizing is specified in terms of committed initial margin equity: e.g. $30 USD margin per side ($60 USD total user margin).
   - At 10x leverage, this commands $300 USD notional per side ($600 USD total hedge position notional).
2. Linear Proportional Capital Scaling Rule:
   - Sizing must scale the minimum profit floor linearly: If $x = $6.00 margin per side ($60.00 notional at 10x) expects $0.0100 USDT floor, then 5x capital ($30.00 margin per side = $300 notional at 10x) must expect 5 * 0.0100 = $0.0500 USDT minimum floor.
   - Sizing of 10x ($60.00 margin per side = $600 notional at 10x) must expect 10 * 0.0100 = $0.1000 USDT minimum floor.
3. Implementation Contract:
   Deploy the following helper in `web/lib/divergence/engine.ts` and integrate with `evaluateExitGates`:
   ```typescript
   export function getEffectiveZeroLossFloorUsdt(
     orderNotionalUsdt: number,
     configuredFloorUsdt?: number
   ): number {
     const HARD_SAFETY_FLOOR_USDT = 0.0100;
     const BASE_NOTIONAL_UNIT_USDT = 60.00; // $6 margin at 10x leverage

     if (configuredFloorUsdt !== undefined && configuredFloorUsdt >= HARD_SAFETY_FLOOR_USDT) {
       return configuredFloorUsdt;
     }

     const scaleFactor = Math.max(1.0, orderNotionalUsdt / BASE_NOTIONAL_UNIT_USDT);
     const autoAdaptedFloor = parseFloat((scaleFactor * HARD_SAFETY_FLOOR_USDT).toFixed(4));
     return Math.max(HARD_SAFETY_FLOOR_USDT, autoAdaptedFloor);
   }
   ```
4. Verification:
   Test L7-01 must verify:
   - $60 notional ($6 margin @ 10x) -> $0.0100 floor
   - $300 notional ($30 margin @ 10x) -> $0.0500 floor
   - $600 notional ($60 margin @ 10x) -> $0.1000 floor

Please incorporate this into Milestone 4 specifications immediately.


## Follow-up — 2026-11-10T10:32:43Z
CRITICAL ARCHITECTURAL SPECIFICATION UPDATE FOR PHASE 4 (Auto-Adaptive Layer 7 Dynamic Exit Floor):

The user has clarified the sizing model, leverage structure, and linear scaling requirement:
1. Capital Structure:
   - Sizing is specified in terms of committed initial margin equity: e.g. $30 USD margin per side ($60 USD total user margin).
   - At 10x leverage, this commands $300 USD notional per side ($600 USD total hedge position notional).
2. Linear Proportional Capital Scaling Rule:
   - Sizing must scale the minimum profit floor linearly: If $x = $6.00 margin per side ($60.00 notional at 10x) expects $0.0100 USDT floor, then 5x capital ($30.00 margin per side = $300 notional at 10x) must expect 5 * 0.0100 = $0.0500 USDT minimum floor.
   - Sizing of 10x ($60.00 margin per side = $600 notional at 10x) must expect 10 * 0.0100 = $0.1000 USDT minimum floor.
3. Implementation Contract:
   Deploy the following helper in `web/lib/divergence/engine.ts` and integrate with `evaluateExitGates`:
   ```typescript
   export function getEffectiveZeroLossFloorUsdt(
     orderNotionalUsdt: number,
     configuredFloorUsdt?: number
   ): number {
     const HARD_SAFETY_FLOOR_USDT = 0.0100;
     const BASE_NOTIONAL_UNIT_USDT = 60.00; // $6 margin at 10x leverage

     if (configuredFloorUsdt !== undefined && configuredFloorUsdt >= HARD_SAFETY_FLOOR_USDT) {
       return configuredFloorUsdt;
     }

     const scaleFactor = Math.max(1.0, orderNotionalUsdt / BASE_NOTIONAL_UNIT_USDT);
     const autoAdaptedFloor = parseFloat((scaleFactor * HARD_SAFETY_FLOOR_USDT).toFixed(4));
     return Math.max(HARD_SAFETY_FLOOR_USDT, autoAdaptedFloor);
   }
   ```
4. Verification:
   Test L7-01 must verify:
   - $60 notional ($6 margin @ 10x) -> $0.0100 floor
   - $300 notional ($30 margin @ 10x) -> $0.0500 floor
   - $600 notional ($60 margin @ 10x) -> $0.1000 floor


## Follow-up — 2026-11-10T10:41:59Z

LEVERAGE CONFIGURATION SPECIFICATION UPDATE FOR MILESTONE 2 (`web/lib/botEngine.ts`):

The user has instructed to make leverage 10x for basic/meme/volatile coins, 20x for normal coins, and make this user-configurable.
`web/lib/leverageManager.ts` has already been updated to:
- Default Tier 3 (meme coins/altcoins) to 10x basic floor (was 5x).
- Default Tier 1 and Tier 2 (normal coins) to 20x.
- Accept optional `{ normalCoinLeverage?: number; volatileCoinLeverage?: number }`.

Please instruct `teamwork_worker_m2` when updating `web/lib/botEngine.ts` to:
1. Add to `interface BotConfig`:
   ```typescript
   normalCoinLeverage?: number; // default: 20x for normal/large-cap coins
   volatileCoinLeverage?: number; // default: 10x for meme/volatile coins
   ```
2. Add defaults to `DEFAULT_CONFIG`:
   ```typescript
   normalCoinLeverage: 20,
   volatileCoinLeverage: 10,
   ```
3. In `executeDualHedgeEntry`:
   Pass `{ normalCoinLeverage: config.normalCoinLeverage ?? 20, volatileCoinLeverage: config.volatileCoinLeverage ?? 10 }` to `calculateDynamicLeverage`.


## Follow-up — 2026-11-10T10:42:23Z
LEVERAGE CONFIGURATION SPECIFICATION UPDATE FOR MILESTONE 2 (`web/lib/botEngine.ts`):

The user has instructed to make leverage 10x for basic/meme/volatile coins, 20x for normal coins, and make this user-configurable.
`web/lib/leverageManager.ts` has already been updated to:
- Default Tier 3 (meme coins/altcoins) to 10x basic floor (was 5x).
- Default Tier 1 and Tier 2 (normal coins) to 20x.
- Accept optional `{ normalCoinLeverage?: number; volatileCoinLeverage?: number }`.

Please instruct `teamwork_worker_m2` when updating `web/lib/botEngine.ts` to:
1. Add to `interface BotConfig`:
   ```typescript
   normalCoinLeverage?: number; // default: 20x for normal/large-cap coins
   volatileCoinLeverage?: number; // default: 10x for meme/volatile coins
   ```
2. Add defaults to `DEFAULT_CONFIG`:
   ```typescript
   normalCoinLeverage: 20,
   volatileCoinLeverage: 10,
   ```
3. In `executeDualHedgeEntry`:
   Pass `{ normalCoinLeverage: config.normalCoinLeverage ?? 20, volatileCoinLeverage: config.volatileCoinLeverage ?? 10 }` to `calculateDynamicLeverage`.

## Follow-up — 2026-11-10T11:35:04Z

update parent

## Follow-up — 2026-11-10T11:37:55Z

update again
