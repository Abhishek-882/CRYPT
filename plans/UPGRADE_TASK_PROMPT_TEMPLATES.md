# Modular Upgrade Task Prompt Templates
**Autonomous Delta-Neutral Funding Rate Arbitrage Cockpit (`AI_Hedge_Cockpit`)**  
**Document Version:** 1.0.0 — Actionable Implementation Agent Prompts  
**Author:** Lead Research & Synthesis Engine (`worker_synthesis_1`)  
**Date:** November 5, 2026  
**Status:** Approved Modular Task Prompts (Ready for Execution Phase)  

---

## Guide for Orchestrator & Dispatchers
Each prompt template in this catalog is a **fully self-contained, turnkey instruction set** designed to be dispatched to a specialized implementation agent (`teamwork_worker` or `implementer`). Every template includes:
1. Exact file paths, function names, and code line references.
2. Complete architectural contracts and mathematical models.
3. Step-by-step implementation methodology adhering to the minimal-change principle.
4. Independent verification commands (unit, integration, and platform test suites).
5. Strict acceptance criteria and integrity safeguards.
6. Explicit, step-by-step file-based rollback procedures (Note: Git is NOT installed in this Windows host environment; all rollback procedures must utilize explicit file-based backups like `Copy-Item <file>.ts.bak <file>.ts` or direct file restoration, never `git checkout`).

---

## Index of Upgrade Prompt Templates

- **Template 1 (Area 1)**: Real Post-Only Maker-Taker Limit Order Execution Engine
- **Template 2 (Area 2)**: Sub-35ms WebSocket Pipeline & Sequential Stagger Removal
- **Template 3 (Area 9/10)**: Pre-Flight Contract Eligibility & Bybit Agreement Screener
- **Template 4 (Area 8)**: L2 20-Level Depth Ingestion & Deterministic VWAP Sweep Engine
- **Template 5 (Area 3)**: Dynamic Fee Schedule & Multi-Factor Composite Arbitrage Scoring (CAS)
- **Template 6 (Area 6)**: Real-Time Cumulative Premium Index TWAP Predictive Funding Engine
- **Template 7 (Area 5)**: Hyperliquid L1 Perpetuals Connector Integration
- **Template 8 (Area 4)**: Fractional Kelly Sizing, ATR Dynamic Leverage & Asymmetric Margin Balancer
- **Template 9 (Area 7)**: Ornstein-Uhlenbeck (OU) Mean-Reversion Exit Optimizer & Carry Compounding
- **Template 10 (Area 9)**: Dynamic NAV Risk Gate, Margin Re-Centering & Pearson Correlation Breaker

---

## Prompt Template 1: Real Post-Only Maker-Taker Limit Order Execution Engine

