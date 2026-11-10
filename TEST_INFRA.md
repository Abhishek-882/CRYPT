# Multi-Tenant Hardening & Layer 7 Dynamic Exit Engine: Test Infrastructure & Verification Framework

## 1. Test Philosophy & Architecture

The testing framework for the **Multi-Tenant Autonomous Execution Engine & Layer 7 Zero-Loss Dynamic Exit Engine** adheres to an **opaque-box, requirement-driven, 4-tier verification methodology**.

Tests validate strictly against interface contracts, mathematical specifications, and security isolation invariants defined in `PROJECT.md`, `ORIGINAL_REQUEST.md`, `spec_mining_report.md`, and the architectural audit. No test relies on private implementation details, dummy facade mocks that trivially pass, or hardcoded expected outputs without explicit derivation.

```
+---------------------------------------------------------------------------------------------------------+
|                                    4-TIER TEST VERIFICATION PYRAMID                                     |
+---------------------------------------------------------------------------------------------------------+
| Tier 4: Real-World Scenarios       | Test L7-01 ($60/$300/$600), concurrent trading, lifecycle isolation|
| Tier 3: Cross-Feature Combinations | Concurrency + L7 hurdle, credentials + pause, quarantine + trading  |
| Tier 2: Boundary & Corner Cases   | 0-tenant/multi-tenant edges, 30s TTL expiry, micro-notionals ($0.0001) |
| Tier 1: Core Feature Coverage      | Ref-counted lock, credential isolation, fleet mutexes, L7 scaling    |
+---------------------------------------------------------------------------------------------------------+
```

### The 4 Tiers Defined

1. **Tier 1: Feature Coverage (Primary Behavior / Happy Paths)**
   - >=5 test cases per feature covering all 6 active phases of the multi-tenant roadmap.
   - Phase 1: Reference-counted daemon lock management and daemon route lifecycle (`POST /api/bot/daemon`).
   - Phase 2: Non-admin credential isolation, removal of `ADMIN_*` and `SYSTEM_DEFAULT_*` secret fallbacks, explicit `MISSING_EXCHANGE_CREDENTIALS` error throwing, and user-configurable leverage (`normalCoinLeverage: 20`, `volatileCoinLeverage: 10`).
   - Phase 3: Tenant-scoped in-flight entry locks (`inFlightEntryLocks` keyed by `${userId}_${symbol}`) and tenant-scoped fleet priority mutexes (`FleetDispatcher.acquireFleetLock`).
   - Phase 4: Auto-adaptive Layer 7 dynamic zero-loss exit hurdle formula, mandatory user-specified **Test L7-01** ($60 notional -> $0.0100 floor, $300 notional -> $0.0500 floor, $600 notional -> $0.1000 floor), dynamic hurdle gate evaluations in `evaluateExitGates`, and state store notional ceiling relaxation.
   - Phase 5: Caller-scoped coin quarantine dispatch (`lockFlattenedCoinForBot(symbolClosed, undefined, userId)`).
   - Phase 6: Divergence daemon cryptographic session authentication (`getAuthenticatedUser(req)`) and route authorization.

2. **Tier 2: Boundary & Corner Cases (Threshold Epsilon & Resilience)**
   - >=5 test cases per feature probing threshold limits, degenerate states, and resilience:
     - Phase 1: 0-tenant release safety, duplicate unregistration idempotency, stale dead PID recovery, and 8-tenant concurrent stop races.
     - Phase 2: Empty string keys (`""`), whitespace keys, role tampering rejection, corrupted AES vault ciphertext, and absolute minimum leverage floor clamp (3x).
     - Phase 3: Exact 30-second watchdog TTL expiration, 10-tenant concurrent burst on same symbol, 10-bot intra-tenant collision rejection, and symbol casing/delimiter normalization.
     - Phase 4: Micro-notionals ($0.0001, $59.9999) clamping to $0.0100 floor, user override boundary ($0.0099 clamped to $0.0100 vs $0.0100 respected), macro-notionals ($6,000.00 scaling to $1.0000 floor), and negative Net PnL blocking.
     - Phase 5: Undefined caller safety, idempotent quarantine without duplication, multiple coin accumulation, and casing normalization.
     - Phase 6: Empty cookie headers, empty auth_session values, signature forgery rejection, and invalid/mismatched cron secret rejection.

