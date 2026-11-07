# AI Hedge Cockpit Engineering Invariants & Safety Protocols

## 1. Multi-Venue Instrument Filtering
- **Pre-Flight Non-Crypto Filtering**: When scanning Bybit linear perpetuals, always query `/v5/market/instruments-info?category=linear` and exclude any instrument where `symbolType && symbolType !== "innovation"` (e.g. `stock`, `ETF`, `commodity`, `forex`).
- **Upstream TradFi Stock Filtration**: In all opportunity ingestion pipelines (`fetchOpportunityCoins()`, `route.ts`), filter out TradFi equities, commodities, and ETFs upfront before candidate scoring and corridor pairing. Never permit stock contracts (e.g. `CATUSDT` Caterpillar Inc. stock at $582) to enter candidate pools or masquerade as crypto meme coins (`1000CATUSDT`).
- **Dynamic Candidate Tracking & Non-Latching Fallback**: Scanner fallback candidate tracking must continually evaluate and update to the true highest spread candidate on the active corridor. Never latch onto or display 0-bps pairs when higher spread opportunities exist.
- **Accurate Diagnostic Telemetry**: Scanner fallback status messages must dynamically reflect the user's active configured thresholds (`maxPriceDivergencePct`, `optimalPriceDivergencePct`, `minSpreadBps`). Never emit hardcoded or generic rejection messages (such as `[PRICE DIFF GATE] Price diff > stage target`) without verifying the true underlying rejection reason and active config values.
- **Web-Agreement Gating**: Never dispatch Leg 1 on any venue until verifying that both venues support immediate programmatic execution without pending user agreements or regional restrictions.
- **Contract Parity & Scale Normalization**: Assert decimal multiplier alignment (e.g. `CATUSDT` vs `1000CATUSDT`). Exceeding the 250 bps signed basis safety cap must always trigger an immediate pre-trade abort.
- **Dynamic Spread-Proportional Divergence Scaling**: Entry price divergence must never be restricted solely to a hardcoded static ceiling. When high gross spreads exist (e.g. 100-200 bps), the allowable price divergence scales dynamically up to `maxDivergenceSpreadRatioPct` (default 25-30% of spread), while remaining bounded by `maxPriceDivergenceCapPct` (0.50%) and the 250 bps signed basis safety cap. This ensures high-yield opportunities (e.g. 120 bps spread with 0.30% divergence generating +69 bps net) are fully captured while guarding against dislocated markets.

## 2. Exchange Margin & Account Health Verification
- **Unified Margin Invariant**: Never evaluate account trading capacity using `totalEquity` alone. On Bybit Unified Accounts, always verify `totalAvailableBalance` and assert `collateralSwitch: true` on margin assets.
- **Micro-Account Liquidation Cushion**: For account balances under $35, enforce an 85% maximum margin utilization and a $0.50 free buffer to prevent liquidation locks while enabling micro-order execution.

## 3. API Endpoint & Order Execution Discipline
- **Binance USD-M Futures**: Always target `https://fapi.binance.com` for live Mainnet futures orders and emergency unwinds. Never send futures keys to Spot (`www.binance.com`) or Testnet endpoints.
- **Fail-Closed Fallback Policy**: Any order routing engine (e.g., Maker-First router) must return `filled: false` if live order placement is not explicitly armed. Mock fills are strictly forbidden in production execution paths.
- **Sequential Zero-Orphan Execution**: Always verify Leg 1 fill before dispatching Leg 2. If Leg 2 fails or rejects, immediately trigger an IOC unwind on Leg 1 to guarantee 0 orphan exposure.

## 4. Autonomous Daemon & Telemetry Operations
- When running 24/7 autonomous loops, utilize background cron daemon schedules (`schedule` tool with `*/30 * * * *`) for 30-minute recurring audits and decouple health reporting into deterministic scripts (`generate_fleet_status_report.js`).
- Preserve log hygiene: Gate background WebSocket reconnection loops behind valid user credentials to prevent auth spam in production server logs.