```markdown
### Task Title & Role
Implement Real Exchange Post-Only Limit Order Execution with 8-Second Watchdog and Taker Fallback  
**Role**: `implementer` (Execution & Routing Specialist)

### Working Directory & Target Files
- Working Directory: `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\`
- Primary Files:
  - `web/lib/makerTakerRouter.ts` (Refactor mock stubs to real exchange execution)
  - `web/lib/botEngine.ts` (Lines 3218–3265: integrate real maker call and pass real order book bids/asks)
  - `web/lib/binanceSigner.ts` (Expose `timeInForce: "GTX"` in order parameter types)
  - `web/lib/bybitSigner.ts` (Expose `timeInForce: "PostOnly"` in order parameter types)
  - `web/tests/unit/makerTakerExecution.test.ts` (Add unit test coverage for real limit execution and timeout cancels)

### Context & Problem Statement
In `web/lib/makerTakerRouter.ts` (lines 61–132), simulated execution uses `MockExchangeEngine` in RAM, while live execution immediately returns `error: "MAKER_LIVE_REQUIRES_TAKER_FALLBACK"`. In `web/lib/botEngine.ts:3218–3265`, synthetic bid/ask quotes (`* 0.9999`) are passed, causing maker routing to be permanently disabled (`scripts/disable_maker_routing.js`). As a result, 100% of trading volume incurs dual-taker fees (22 to 50 bps round-trip), eroding net funding profits.

### Technical Requirements & Architectural Contract
1. In `web/lib/makerTakerRouter.ts`:
   - Implement `calculatePostOnlyPrice(side, bestBid, bestAsk, tickSize)`:
     - For BUY: `floor(bestBid / tickSize) * tickSize`.
     - For SELL: `ceil(bestAsk / tickSize) * tickSize`.
   - Implement `executeRealMakerLeg1()`:
     - Binance USD-M Futures: Set `type: "LIMIT"`, `timeInForce: "GTX"`.
     - Bybit Linear Unified: Set `orderType: "Limit"`, `timeInForce: "PostOnly"`.
   - 8-Second Queue Watchdog:
     - Transmit limit order and poll status every 400ms or await WebSocket execution event.
     - If filled (`status === "FILLED"`): resolve immediately with `filled: true, feeSavedBps: 40`.
     - If timeout ($t \ge 8\text{s}$): transmit cancel command (`DELETE /fapi/v1/order` or Bybit `/v5/order/cancel`).
     - Upon cancel confirmation: check `executedQty`. If 0, mark `CANCELLED_ZERO_FILL` and cleanly abort ($0.00 loss). If partially filled ($q_{\text{exec}} > 0$), return `executedQty` so Leg 2 is sized strictly to match $q_{\text{exec}}$, maintaining 100% delta neutrality.
2. In `web/lib/botEngine.ts`:
   - Replace synthetic bids/asks (`* 0.9999`) with real top-of-book prices from `preExecPrices` or order book cache.
   - If `makerRes.filled` is true: proceed to Leg 2 execution sized to `makerRes.executedQty`.
   - If timeout / cancelled with zero fill: abort cycle cleanly.
   - Fallback: If time to settlement $T < 25\text{s}$ and net spread $> 45\text{ bps}$, bypass maker queue and execute aggressive dual-taker IOC.

### Step-by-Step Implementation Methodology
1. View and review `web/lib/makerTakerRouter.ts` and `web/lib/botEngine.ts:3218–3265`.
2. Update `BinanceOrderParams` in `binanceSigner.ts` and `BybitOrderParams` in `bybitSigner.ts` to support Post-Only time-in-force parameters.
3. Replace mock execution logic in `makerTakerRouter.ts` with real `executeRealMakerLeg1()` using existing signing pipelines (`signAndFetchBinance` / `sendBybitRequest`).
4. Update `botEngine.ts` to pass real order book bids, asks, and tick sizes, handling `executedQty` on partial fills.
5. Re-enable maker routing in bot configurations.

### Unit & Integration Verification Commands
```powershell
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
npx vitest run tests/unit/makerTakerExecution.test.ts
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
node scripts/generate_fleet_status_report.js
```

### Acceptance Criteria & Integrity Safeguards
- [ ] No simulated `MockExchangeEngine` or hardcoded test returns used in production live paths.
- [ ] Binance limit orders specify `timeInForce: "GTX"` and Bybit limit orders specify `timeInForce: "PostOnly"`.
- [ ] 8-second timeout cleanly cancels resting orders with zero orphan risk.
- [ ] Leg 2 is strictly sized to `executedQty`.
- [ ] All 51 vitest unit tests pass with zero regressions.

### Rollback Procedure
If limit execution encounters exchange rejections or unexpected queue starvation:
1. Re-run `node scripts/disable_maker_routing.js` to set `enableMakerRouting = false` in `bot_daemon_state.json`.
2. Restore `web/lib/makerTakerRouter.ts` and `web/lib/botEngine.ts` from pre-edit backup copies via PowerShell: `Copy-Item web/lib/makerTakerRouter.ts.bak web/lib/makerTakerRouter.ts` and `Copy-Item web/lib/botEngine.ts.bak web/lib/botEngine.ts` (or direct file reversion). Note: `git` is NOT installed on this host environment—do not invoke `git checkout`.
```

---

## Prompt Template 2: Sub-35ms WebSocket Pipeline & Sequential Stagger Removal

```markdown
### Task Title & Role
Activate Persistent Bybit Private WebSocket Client and Remove Artificial Post-Fill Stagger Delay  
**Role**: `implementer` (Low-Latency Network Specialist)

### Working Directory & Target Files
- Working Directory: `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\`
- Primary Files:
  - `web/lib/bybitTradeStream.ts` (Lines 149–206: dynamic vault credential injection and auto-connect)
  - `web/lib/botEngine.ts` (Lines 3299 and 3427: delete redundant sequential stagger delay `setTimeout`)
  - `web/lib/binanceStreamManager.ts` (New module: subscribe to `!markPrice@arr@1s`)

### Context & Problem Statement
Currently, `bybitTradeStream.connect()` is never called with active decrypted vault credentials at bot startup, causing Bybit orders to fail the health check (`bybitTradeStream.isHealthy() === false`) and fall back to HTTP REST through proxies (253ms–473ms RTT). Furthermore, `botEngine.ts:3299` sleeps for an extra 60ms *after* Leg 1 has already completely filled. Total inter-leg latency is 448ms to 650ms, causing 3.0 to 7.0 bps of adverse price slippage during volatile pre-funding minutes.

### Technical Requirements & Architectural Contract
1. In `web/lib/bybitTradeStream.ts`:
   - Add method `public initializeWithVaultCreds(creds: { apiKey: string; apiSecret: string; proxyUrl?: string }): Promise<boolean>`.
   - In `web/lib/botEngine.ts` startup sequence: call `bybitTradeStream.initializeWithVaultCreds()` when vault keys are decrypted.
2. In `web/lib/botEngine.ts` (lines 3299 and 3427):
   - Remove `await new Promise((r) => setTimeout(r, leg2DelayMs))` inside sequential execution.
   - Stagger delays must ONLY apply when orders are launched concurrently, never after Leg 1 fill has been confirmed.
3. In `web/lib/binanceStreamManager.ts`:
   - Connect to `wss://fstream.binance.com/ws/!markPrice@arr@1s`.
   - Update in-memory ticker map on every 1-second push frame, bypassing the 5-second REST poll in `fetchOpportunityCoins()`.

