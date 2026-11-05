# Trade Execution Optimization, Blocker Audit & 5-Minute Log Aggregation Plan

## 1. Executive Summary & Forensic Findings

### A. Why 0 Trades Were Placed for the Recent 1:30 PM Funding Rate
* **Local Timestamp:** In India Standard Time (IST, UTC+5:30), 1:30 PM IST corresponds to **08:00:00 UTC** — the primary 8-hour crypto funding settlement tick (00:00, 08:00, 16:00 UTC).
* **Forensic Reconstruction:**
  1. **T - 12m (07:47:44 UTC):** `ExposureBot` evaluated candidate coins. The countdown was **741 seconds** until the 08:00 UTC settlement tick. Because the bot is configured with `FUNDING_SNIPER_5M` (300-second window), candidate entries were deferred until the 5-minute pre-settlement window ($T \le 300\text{s}$, opening at 07:55:00 UTC).
  2. **T - 5m to T + 6m (07:55:00 to 08:06:00 UTC):** During this exact 11-minute window, the user requested fast fixes for audit warning floods and socket hangup errors. Next.js was compiled (`next build`), test suites executed, and Windows services (`AiHedgeCockpit` and `AiHedgeDaemon`) restarted at 08:06:00 UTC. The bot loop was therefore not executing new trade entries during the final 300-second sniper countdown.
  3. **T + 7m (08:07:41 UTC):** Immediately upon service restoration, the bot scanned live market opportunities. `DOODUSDT` passed all 12 criteria (Spread: 103.81 bps, Cycle: 4h, Div: 0.4904%) and was executed on Binance and Bybit ($60 notional, 28,348 units).
  4. **Individual Disqualifications at 08:00 UTC:**
     - `PUFFERUSDT`: Gross spread was high (87.38 bps), but exchange price difference was **19.522%** — far exceeding the 0.50% ceiling. Entering would have caused massive basis slippage.
     - `ANKR`, `SKL`, `COTI`, `1000XEC`: Rejected by `[FUNDING SYNC LOCK]` because they had asymmetric funding intervals (4h vs 8h) while the bot was in `STRICT_SYNC_ONLY` mode.
     - 400+ other pairs: Rejected by `[FEE CLEARANCE FILTER]` because gross spread was below the 35 bps threshold or failed to clear 23 bps roundtrip taker fees.

---

### B. Why Terminal Response for Trade Execution & Closing Was Slow
1. **Bitget 5,000ms Timeout Stall in `/api/close`:**
   - In `close/route.ts`, when closing positions (`corridor: "ALL"` or untargeted), `Promise.all` queried Binance, Bitget, CoinDCX, and Bybit concurrently.
   - The Bitget API endpoint (`https://api.bitget.com`) intermittently hung from the server and timed out after **5,000ms** (`bitgetHttpFetch` default timeout). Because `Promise.all` must wait for the slowest promise, the user waited 5+ seconds even for Binance/Bybit trades!
2. **Unauthenticated Trade WebSocket Retries on Bybit:**
   - In `bybitTradeStream.ts`, when private WebSocket authentication failed (`data.retCode !== 0`), `this.status` was mistakenly marked `"HEALTHY"`.
   - Every trade dispatch attempted the unauthenticated WebSocket, waited, received `"Permission denied for current apikey"`, and only then fell back to REST API, adding hundreds of milliseconds.
3. **Bybit & Binance Clock Skew & Retries:**
   - Windows server time experienced up to 9.8-second skew against Bybit and Binance servers under event loop pressure.
   - Bybit's `recv_window` was hardcoded to `5,000ms`, causing Bybit to reject requests with `invalid request, please check your server timestamp or recv_window param: req_timestamp[...],server_timestamp[...]`.
   - Binance triggered time sync retries (Code -1021).
4. **Synchronous Disk I/O Bottleneck:**
   - Disk writes in `appendBotLog` and `saveBotState` blocked the Node.js single-threaded event loop during burst scans.

---