## 5. Settlement Boundary & Post-Settlement API Freshness Invariants
- **Post-Settlement Quarantine Gate**: Never permit trade entry within the first 90 seconds following any funding settlement tick (HH:00:00 to HH:01:30). Exchange REST endpoints lag by 15-90 seconds in recalculating TWAP rates and updating cached fields (`lastFundingRate`, `fundingRate`); entering within this window risks trading on stale prior-cycle rates whose payments have already settled.
- **Pre-Settlement Freeze Gate**: Freeze candidate entries within 60 seconds prior to funding settlement (`secondsToFunding < 60`). Timing modes (including `CONTINUOUS_SPREAD`) must never bypass this boundary freeze.
- **Cross-Venue Timestamp & Polarity Verification**: In `fetchLiveFundingSpread()` and pre-trade execution, verify that both venues' `nextFundingTime` belong to the upcoming cycle, are synchronized within 60 seconds, and that the live funding spread matches the trade direction polarity before order dispatch.
- **Hard Divergence Safety Ceiling**: Absolute price divergence must never exceed `maxPriceDivergenceCapPct` (0.50%), regardless of whether directional basis is favorable. Favorable basis can reduce the divergence penalty, but large dislocations (> 0.50%) remain unconditionally blocked.

## 6. Basis Persistence & Transient Volatility Invariants
- **30-Minute Low-Watermark Persistence Filter**: Distinguish transient basis spikes from structural market decoupling using a rolling 30-minute observation window. If an active hedge's price divergence remains continuously >= 1.0% without visiting < 1.0% at least once in 30 minutes (min_{30m}(div) >= 1.0%), the mean-reversion assumption is invalidated; trigger an orderly structural exit to eliminate endless carry bleed and capital lockup.
- **Transient Spike Tolerance**: Allow in-flight basis dislocations (0.50% - 1.50%) to mean-revert without triggering premature snapshot stops, provided the rolling low-watermark confirms historical reversion within the 30-minute window.
- **Upstream Sticky Decoupling Gating**: Scanner pipelines must reject any candidate whose price divergence has failed to visit < 1.0% within the prior 30 minutes, preventing entry into structurally broken corridors.

## 7. Fee-Friction Invariant & Dynamic Net-Edge Entry Gating (`FEE-FRICTION-GUARD`)
- **Pre-Flight Net-Edge Hurdle (Invariant 9)**: Never dispatch Leg 1 on any corridor based solely on gross price spread or raw $z$-score. The engine must compute the post-fee net spread upfront:
  $$\text{Net Expected Edge (bps)} = \text{Gross Basis (bps)} - \sum_{i=1}^{4} \text{Fee}_i(\text{bps}) - \text{Slippage Buffer (bps)}$$
  Where standard 4-leg friction is 15.0 bps (Maker 2.0 bps + Taker 5.5 bps roundtrip) plus a minimum 2.0 bps slippage buffer (17.0 bps total hurdle). The entry gate strictly requires:
  $$\text{Net Expected Edge} \ge +12.0\text{ bps} \quad (\text{Gross Basis} \ge 29.0\text{ bps})$$
  Any candidate whose expected gross yield fails to cover total roundtrip fees plus a 12.0 bps net profit margin is unconditionally aborted pre-flight.
- **Zero-Loss Fee Shield Invariant**: Exits are strictly prohibited unless the gross convergence price gain completely covers all actual realized exchange fees from entry plus projected exit taker fees, plus a guaranteed minimum net profit of $\ge +\$0.0100\text{ USDT}$:
  $$\text{Gross Convergence PnL} \ge \text{Realized Entry Fees} + \text{Estimated Exit Fees} + \$0.0100\text{ USDT}$$
- **Prohibition of Hardcoded Adapter Pricing & Notional Distortions**: All simulated and live execution adapters (`SimulatedExchangeAdapter`, `OrderRouter`) must dynamically resolve executed fill prices directly from live orderbook top-of-book depth or counterpart mid-prices (`leg2InitialPrice`). Hardcoding unit prices (e.g. `1.0`) is strictly prohibited, as it distorts fill prices, inflates fee calculations, and creates false floating losses on non-dollar unit coins.