### Step-by-Step Implementation Methodology
1. View `web/lib/bybitTradeStream.ts:140–210` and `web/lib/botEngine.ts:3280–3320, 3410–3440`.
2. Implement `initializeWithVaultCreds` in `bybitTradeStream.ts`.
3. In `botEngine.ts`, trigger WebSocket connection during bot daemon startup.
4. Remove the redundant `setTimeout(r, leg2DelayMs)` lines in sequential execution blocks.
5. Create `binanceStreamManager.ts` and integrate into `fetchOpportunityCoins()`.

### Unit & Integration Verification Commands
```powershell
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
npx vitest run tests/unit/adversarialMacroYieldChallenge.test.ts
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
node scripts/generate_fleet_status_report.js
```

### Acceptance Criteria & Integrity Safeguards
- [ ] `bybitTradeStream.isHealthy()` returns true when bot daemon is active.
- [ ] Sequential inter-leg execution has zero redundant sleep calls.
- [ ] 800ms watchdog circuit breaker remains intact for automatic fallback to HTTP REST.
- [ ] No regression on platform verification scripts.

### Rollback Procedure
Revert changes to `bybitTradeStream.ts` and restore the `setTimeout` line in `botEngine.ts`.
```

---

## Prompt Template 3: Pre-Flight Contract Eligibility & Bybit Agreement Screener

```markdown
### Task Title & Role
Implement Pre-Flight Exchange Contract Eligibility and Trading Agreement Screener  
**Role**: `implementer` / `qa` (Risk & Exchange Integration Specialist)

### Working Directory & Target Files
- Working Directory: `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\`
- Primary Files:
  - `web/lib/contractEligibilityScreener.ts` (New Module)
  - `web/lib/botEngine.ts` (Lines 2877–2910: integrate screener before executing Leg 1)
  - `web/tests/unit/contractEligibility.test.ts` (New Unit Test)

### Context & Problem Statement
Forensic analysis of production logs (`trade_audit_permanent.jsonl`) revealed 4 failed trades (`BXUSDT`, `EQTUSDT`, `CIENUSDT`, `DDOGUSDT`) where Leg 1 filled on Binance in 137ms, but Bybit rejected Leg 2 because user agreement terms were not accepted on Bybit (`"You must sign the required agreement before trading this contract"`). This forced emergency IOC market unwinds on Leg 1, incurring taker fees and slippage without collecting any funding.

### Technical Requirements & Architectural Contract
1. Create `web/lib/contractEligibilityScreener.ts`:
   - Query Bybit `/v5/market/instruments-info?category=linear` and `/v5/user/query-api` at daemon startup.
   - Cache contract statuses, agreement requirements, and minimum notional sizes.
   - Provide synchronous method: `public isContractEligible(venue: string, symbol: string): { eligible: boolean; reason?: string }`.
2. In `web/lib/botEngine.ts`:
   - In `fetchOpportunityCoins()` and before `executeDualHedgeEntry()`, validate that both Leg 1 and Leg 2 symbols are eligible and agreements are active.
   - If ineligible, immediately skip symbol and add to `flattenedCoinsBlacklist` with reason `AGREEMENT_REQUIRED`.

### Step-by-Step Implementation Methodology
1. Create `web/lib/contractEligibilityScreener.ts` with caching and instrument inspection.
2. Add unit tests in `web/tests/unit/contractEligibility.test.ts` testing known rejection symbols (`BXUSDT`, `EQTUSDT`, `CIENUSDT`, `DDOGUSDT`).
3. Wire pre-flight validation into `botEngine.ts` prior to calling `executeLeg1()`.

### Unit & Integration Verification Commands
```powershell
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
npx vitest run tests/unit/adversarialOption2StrictSync.test.ts
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
node scripts/generate_fleet_status_report.js
```

### Acceptance Criteria & Integrity Safeguards
- [ ] Pre-flight gate intercepts `BXUSDT`, `EQTUSDT`, `CIENUSDT`, `DDOGUSDT` before placing Leg 1 orders.
- [ ] Zero contract agreement rejections occur in live or simulated trading.
- [ ] Cache refreshes every 1 hour.

### Rollback Procedure
Remove the pre-flight check call from `botEngine.ts:2877`.
```