### C. Manual Errors Encountered by User
1. **Bybit Timestamp Error:** `recv_window[5000]` rejected manual orders due to clock skew.
2. **Bybit WebSocket Permission Error:** User's Bybit API key lacks Trade WebSocket permissions; system must fast-route directly to REST API.
3. **Mainnet Safety Armed Check:** In `/api/hedge`, manual mainnet execution requires `x-mainnet-armed: true` or `body.isArmed: true`.
4. **Bitget Network Timeouts:** Demo/isolated Bitget network timeouts stalled composite requests.

---

## 2. Complete Report: Everything That Blocks a Trade (The 12 Safeguards)

| # | Safeguard Gate | Condition for Block | Purpose & Why It Exists |
|---|----------------|-------------------|--------------------------|
| **1** | **Sniper Timing Window** | `secondsToFunding > 300s` (5m) or `> 60s` (1m) | Prevents holding directional risk for hours; only enters right before funding capture. |
| **2** | **Funding Synchronization Lock** | Venue A interval $\ne$ Venue B interval (e.g. 4h vs 8h) in `STRICT_SYNC_ONLY` | Prevents getting paid once on Leg 1 while paying twice on Leg 2. |
| **3** | **Fee Clearance Filter** | Gross spread $< 35\text{ bps}$ OR net spread $< 23\text{ bps}$ taker fee | Guarantees the trade covers roundtrip taker fees on both exchanges before entering. |
| **4** | **Price Parity Divergence Gate** | Price difference $> \text{requiredDivergencePct}$ (ceiling 0.05% to 0.50%) | Protects against buying high on one exchange and selling low on another (basis risk). |
| **5** | **Pre-Settlement Freeze** | `secondsToFunding < 8s` | Blocks entry in final 8 seconds to prevent entering while exchanges update funding indices. |
| **6** | **Wallet Buffer & Utilization** | Free margin $< \$0.50$ OR Margin utilization $> 85\%$ ($> 50\%$ standard) | Prevents margin calls and protects liquidation cushion. |
| **7** | **Capacity & Margin Ceiling** | Active hedges $\ge 3$ OR Total margin $\ge \$500$ | Prevents over-concentration in multiple positions. |
| **8** | **Anti-Churn Quarantine** | Symbol was traded within last 60 minutes | Prevents rapid re-entry churn (e.g. 92 trades on ANIMEUSDT) from bleeding fees. |
| **9** | **Zero-Orphan Review Pause** | Coin is in `flattenedCoinsBlacklist` (order rejected/failed) | Halts trading on coins with exchange contract issues until manual unlock. |
| **10** | **Exchange Contract/Agreement** | Bybit "must sign agreement" or invalid contract | Prevents submitting orders on pairs where user account has not accepted terms. |
| **11** | **System Clock / RecvWindow** | Clock skew $> \text{recv\_window}$ ($5\text{s}$) | Exchanges reject timestamp as expired or in the future. |
| **12** | **Statutory DPDP Consent** | `PURPOSE_EXCHANGE_DISPATCH` missing or revoked | Compliance requirement: autonomous dispatch requires explicit consent. |

---

## 3. Mathematical Example: How Every Hedge Generates Profit

### Example: Live `DOODUSDT` Trade Executed by Bot
* **Corridor:** Short Binance / Long Bybit
* **Notional Capital:** $\$60.00$ USDT ($28,348$ contracts at $\$0.0021165$)
* **Leverage:** $20\times$ (Required Margin: $\$3.00$ USDT on Binance, $\$3.00$ USDT on Bybit)

$$\text{Gross Spread} = \text{Bybit Price} - \text{Binance Price} = 103.81\text{ bps} \ (1.038\%)$$

### Fee & PnL Breakdown
1. **Roundtrip Taker Fees:**
   - Binance Taker Fee: $0.05\% \times \$60.00 = \$0.0300$ entry $+\$0.0299$ exit $= \$0.0599$
   - Bybit Taker Fee: $0.055\% \times \$60.00 = \$0.0330$ entry $+\$0.0391$ exit $= \$0.0721$
   - **Total Roundtrip Fees:** $\$0.1381$ USDT ($23.0\text{ bps}$)
