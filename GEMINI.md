# AI Hedge Cockpit Engineering Invariants & Safety Protocols

## 1. Multi-Venue Instrument Filtering
- **Pre-Flight Non-Crypto Filtering**: When scanning Bybit linear perpetuals, always query `/v5/market/instruments-info?category=linear` and exclude any instrument where `symbolType && symbolType !== "innovation"` (e.g. `stock`, `ETF`, `commodity`, `forex`).
- **Upstream TradFi Stock Filtration**: In all opportunity ingestion pipelines (`fetchOpportunityCoins()`, `route.ts`), filter out TradFi equities, commodities, and ETFs upfront before candidate scoring and corridor pairing. Never permit stock contracts (e.g. `CATUSDT` Caterpillar Inc. stock at $582) to enter candidate pools or masquerade as crypto meme coins (`1000CATUSDT`).
- **Dynamic Candidate Tracking & Non-Latching Fallback**: Scanner fallback candidate tracking must continually evaluate and update to the true highest spread candidate on the active corridor. Never latch onto or display 0-bps pairs when higher spread opportunities exist.
- **Accurate Diagnostic Telemetry**: Scanner fallback status messages must dynamically reflect the user's active configured thresholds (`maxPriceDivergencePct`, `optimalPriceDivergencePct`, `minSpreadBps`). Never emit hardcoded or generic rejection messages (such as `[PRICE DIFF GATE] Price diff > stage target`) without verifying the true underlying rejection reason and active config values.
- **Web-Agreement Gating**: Never dispatch Leg 1 on any venue until verifying that both venues support immediate programmatic execution without pending user agreements or regional restrictions.
- **Contract Parity & Scale Normalization**: Assert decimal multiplier alignment (e.g. `CATUSDT` vs `1000CATUSDT`). Exceeding the 250 bps signed basis safety cap must always trigger an immediate pre-trade abort.

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