---

## Prompt Template 4: L2 20-Level Depth Ingestion & Deterministic VWAP Sweep Engine

```markdown
### Task Title & Role
Implement L2 20-Level Order Book Depth Ingestion & Deterministic VWAP Sweep Friction Engine  
**Role**: `implementer` (Market Microstructure Specialist)

### Working Directory & Target Files
- Working Directory: `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\`
- Primary Files:
  - `web/lib/orderBookManager.ts` (New Module)
  - `web/lib/botEngine.ts` (Lines 2456–2668: replace L1 heuristics with true L2 VWAP sweeps)
  - `web/tests/unit/orderBookVwap.test.ts` (New Unit Test)

### Context & Problem Statement
Currently, `evaluatePreTradeSlippageAndDepth` in `botEngine.ts` queries Level 1 top-of-book only (`bookTicker` / `tickers`), applying a synthetic heuristic formula `(ratio - 1) * 2.5`. In thin altcoins, top-of-book depth is under $50. An order of $200 sweeps 5 to 10 levels, causing 25 to 65 bps of unmodeled slippage that destroys arbitrage profitability.

### Technical Requirements & Architectural Contract
1. Create `web/lib/orderBookManager.ts`:
   - Fetch 20-level order book snapshots:
     - Binance: `GET /fapi/v1/depth?symbol=${symbol}&limit=20`.
     - Bybit: `GET /v5/market/orderbook?category=linear&symbol=${symbol}&limit=25`.
   - Implement `calculateVwapSweep(levels: OrderBookLevel[], targetNotional: number): VwapSweepResult`:
     $$\text{VWAP} = \frac{\sum_{i=1}^{k} P_i \cdot Q_i}{\sum_{i=1}^{k} Q_i}, \quad \text{Slippage}_{\text{bps}} = \left| \frac{\text{VWAP} - P_{\text{mid}}}{P_{\text{mid}}} \right| \times 10000$$
2. In `web/lib/botEngine.ts`:
   - Replace synthetic ratio heuristics in `evaluatePreTradeSlippageAndDepth` with true cumulative VWAP sweep calculation.
   - Reject candidates if total expected dual-leg slippage exceeds `maxPreTradeSlippagePct` (default: 5.0 bps) or available depth within 10 bps is less than $3\times$ order notional.

### Step-by-Step Implementation Methodology
1. Implement `orderBookManager.ts` with keep-alive HTTP agent pooling and cached depth maps.
2. Author unit tests covering multi-level order book sweeping, partial book exhaustion, and slippage calculations.
3. Update `evaluatePreTradeSlippageAndDepth` in `botEngine.ts` to call `orderBookManager.evaluateDualLegFriction()`.

### Unit & Integration Verification Commands
```powershell
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
npx vitest run tests/unit/adversarialMacroYieldChallenge.test.ts
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
node scripts/generate_fleet_status_report.js
```

### Acceptance Criteria & Integrity Safeguards
- [ ] Multi-level book sweeps accurately calculate VWAP and slippage bps across discrete depth tiers.
- [ ] Candidates with insufficient book depth (<3x notional) are rejected before order dispatch.
- [ ] Zero mock data used; real exchange depth endpoints queried.

### Rollback Procedure
Revert `evaluatePreTradeSlippageAndDepth` in `botEngine.ts` to Level 1 fallback check.
```

---

## Prompt Template 5: Dynamic Fee Schedule & Multi-Factor Composite Arbitrage Scoring (CAS)