3. **Tier 3: Cross-Feature Combinations (Pairwise Interaction Matrix)**
   - **COMB-01 (Concurrency + Layer 7 Dynamic Exit Hurdle)**: Tenant Alpha trading BTCUSDT with $60 notional ($0.0100 floor) concurrently with Tenant Beta trading BTCUSDT with $300 notional ($0.0500 floor) without mutual interference.
   - **COMB-02 (Credential Isolation + Daemon Stop/Restart Lifecycle)**: Credential failure on one tenant engine start does not release or corrupt the active daemon lock held by running peer tenants.
   - **COMB-03 (Coin Quarantine + Concurrent Trading)**: Manual coin flatten by Tenant Alpha quarantines exclusively in Alpha's state without blocking Tenant Beta from acquiring locks or executing on that coin.
   - **COMB-04 (Route Session Auth + Multi-Tenant Lock Telemetry)**: Authenticated session inspects multi-tenant lock status while unauthenticated access is rejected.
   - **COMB-05 (Fleet Priority Mutex + Dynamic Exit Coordination)**: Fleet priority queue allocates symbol access across independent tenants with isolated lock lifecycles.
   - **COMB-06 (Multi-Tenant Dynamic Leverage Isolation)**: Tenants with default leverage (20x/10x) vs custom overrides (15x/5x) execute on identical assets with isolated leverage determinations.
   - **COMB-07 (Sizing Relaxation + Reference-Counted Daemon Locks)**: State store preserves relaxed notional sizing ($30-$60 USDT) while reference-counted daemon lock manages tenant transitions.
   - **COMB-08 (Administrative Emergency Force Override vs Graceful Stop)**: Emergency stop by administrator force-unlinks OS lockfile immediately, while regular tenant stop decrements reference count.

4. **Tier 4: Real-World Application Scenarios (End-to-End Workflows)**
   - **Scenario 1 (Test L7-01 Real-World Validation)**: Multi-tier production capital structure:
     - Plan 1 (Micro / Starter): $6 initial margin @ 10x leverage = $60 notional -> $0.0100 floor. Expansion triggers take-profit; sub-hurdle holding allows basis expansion.
     - Plan 2 (Standard Quant): $30 initial margin @ 10x leverage = $300 notional -> $0.0500 floor. Exits when Net PnL clears $0.0500; blocks early exit at $0.0200.
     - Plan 3 (Institutional Whale): $60 initial margin @ 10x leverage = $600 notional -> $0.1000 floor. Exits when Net PnL clears $0.1000; blocks early exit at $0.0600.
   - **Scenario 2 (Multi-Tenant Concurrent Trading Flow)**: Independent tenants execute on `BTCUSDT` simultaneously with distinct credentials, isolated fleet locks, and differentiated leverage.
   - **Scenario 3 (Autonomous Lifecycle Persistence & Lock Isolation)**: Tenant Alpha pauses while Tenant Beta continues running; OS lockfile remains held on disk until last tenant departs.
   - **Scenario 4 (Zero-Trust Security Perimeter Defense)**: Unauthenticated requests, empty credential executions, and tampered session tokens fail safely without exposing administrator capital.
   - **Scenario 5 (Manual Position Flatten & Blacklist Isolation)**: Manual close quarantines coin exclusively for caller; peer tenants and admin continue trading without interference.
   - **Scenario 6 (System-Wide Invariant Audit)**: Forensic validation of 100% adherence to `%` notation and modern architecture terminology.

---

## 2. Feature Inventory & Test Suite Mapping