2. **Gross Spread Capture upon Convergence:**
   - Entry Price Difference: Binance $\$0.0021125$, Bybit $\$0.0021210$
   - Exit Price Difference: Binance $\$0.0021059$, Bybit $\$0.0021199$
   - **Spread Gain Captured:** $+\$0.1554$ USDT ($25.9\text{ bps}$)
3. **Funding Rate Yield:**
   - Short Binance receives funding, Long Bybit pays lower/neutral rate: $+\$0.0000$ to $+\$0.0600$
4. **Net Realized Profit:**
   $$\text{Net Profit} = \text{Spread Gain} + \text{Funding Harvest} - \text{Total Fees}$$
   $$\text{Net Profit} = +\$0.1554 + \$0.0000 - \$0.1381 = \mathbf{+\$0.0173\text{ USDT}} \ (+0.29\%\text{ on margin})$$

### The Pure Convergence Hold Invariant ($\le 0.03\%$)
* Because **Broker-Side Stop Loss is Strictly Banned**, market price swings do NOT liquidate or stop out the hedge (the short and long legs balance each other delta-neutral).
* The bot holds until price parity converges within $\le 0.03\%$, guaranteeing the gross spread is realized without directional loss.

---

## 4. Implementation Plan: User Requirements

### Phase 1: 5-Minute Deduplication Counter Beside Messages
* **User Directive:** *"just make not repeat same message in 5 minuets - just write the number beside the message the number [10 mean 10 times]"*
* **Implementation:**
  1. In `web/lib/botEngine.ts`: In `appendBotLog`, strip trailing `\s*\[\d+\]` to obtain `baseMessage`.
  2. Search recent logs within a 5-minute rolling window (`Date.now() - logTime < 300,000ms`).
  3. If identical `baseMessage` and `level` exists:
     - Increment counter: `count = (existing.count || 1) + 1`.
     - Update message in-place: `${baseMessage} [${count}]`.
     - Update timestamp to current time.
     - Propagate update to `targetBot.logs` and `auditHistory`.
  4. If older than 5 minutes or new message:
     - Insert new entry with `count = 1`.
  5. Refine `shouldLogScannerWarning` to remove the 10-minute complete silence so that messages flow into the 5-minute aggregator and display the accurate repetition count `[N]`.

### Phase 2: Terminal Execution & Close Latency Elimination
1. **Bybit Server Clock Skew Calibration & RecvWindow:**
   - In `web/lib/bybitSigner.ts`, increase `RECV_WINDOW` from $5,000\text{ms}$ to $20,000\text{ms}$.
   - Add `syncBybitClock()` to compute server offset against `https://api.bybit.com/v5/market/time` and apply `(Date.now() + bybitServerTimeOffset)`.
2. **Fast-Route Bybit REST API when WebSocket Auth Fails:**
   - In `web/lib/bybitTradeStream.ts`, if `data.op === "auth"` fails (`retCode !== 0`), set `status = "AUTH_FAILED"`.
   - Prevent `placeBybitOrder` from attempting WebSocket and tripping watchdog timeout; route directly to REST in $<150\text{ms}$.
3. **Isolate Bitget Queries in `/api/close`:**
   - In `web/app/api/close/route.ts`, if corridor does not contain `"BITGET"` or mode is `"mainnet"`, skip Bitget immediately with $0\text{ms}$ latency.
   - Enforce strict $1,500\text{ms}$ timeout on Bitget calls to prevent 5-second hangs.

### Phase 3: Verification & Build
1. Build Next.js application (`next build`).
2. Run test suites (`test_architectural_anti_loss_safeguards.js` and `test_round2_adversarial_safeguards.js`) ensuring 100% pass rate.
3. Restart Windows Services (`AiHedgeCockpit` and `AiHedgeDaemon`).
4. Verify audit stream and terminal response latency.