```markdown
### Task Title & Role
Implement Dynamic VIP Fee Schedule and Multi-Factor Composite Arbitrage Scoring (CAS) Engine  
**Role**: `implementer` (Quantitative Arbitrage Specialist)

### Working Directory & Target Files
- Working Directory: `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\`
- Primary Files:
  - `web/lib/feeScheduleEngine.ts` (New Module)
  - `web/lib/candidateScoring.ts` (New Module)
  - `web/lib/spreadCalculation.ts` (Lines 12–47 & 128–169: integrate dynamic fee hurdles)
  - `web/lib/botEngine.ts` (Lines 2264 and 5840–5876: replace 1-D sort with CAS ranking)
  - `web/tests/unit/candidateScoring.test.ts` (New Unit Test)

### Context & Problem Statement
Currently, `spreadCalculation.ts:12–15` uses static constants (`ROUNDTRIP_TAKER_FEE_PCT = 0.25`, `MIN_GROSS_SPREAD_PCT = 0.35`). In `botEngine.ts:2264`, candidates are sorted strictly by nominal gross funding spread. High gross spread candidates with wide adverse signed basis ($P_A \ll P_B$) are prioritized over deep, favorable basis pairs, incurring severe price slippage.

### Technical Requirements & Architectural Contract
1. Create `web/lib/feeScheduleEngine.ts`:
   - Query user VIP tier fee rates on Binance, Bybit, Bitget, and CoinDCX.
   - Calculate corridor round-trip transaction friction dynamically:
     $$\text{Fee}_{\text{corridor}} = (f_{\text{leg1,open}} + f_{\text{leg2,open}} + f_{\text{leg1,close}} + f_{\text{leg2,close}}) \times (1 + \text{TaxRate})$$
2. Create `web/lib/candidateScoring.ts`:
   - Implement `computeCompositeArbitrageScore(factors)`:
     $$\text{CAS} = 0.35 \cdot \widehat{S}_{\text{net}} + 0.20 \cdot B_{\text{signed}} + 0.15 \cdot P_{\text{persist}} + 0.15 \cdot L_{\text{depth}} - 0.10 \cdot \sigma_{\text{basis}} - 0.05 \cdot \tau_{\text{decay}}$$
3. In `web/lib/botEngine.ts`:
   - In `fetchOpportunityCoins()`, rank candidate opportunities by `CAS` instead of `spreadBps`.

### Step-by-Step Implementation Methodology
1. Implement `feeScheduleEngine.ts` and wire into `spreadCalculation.ts`.
2. Implement `candidateScoring.ts` with normalized scoring logic.
3. Replace 1-D sort in `botEngine.ts:2264` with `results.sort((a, b) => b.compositeScore - a.compositeScore)`.

### Unit & Integration Verification Commands
```powershell
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
npx vitest run tests/unit/adversarialMacroYieldChallenge.test.ts
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
node scripts/generate_fleet_status_report.js
```

### Acceptance Criteria & Integrity Safeguards
- [ ] Dynamic fees reflect real account VIP tiers and maker/taker routing options.
- [ ] Candidates are ranked by multi-factor score; adverse signed basis pairs receive negative score adjustments.
- [ ] Unit tests pass with 100% success.

### Rollback Procedure
Restore line 2264 of `botEngine.ts` to `results.sort((a, b) => b.spreadBps - a.spreadBps)`.
```

---

## Prompt Template 6: Real-Time Cumulative Premium Index TWAP Predictive Funding Engine

```markdown
### Task Title & Role
Implement Real-Time Cumulative Premium Index TWAP Predictive Funding Engine  
**Role**: `implementer` (Statistical Modeling Specialist)

### Working Directory & Target Files
- Working Directory: `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\`
- Primary Files:
  - `web/lib/fundingRatePredictor.ts` (New Module)
  - `web/lib/spreadCalculation.ts` (Lines 128–169: support predicted settlement rate)
  - `web/lib/botEngine.ts` (Lines 2145–2170: ingest real-time mark/index prices into TWAP predictor)
  - `web/tests/unit/fundingRatePredictor.test.ts` (New Unit Test)

### Context & Problem Statement
Currently, `botEngine.ts:2148` reads static `lastFundingRate`. Funding settles as the 8-hour TWAP of the Premium Index. By the time $t=6\text{h}$, 75% of the rate is already mathematically locked in. Waiting for the exchange to publish `lastFundingRate` causes late entries with higher market divergence.

### Technical Requirements & Architectural Contract
1. Create `web/lib/fundingRatePredictor.ts`:
   - Sample mark and index prices every 1 second:
     $$\widehat{F}_{\text{pred}}(T) = \frac{1}{T_{\text{total}}} \left[ \sum_{\tau=0}^{t_{\text{now}}} P_{\tau} \Delta \tau + P_{\text{current}} \times (T_{\text{total}} - t_{\text{now}}) \right] + \text{InterestRate}$$
   - Compute standard error and 95% confidence intervals:
     $$\text{SE}(\widehat{F}_{\text{pred}}) = \sigma_P \times \frac{\sqrt{N_{\text{remaining}}}}{N_{\text{total}}}, \quad \text{CI}_{95\%} = \widehat{F}_{\text{pred}} \pm 1.96 \times \text{SE}(\widehat{F}_{\text{pred}})$$
     (guaranteeing continuous convergence to $\text{SE} = 0.00$ at settlement countdown without division by zero).
2. In `spreadCalculation.ts` and `botEngine.ts`:
   - Qualify candidates based on predicted upcoming settlement rate $\widehat{F}_{\text{pred}}$ rather than historical `lastFundingRate`.

### Step-by-Step Implementation Methodology
1. Implement `fundingRatePredictor.ts` with circular sample buffers.
2. Author unit tests verifying mathematical convergence of TWAP estimates.
3. Wire predicted rates into candidate evaluation in `botEngine.ts`.

### Unit & Integration Verification Commands
```powershell
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
npx vitest run tests/unit/adversarialMacroYieldChallenge.test.ts
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
node scripts/generate_fleet_status_report.js
```

### Acceptance Criteria & Integrity Safeguards
- [ ] Predicted funding rates match analytical TWAP formulas with $<1.0\text{ bps}$ error on test vectors.
- [ ] Trade entries require lower confidence bound to clear dynamic fee hurdle.
- [ ] Existing vitest suites pass clean.

### Rollback Procedure
Toggle `config.enablePredictiveFunding = false` in `botEngine.ts`.
```