| Phase | Milestone | Feature Description | Primary Test Target | Tier | Tests |
|---|---|---|---|---|---|
| **Phase 1** | M1 | Reference-Counted Daemon Lock Engine | `tests/e2e/multiTenant/tier1_phase1_daemon_lock.test.ts` | Tier 1 | 6 |
| **Phase 1** | M1 | Multi-Tenant Route Stop/Toggle Lifecycle | `tests/e2e/multiTenant/tier1_phase1_daemon_lock.test.ts` | Tier 1 | 5 |
| **Phase 2** | M2 | Strict Non-Admin Key Isolation & Admin Fallback Stripping | `tests/e2e/multiTenant/tier1_phase2_credentials_and_leverage.test.ts` | Tier 1 | 5 |
| **Phase 2** | M2 | Explicit MissingCredentialsError Throwing | `tests/e2e/multiTenant/tier1_phase2_credentials_and_leverage.test.ts` | Tier 1 | 5 |
| **Phase 2** | M2 | Leverage Configuration (20x normal, 10x volatile, custom overrides) | `tests/e2e/multiTenant/tier1_phase2_credentials_and_leverage.test.ts` | Tier 1 | 6 |
| **Phase 3** | M2 | Tenant-Scoped In-Flight Entry Locks (`${userId}_${symbol}`) | `tests/e2e/multiTenant/tier1_phase3_concurrency_mutexes.test.ts` | Tier 1 | 5 |
| **Phase 3** | M2 | Tenant-Scoped Fleet Mutexes (`${userId}_${corridor}_${symbol}`) | `tests/e2e/multiTenant/tier1_phase3_concurrency_mutexes.test.ts` | Tier 1 | 6 |
| **Phase 4** | M3 | Auto-Adaptive Hurdle Formula & Test L7-01 ($60/$300/$600) | `tests/e2e/multiTenant/tier1_phase4_dynamic_exit_l7.test.ts` | Tier 1 | 5 |
| **Phase 4** | M3 | Dynamic Exit Gate Evaluations in `evaluateExitGates` | `tests/e2e/multiTenant/tier1_phase4_dynamic_exit_l7.test.ts` | Tier 1 | 5 |
| **Phase 4** | M3 | State Store Notional Ceiling Relaxation & Sanitization | `tests/e2e/multiTenant/tier1_phase4_dynamic_exit_l7.test.ts` | Tier 1 | 5 |
| **Phase 5** | M4 | Caller-Scoped Coin Quarantine Dispatch (`userId` scoping) | `tests/e2e/multiTenant/tier1_phase5_quarantine.test.ts` | Tier 1 | 5 |
| **Phase 6** | M4 | Cryptographic Session Cookie Verification (`getAuthenticatedUser`) | `tests/e2e/multiTenant/tier1_phase6_route_auth.test.ts` | Tier 1 | 5 |
| **Phase 6** | M4 | Divergence Daemon Route Authorization & Cron Security | `tests/e2e/multiTenant/tier1_phase6_route_auth.test.ts` | Tier 1 | 5 |
| **All** | M1-M4 | Boundary & Corner Cases (Limits, Races, Edge Conditions) | `tests/e2e/multiTenant/tier2_boundary_corner_cases.test.ts` | Tier 2 | 30 |
| **All** | M1-M4 | Cross-Feature Combinations (Pairwise Interaction Matrix) | `tests/e2e/multiTenant/tier3_cross_feature_combinations.test.ts` | Tier 3 | 8 |
| **All** | M1-M4 | Real-World Application Scenarios (End-to-End Trading Flows) | `tests/e2e/multiTenant/tier4_real_world_application_scenarios.test.ts` | Tier 4 | 6 |
| **TOTAL** | | **Comprehensive Multi-Tenant Automated Test Suite** | **`tests/e2e/multiTenant/`** | **T1-T4** | **112** |

---

## 3. Test Runner & Execution Commands

The multi-tenant E2E test suite executes under **Vitest** configured via `web/tests/e2e/multiTenant/vitest.config.ts`.

### Run Entire E2E Multi-Tenant Suite (All 4 Tiers)
```powershell
Set-Location "C:\Users\Administrator\Desktop\AI_Hedge_Cockpit"
npm --prefix web run test -- -c tests/e2e/multiTenant/vitest.config.ts
```

### Direct Vitest Invocation from `web/`
```powershell
Set-Location "C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web"
npx vitest run -c tests/e2e/multiTenant/vitest.config.ts
```

### Run Specific Test Tiers or Suites
```powershell
# Tier 1: Phase 1 Daemon Lock Scoping Suite
npx vitest run -c tests/e2e/multiTenant/vitest.config.ts tests/e2e/multiTenant/tier1_phase1_daemon_lock.test.ts

# Tier 1: Phase 2 Credential Isolation & Leverage Suite
npx vitest run -c tests/e2e/multiTenant/vitest.config.ts tests/e2e/multiTenant/tier1_phase2_credentials_and_leverage.test.ts

# Tier 1: Phase 3 Concurrency Mutexes Suite
npx vitest run -c tests/e2e/multiTenant/vitest.config.ts tests/e2e/multiTenant/tier1_phase3_concurrency_mutexes.test.ts

# Tier 1: Phase 4 Layer 7 Dynamic Exit Engine Suite (Test L7-01)
npx vitest run -c tests/e2e/multiTenant/vitest.config.ts tests/e2e/multiTenant/tier1_phase4_dynamic_exit_l7.test.ts

# Tier 1: Phase 5 Coin Quarantine Scoping Suite
npx vitest run -c tests/e2e/multiTenant/vitest.config.ts tests/e2e/multiTenant/tier1_phase5_quarantine.test.ts

# Tier 1: Phase 6 Route Session Authentication Suite
npx vitest run -c tests/e2e/multiTenant/vitest.config.ts tests/e2e/multiTenant/tier1_phase6_route_auth.test.ts

# Tier 2: Boundary & Corner Cases Suite
npx vitest run -c tests/e2e/multiTenant/vitest.config.ts tests/e2e/multiTenant/tier2_boundary_corner_cases.test.ts

# Tier 3: Cross-Feature Combinations Suite
npx vitest run -c tests/e2e/multiTenant/vitest.config.ts tests/e2e/multiTenant/tier3_cross_feature_combinations.test.ts

# Tier 4: Real-World Application Scenarios Suite (Test L7-01 E2E)
npx vitest run -c tests/e2e/multiTenant/vitest.config.ts tests/e2e/multiTenant/tier4_real_world_application_scenarios.test.ts
```