## 8. Pure Real-Exchange Output Invariant (Zero-Formula Telemetry)
- **Prohibition of Mathematical PnL Surrogates**: The engine and reporting telemetry must never calculate, display, or store trade PnL using theoretical formulas (e.g. `(entrySpread - exitSpread) * notional`).
- **Authentic Ledger Reconciliation**: All realized PnL, trading fees, fill prices, and hold durations must be directly sourced from authoritative exchange execution ledgers (`GET /fapi/v1/userTrades` on Binance USD-M and `GET /v5/execution/list` / `GET /v5/position/closed-pnl` on Bybit Linear).
- **Strict Net Realized PnL Formula**:
  $$\text{Real Net PnL} = \sum (\text{Realized PnL}_{\text{Binance}} + \text{Realized PnL}_{\text{Bybit}}) - \sum (\text{Fees}_{\text{Binance}} + \text{Fees}_{\text{Bybit}})$$
- **Zero Fill Exclusion**: Any trade where either leg failed to execute ($Q_{\text{exec}} = 0$) must never be recorded as a completed arbitrage cycle or profitable trade.

## 9. Institutional-Grade Anti-Orphan Self-Healing Protocol
- **Gate 0 (Pre-Flight Zero-Orphan Invariant)**: Before evaluating candidates or dispatching Leg 1, query live positions on BOTH Binance (`/fapi/v2/account`) and Bybit (`/v5/position/list`). If any unhedged contracts exist on either venue, block all new entries immediately.
- **Phase 1.5 Entry Suspension (`ORPHAN_HEALING_ACTIVE`)**: If an orphan leg is detected or Leg 2 fails, new trade entries across the entire engine are unconditionally suspended until the orphan is confirmed 100% flat.
- **Live-Ground-Truth Quantity Sizing**: Never size emergency unwinds using requested or theoretical quantities. Always query the live exchange API for `exactQty = Math.abs(pos.amount)` and dispatch market orders with `reduceOnly: true`.
- **Market Taker Execution for Leg 2**: All Leg 2 counterpart hedge orders must be dispatched as `orderType: 'Market'` with `timeInForce: 'IOC'`. Never submit fixed-price limit orders that risk `EC_NoImmediateQtyToFill`.
- **Immediate Pre-Emptive Market Unwind**: If Leg 2 fails for any reason, the router must immediately fire an emergency market order with `reduceOnly: true` on Leg 1 within 40ms, retrying up to 3 times to guarantee 0 orphan exposure.
- **60-Minute Symbol Quarantine**: Any instrument suffering a Leg 2 execution rejection is blacklisted from scanning and trading for 60 minutes across all scanning gates.
- **Continuous Anti-Orphan Sentinel**: The background sweeper verifies cross-exchange delta neutrality ($|\Delta_{\text{net}}| < 0.001$) every cycle. Any unhedged exposure triggers immediate self-healing remediation.

## 10. Dedicated Quota & Route Isolation Invariant
- **Single-Engine Quota Allocation**: Redundant polling services (legacy multi-tenant daemons, `/terminal`, `/basis-bot`, and `/history` background pollers) must be permanently decommissioned to guarantee 100% of exchange REST and WebSocket rate limits are reserved for `STATARB-OU-PERP`.
- **Zero Unauthenticated Polling**: No background loop may query exchange endpoints without confirmed, validated credentials.

## 11. Institutional Logging & Autonomous Error Wakeup / Triage Engine
- **Convergence Audit Stream (`appendStatArbLog`)**: Every lifecycle transition, order dispatch, fill, rejection, unwind, and ledger settlement must be emitted with standardized severity tags (`info`, `success`, `warn`, `error`).
- **60-Second In-Memory Deduplication**: Repetitive scanning and tick messages must be aggregated in-place with count badge `[N]` within 60 seconds to prevent log flooding.
- **Permanent Ledger & Incident Storage**: Persist audit logs to `statarb_audit_log.json` and permanent trade events to `trade_audit_permanent.jsonl`.
- **Autonomous Error Wakeup Trigger**: Any log entry with `level: 'error'` immediately registers an active incident ticket and triggers an instant AI agent wakeup call.
- **Zero-Touch Autonomous Triage & Auto-Proceed**: The agent immediately conducts an in-depth forensic investigation of live exchange positions, orders, and balances. If urgent remediation is required (e.g. unhedged orphan, rejection loop, margin deficiency), the agent autonomously plans, executes the fix (e.g. `reduceOnly` market unwind, 60m quarantine, rate limit backoff), verifies 0.000 exposure, and logs the post-mortem without requiring human intervention.