---

## Prompt Template 7: Hyperliquid L1 Perpetuals Connector Integration

```markdown
### Task Title & Role
Implement Hyperliquid L1 Perpetuals Connector (EIP-712 Signing, 24 Hourly Funding Cadence)  
**Role**: `implementer` (DEX & Protocol Specialist)

### Working Directory & Target Files
- Working Directory: `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\`
- Primary Files:
  - `web/lib/hyperliquidSigner.ts` (New Module: EIP-712 typed signing & REST client)
  - `web/lib/hyperliquidTradeStream.ts` (New Module: WebSocket market & execution feed)
  - `web/lib/latencyTracker.ts` (Add Hyperliquid latency tracking)
  - `web/lib/exchangeFundingMeta.ts` (Add Hyperliquid 1h funding interval discovery)
  - `web/lib/botEngine.ts` (Add Hyperliquid corridors: `HYPERLIQUID_BINANCE`, `HYPERLIQUID_BYBIT`)
  - `web/tests/unit/hyperliquidConnector.test.ts` (New Unit Test)

### Context & Problem Statement
Hyperliquid is the premier on-chain perpetuals venue, featuring 24 hourly funding payouts/day, 0% gas, and maker fee rebates (-0.2 bps). The current platform lacks Hyperliquid integration, missing out on massive retail contango/backwardation spreads that reach 800%+ APR.

### Technical Requirements & Architectural Contract
1. Create `web/lib/hyperliquidSigner.ts`:
   - Implement EIP-712 typed data signing using Arbitrum wallet private key (stored encrypted in vault).
   - Endpoints: `POST https://api.hyperliquid.xyz/exchange` (place/cancel orders), `POST https://api.hyperliquid.xyz/info` (positions, balances, funding rates).
2. Create `web/lib/hyperliquidTradeStream.ts`:
   - Connect to `wss://api.hyperliquid.xyz/ws` for `allMids`, `l2Book`, and `userFills`.
3. In `exchangeFundingMeta.ts`:
   - Define Hyperliquid funding interval as 1 hour (`fundingIntervalHours: 1`).
4. In `botEngine.ts`:
   - Enable corridors: `HYPERLIQUID_BINANCE`, `HYPERLIQUID_BYBIT`.

### Step-by-Step Implementation Methodology
1. Implement `hyperliquidSigner.ts` with EIP-712 domain separator and order action schemas.
2. Implement `hyperliquidTradeStream.ts` with reconnect and heartbeat handling.
3. Register `Hyperliquid` in `latencyTracker.ts` and `exchangeFundingMeta.ts`.
4. Add unit test suite with mock RPC/WS responses.

### Unit & Integration Verification Commands
```powershell
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
npx vitest run tests/unit/adversarialOption2StrictSync.test.ts
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
node scripts/generate_fleet_status_report.js
```

### Acceptance Criteria & Integrity Safeguards
- [ ] EIP-712 signing generates cryptographically valid payloads.
- [ ] 1-hour funding cycle correctly interacts with asymmetric macro yield calculations.
- [ ] Zero impact on existing Binance/Bybit/Bitget corridors when Hyperliquid is disabled.

### Rollback Procedure
Disable Hyperliquid in `bot_daemon_state.json` corridor configuration.
```

---

## Prompt Template 8: Fractional Kelly Sizing, ATR Dynamic Leverage & Asymmetric Margin Balancer

```markdown
### Task Title & Role
Implement Fractional Kelly Sizing, ATR-Scaled Dynamic Leverage, and Asymmetric Margin Balancing  
**Role**: `implementer` (Portfolio Risk & Capital Allocation Specialist)