---

## 4. Test Fixtures Catalog

Located in `web/tests/e2e/multiTenant/fixtures/multiTenantHarness.ts`:

1. **`createMockTenantUser(id, email, role, apiKeys)`**:
   - Generates fully populated, typed `UserAccount` objects conforming to the database schema.
2. **`createMockAdminUser()`**:
   - Canonical root administrator account fixture (`usr_admin_varsha`).
3. **`createMockTenantAlpha()` & `createMockTenantBeta()`**:
   - Isolated non-admin tenant accounts with dedicated live exchange credentials.
4. **`createMockTenantEmptyKeys()`**:
   - Non-admin tenant account with missing/empty API keys to verify pre-flight rejection.
5. **`createSessionCookie(userId)`**:
   - Cryptographically signs HMAC-SHA256 session token conforming to `auth_session` cookie spec.
6. **`createMockNextRequest(url, options)`**:
   - Generates Next.js synthetic `NextRequest` objects with configurable headers, cookies, and JSON bodies.
7. **`oracleDynamicExitFloor(orderNotionalUsdt, configuredFloorUsdt)`**:
   - Authoritative mathematical reference program for Layer 7 dynamic zero-loss floor scaling.
8. **`assertZeroBpsNotation(content)`**:
   - Regex-based invariant validator ensuring 0 matches for numeric bps notation.
9. **`assertModernTerminologyOnly(content)`**:
   - Regex-based invariant validator ensuring 0 occurrences of deprecated legacy bot terms.

---

## 5. Architectural Invariants Verification Matrix

| Invariant | Requirement | Verification Method | Status |
|---|---|---|---|
| **Zero BPS Notation** | Strict 100% `%` notation across all comments, docstrings, logs, and telemetry | Grep audit for `\b\d+(\.\d+)?\s*bps\b` yielding 0 matches | **CERTIFIED (0 violations)** |
| **Modern Architecture Terminology** | Ban all legacy bot terminology; use tenant runner, execution engine, autonomous hedge worker | Grep audit for banned legacy terms yielding 0 matches | **CERTIFIED (0 violations)** |
| **Linear Capital Scaling (Test L7-01)** | $60 -> $0.0100 floor, $300 -> $0.0500 floor, $600 -> $0.1000 floor | Tier 1 (P4-F7-01), Tier 2 (P4-B-04), Tier 4 (Scenario 1) | **CERTIFIED (100% Pass)** |
| **Safety Barrier Floor** | Hard floor never drops below $0.0100 USDT under any notional | Tier 1 (P4-F7-02, P4-F7-05), Tier 2 (P4-B-01, P4-B-03) | **CERTIFIED (100% Pass)** |
| **Credential Isolation** | Non-admin tenants strictly fail on missing keys; zero admin secret fallbacks | Tier 1 (P2-F3, P2-F4), Tier 2 (P2-B-01), Tier 3 (COMB-02), Tier 4 (Scenario 4) | **CERTIFIED (100% Pass)** |
| **Concurrency Scoping** | Concurrent entries on same symbol keyed by `${userId}_${symbol}` | Tier 1 (P3-F5, P3-F6), Tier 2 (P3-B-01), Tier 3 (COMB-01), Tier 4 (Scenario 2) | **CERTIFIED (100% Pass)** |
| **Daemon Lock Reference Counting** | Physical lockfile retained on disk while >=1 active tenant running | Tier 1 (P1-F1, P1-F2), Tier 2 (P1-B-04), Tier 3 (COMB-02), Tier 4 (Scenario 3) | **CERTIFIED (100% Pass)** |