### Working Directory & Target Files
- Working Directory: `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\`
- Primary Files:
  - `web/lib/positionSizer.ts` (New Module: Fractional Kelly)
  - `web/lib/leverageManager.ts` (New Module: ATR leverage scaling)
  - `web/lib/exchangeLeverageMeta.ts` (Lines 199–228: asymmetric leverage solver)
  - `web/lib/botEngine.ts` (Lines 5528–5563, 6081–6095: integrate dynamic allocator)
  - `scripts/test_leverage_and_margin_calculator.js` (Verify margin balancing suite)

### Context & Problem Statement
Currently, `botEngine.ts:5528` clamps allowable margin to `Math.min(venueAFree, venueBFree)`, trapping excess capital on unbalanced accounts. Fixed 20% margin sizing and static leverage tiers treat high-volatility meme coins and low-volatility majors identically.

### Technical Requirements & Architectural Contract
1. In `web/lib/positionSizer.ts`:
   - Implement Hurdle-Gated Fractional Kelly sizing:
     $$f^* = \begin{cases} 0.00 & \text{if } \mu_{\text{net\_spread}} \le \mu_{\text{min\_hurdle}} \text{ or } \sigma^2_{\text{basis}} \le 0 \\ \text{clamp}\left(0.25 \times \frac{\mu_{\text{net\_spread}}}{\sigma^2_{\text{basis}}}, 0.10, 0.35\right) & \text{if } \mu_{\text{net\_spread}} > \mu_{\text{min\_hurdle}} \end{cases}$$
   - Enforce unit parity: both $\mu$ and $\sigma$ must strictly be in the same units (both in basis points or both in decimals).
2. In `web/lib/leverageManager.ts`:
   - Dynamically scale leverage using tier-calibrated buffers:
     $$L_{\text{dyn}} = \text{clamp}\left(\left\lfloor \frac{\text{TierBuffer}_{\%}}{\max(0.20\%, \text{ATR}_{1\text{h\_pct}})} \right\rfloor, 3, L_{\text{max\_exchange}}\right)$$
     where $\text{TierBuffer}_{\%} = 1.6\%$ for BTC/ETH (25x–50x), $3.0\%$ for Large Caps (15x–25x), and $5.0\%$ for Altcoins (3x–10x).
   - Provide defensive fallback ($L_{\text{dyn}} = 3\text{x}$ to $5\text{x}$) if candles $< 14$ or ATR is NaN.
3. In `web/lib/exchangeLeverageMeta.ts`:
   - Solve asymmetric leverage ratio: $\frac{L_A}{L_B} = \frac{\text{Margin}_B}{\text{Margin}_A} \implies M_A \times L_A = M_B \times L_B$, bounded by $\max(L_A / L_B) \le 3.0$.

### Step-by-Step Implementation Methodology
1. Implement `positionSizer.ts` and `leverageManager.ts`.
2. Update `exchangeLeverageMeta.ts` asymmetric solver.
3. Wire dynamic allocation into `botEngine.ts:6081–6095`.
4. Run `test_leverage_and_margin_calculator.js`.

### Unit & Integration Verification Commands
```powershell
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
node scripts/test_leverage_and_margin_calculator.js
node scripts/generate_fleet_status_report.js
```

### Acceptance Criteria & Integrity Safeguards
- [ ] Zero directional delta: $M_A \times L_A = M_B \times L_B$ strictly verified across all asymmetric tests.
- [ ] High-volatility alts restricted to safe leverage tiers (5x–10x).
- [ ] `test_leverage_and_margin_calculator.js` passes with 100% success.

### Rollback Procedure
Revert `botEngine.ts:6081–6095` to fixed `balanceAllocationPct` logic.
```

---

## Prompt Template 9: Ornstein-Uhlenbeck (OU) Mean-Reversion Exit Optimizer & Carry Compounding

```markdown
### Task Title & Role
Implement Ornstein-Uhlenbeck Mean-Reversion Exit Optimizer and Multi-Cycle Carry Compounding  
**Role**: `implementer` (Stochastic Calculus & Execution Specialist)

### Working Directory & Target Files
- Working Directory: `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\`
- Primary Files:
  - `web/lib/exitOptimizer.ts` (New Module)
  - `web/lib/botEngine.ts` (Lines 5236–5325: replace 15-minute hard timeout with OU stopping time)
  - `web/tests/unit/exitOptimizer.test.ts` (New Unit Test)

### Context & Problem Statement
In `botEngine.ts:5301`, a rigid 15-minute timeout forces market taker unwinds when basis has not yet converged (e.g. `1000CATUSDT` forced close into 2.09% divergence). This creates severe basis slippage on exits.

### Technical Requirements & Architectural Contract
1. Create `web/lib/exitOptimizer.ts`:
   - Model basis as an Ornstein-Uhlenbeck process: $dX_t = \theta (\mu - X_t) dt + \sigma dW_t$.
   - Calculate divergence half-life: $t_{\text{half}} = \ln(2) / \theta$.
   - Calculate analytical exit utility using directional basis PnL formulation:
     $$U_{\text{exit}}(t) = \text{HarvestedFunding}_{\$} + \text{BasisPnL}_{\$}(X_t, X_0) - \text{ExitFees}_{\$} - \text{OpportunityCost}_{\$}(t)$$
     where $\text{BasisPnL}_{\$}(X_t, X_0) = \text{Side}_{\text{LegA}} \times (X_t - X_0) \times \text{Notional}_{\$}$.
   - If $|X_t| > 2\sigma$ and $t < 2 \times t_{\text{half}}$, hold position or roll into carry continuation.
   - If forward spread $\ge 25\text{ bps}$, compound into next cycle without paying exit/re-entry fees.
2. In `web/lib/botEngine.ts`:
   - Replace line 5301 with `exitOptimizer.evaluateOptimalExit()`.

### Step-by-Step Implementation Methodology
1. Implement `exitOptimizer.ts` with discrete-time AR(1) parameter estimation for OU parameters.
2. Author unit test verifying stopping time decisions on historical divergence vectors.
3. Replace the 15-minute timeout in `botEngine.ts:5292–5325`.

### Unit & Integration Verification Commands
```powershell
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
npx vitest run tests/unit/adversarialMacroYieldChallenge.test.ts
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
node scripts/generate_fleet_status_report.js
```

### Acceptance Criteria & Integrity Safeguards
- [ ] No forced market unwinds into wide basis divergences $>1.0\%$.
- [ ] Hard catastrophic stop-loss ceiling retained at 4.0% basis divergence.
- [ ] Multi-cycle carry roll increments `cyclesHarvested` seamlessly.

### Rollback Procedure
Restore the 15-minute timeout in `botEngine.ts:5301`.
```

---

## Prompt Template 10: Dynamic NAV Risk Gate, Margin Re-Centering & Pearson Correlation Breaker

```markdown
### Task Title & Role
Implement Dynamic NAV Risk Scaling, Real-Time Margin Re-Centering, and Pearson Correlation Circuit Breaker  
**Role**: `implementer` / `qa` (Institutional Risk & Capital Preservation Specialist)

### Working Directory & Target Files
- Working Directory: `C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\`
- Primary Files:
  - `web/lib/riskGate.ts` (Lines 58–66, 225–319: replace static caps with NAV multipliers)
  - `web/lib/circuitBreaker.ts` (New Module: Rolling Pearson correlation & basis z-score)
  - `web/lib/botEngine.ts` (Lines 4914–4956: integrate correlation circuit breaker)
  - `web/tests/unit/riskGate.test.ts` (Unit Test)

### Context & Problem Statement
`riskGate.ts:58–66` hardcodes risk caps ($500 single order, $2,500 gross exposure, $150 daily loss) based on a static $3,750 baseline. Furthermore, the system lacks dynamic cross-exchange price correlation monitors, leaving the portfolio vulnerable to exchange index oracle desynchronizations or API freezes.

### Technical Requirements & Architectural Contract
1. In `web/lib/riskGate.ts`:
   - Scale limits dynamically with live Portfolio Net Asset Value (NAV):
     - Single order cap: $\text{NAV} \times 0.15$ (15%).
     - Gross exposure cap: $\text{NAV} \times 0.80$ (80%).
     - Daily loss kill-switch: $\text{NAV} \times 0.04$ (4.0%).
   - Retain unconditional approval for emergency unwinds (`req.isEmergencyClose === true`).
2. Create `web/lib/circuitBreaker.ts`:
   - Compute 60-second rolling Pearson correlation $r_{60\text{s}}$ between Venue A and Venue B mid-prices.
   - If $r_{60\text{s}} < 0.80$ OR basis $Z > 3.5\sigma$ across 3 consecutive seconds:
     - Halt new entries immediately.
     - Engage Synthetic Delta Lock on surviving positions.
3. Real-Time Margin Ratio Re-Centering:
   - If exchange margin ratio exceeds 70%, trigger automated partial de-leveraging (unwinds 30% of position symmetrically).

### Step-by-Step Implementation Methodology
1. Refactor `riskGate.ts` to compute dynamic NAV thresholds.
2. Implement `circuitBreaker.ts` with Pearson correlation calculation.
3. Wire circuit breaker checks into `botEngine.ts:4914–4956`.
4. Update unit tests in `web/tests/unit/riskGate.test.ts`.

### Unit & Integration Verification Commands
```powershell
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit\web
npx vitest run tests/unit/adversarialOption2StrictSync.test.ts
cd C:\Users\Administrator\Desktop\AI_Hedge_Cockpit
node scripts/generate_fleet_status_report.js
```

### Acceptance Criteria & Integrity Safeguards
- [ ] Emergency close orders are never blocked by risk gates.
- [ ] Correlation breakdown ($r < 0.80$) cleanly halts new entries.
- [ ] Dynamic risk limits adapt across accounts from $500 to $500,000 NAV.

### Rollback Procedure
Revert `riskGate.ts` to static constant caps.
```
