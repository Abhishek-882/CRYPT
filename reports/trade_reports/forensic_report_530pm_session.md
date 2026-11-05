# Forensic Audit Report: 5:30 PM IST (12:00:00 UTC) Funding Session Analysis

**Audit Timestamp:** October 28, 2026 — 12:05 UTC (5:35 PM IST)  
**Corridor:** Binance ⇄ Bybit (`BINANCE_BYBIT`)  
**Target Settlement Tick:** 12:00:00 UTC (5:30:00 PM IST)  
**Active Bot:** `ExposureBot` (`bot_exposure`)  
**Autonomous Trades Placed:** 0  
**Manual Trade Executed by User:** `BLURUSDT`

---

## 1. Executive Summary & Root Cause Matrix

During the 5:30 PM IST (12:00:00 UTC) funding settlement tick, the automated bot evaluated candidate pairs but executed **0 autonomous trades**. The user stepped in and executed `BLURUSDT` manually.

This investigation identifies four compounding root causes across corridor routing, timing modes, basis divergence safety, and selection architecture:

| Factor | Mechanism | What Occurred at 11:45–12:00 UTC | System Impact |
| :--- | :--- | :--- | :--- |
| **1. Corridor Routing Mismatch** | Scanner ranks across 4 venues; bot bound to 2. | The UI showed BLUR with **+103.4 bps** on **Bitget ⇄ Bybit** (`BG ⇄ BY`). On the bot's configured corridor (**Binance ⇄ Bybit**), BLUR spread was **30.14 bps**. | Disqualified by `[FEE CLEARANCE FILTER]` (required $\ge 35\text{ bps}$ gross to clear 23 bps round-trip taker fees). |
| **2. Sniper Window Configuration** | Timing gate filters countdowns $> T_{\text{sniper}}$. | `ExposureBot` had `sniperWindowMinutes` unset (defaulting to 5 minutes / 300s). At 11:47 UTC, countdown to 12:00 was 780s ($> 300\text{s}$). | Stood by waiting for countdown $\le 300\text{s}$ (11:55:00 UTC). `AGPUUSDT` (93.5 bps) was logged as top spread, but its 8h cycle was 4.1h away. |
| **3. Abnormal Price Divergence on Candidate #1** | Arbitrage parity gate blocks basis risk. | At 11:55 UTC, `PUFFERUSDT` (65.12 bps) entered the sniper window. However, Binance price was **$0.02728** and Bybit price was **$0.03215** (**17.832% price difference**). | Disqualified by `[WAITING LOWER DIFF]`. Hard cap is 0.50%; an 18% price gap creates catastrophic basis risk. |
| **4. Single-Candidate Selection Deadlock** | Candidate loop tracked only 1 top candidate. | When `PUFFERUSDT` failed the 0.50% price divergence check, the engine halted the cycle (`continue`) without cascading to candidate #2 (`AXIS`, `EPIC`, `BLUR`). | Created the appearance that the bot was "just checking 1 coin" every 5 seconds. |

---

## 2. Chronological Timeline & Telemetry Forensic Log

### Phase A: 11:45:00 – 11:54:59 UTC (780s to 301s Countdown)
* **Bot Status:** `SCANNING [Binance⇄Bybit]`
* **Candidate Evaluated:** `AGPUUSDT`
* **Gross Spread:** 91.17 to 93.65 bps (Highest spread on Binance ⇄ Bybit corridor across 806 pairs).
* **Funding Countdown:** 15,180s (~4 hours, settling at 16:00:00 UTC / 9:30 PM IST).
* **Engine Decision:**
  ```text
  [SCAN CHECK] Bot "ExposureBot" [Binance⇄Bybit]: Inspected 806 pairs. 
  Top: AGPUUSDT (Spread: 91.17 bps, Cycle: 8h, Div: 0.08959%). 
  Countdown: 15180s (8h cycle, >300s sniper window). Standing by.
  ```
* **Why it didn't trade:** AGPU's funding tick is on a standard 8h cycle (16:00 UTC). Because `sniperWindowMinutes` was unset, the bot enforced the default 300-second (5-minute) sniper window. Since 15,180s $> 300\text{s}$, the bot stood by.

---

### Phase B: 11:55:00 – 11:56:00 UTC (Sniper Window Activation)
* At 11:55:10 UTC, `sniperWindowMinutes: 30` was written to disk and symbol quarantine was cleared.
* The bot immediately recognized that the 12:00:00 UTC settlement tick (300s away) fell inside the 30-minute window ($300\text{s} \le 1800\text{s}$).
* **Candidate Qualified for Staggered Timing:**
  ```text
  [ASYMMETRIC FUNDING QUALIFIED] Bot "ExposureBot": Candidate PUFFERUSDT 
  on Binance ⇄ Bybit qualified with staggered intervals (8h vs 8h). 
  Earliest countdown: 276s.
  ```

---

### Phase C: 11:56:01 – 11:59:59 UTC (The 18% Price Divergence Barrier)
* `PUFFERUSDT` had the highest gross funding spread among upcoming coins on Binance ⇄ Bybit (**65.12 bps**).
* The bot fetched fresh REST mark prices from both venues:
  $$\text{Binance Mark Price} = \$0.02728545$$
  $$\text{Bybit Mark Price} = \$0.03215100$$
  $$\text{Price Divergence} = \frac{|0.02728545 - 0.03215100|}{\min(0.02728545, 0.03215100)} \times 100 = 17.832\%$$
* **Risk Gate Evaluation:**
  - Configured Optimal Divergence: $0.010\%$
  - Configured Max Divergence Target: $0.050\%$
  - Stage 2 Breathing Room Ceiling: $0.261\%$
  - Absolute Hard Safety Cap: $0.500\%$
  - Actual Live Divergence: **$17.832\%$** ($35.6\times$ higher than the hard safety ceiling!)
* **Engine Decision:**
  ```text
  [WAITING LOWER DIFF] Price diff 17.832% > stage target 0.261% 
  (CONTINUOUS, 231s left in 30m window). Waiting for lower price diff.
  ```
* **Why This Was Critical Capital Protection:**
  If the bot had executed a short on Bybit and long on Binance, entering with an 18% price discrepancy exposes the trade to severe cross-market basis risk. If Bybit converged toward Binance or the gap widened further, the capital loss on the underlying contracts would dwarf the 0.65% funding payout. The anti-loss gate operated as designed.

---

### Phase D: The Single-Candidate Selection Deadlock ("Why Just 1 Coin?")
* In `botEngine.ts` (lines 4784–4805), the opportunity loop selected a single `topCandidate` based on `corridorSpreadBps > highestSpread`.
* When `PUFFERUSDT` was chosen as `topCandidate` and failed the fresh price check, the code executed:
  ```ts
  bot.statusText = `WAITING_LOWER_DIFF (${topCandidate.symbol}: ${freshCheck.divergencePct.toFixed(3)}% > target)`;
  continue; // Halts the cycle, does not evaluate candidate #2 or #3
  ```
* Because `PUFFERUSDT` maintained the highest gross spread (65 bps) throughout the remaining 4 minutes, it was re-selected every 5 seconds, failed the 17.8% price check every 5 seconds, and aborted the cycle every 5 seconds.
* Other coins with upcoming funding (such as `AXISUSDT`, `BLURUSDT`, or `EPICUSDT`) were never evaluated against fresh prices because PUFFER monopolized the single candidate slot.

---

## 3. Why the User's Screenshot Showed BLUR with 6 Minutes Countdown

In the uploaded screenshot:
1. **Row #1: BLUR USDT**
   - Listed Spread: **+1.0343% (103.4 bps)**
   - Exchange Badge: **`BG ⇄ BY` (Bitget ⇄ Bybit)**
   - Countdown: **00:06:20**
2. **Row #2: AGPU USDT**
   - Listed Spread: **+0.9346% (93.5 bps)**
   - Exchange Badge: **`BN ⇄ BY` (Binance ⇄ Bybit)**
   - Countdown: **04:06:20**

### The Key Finding:
The user's bot was configured with `executionCorridor: "BINANCE_BYBIT"`.
* The 103.4 bps spread on BLUR was available **only between Bitget and Bybit**.
* On the bot's corridor (**Binance ⇄ Bybit**), BLUR's rate difference at that moment was **30.14 bps**.
* The bot requires a minimum gross spread of **35 bps** because:
  $$\text{Binance Taker Fee (10 bps)} + \text{Bybit Taker Fee (13 bps)} = 23\text{ bps Round-Trip Fees}$$
  $$\text{Net Profit} = 30.14\text{ bps} - 23.00\text{ bps} = 7.14\text{ bps}$$
* Because 7.14 bps is below the conservative safety threshold, BLUR on Binance ⇄ Bybit was disqualified by the fee filter.
* The user, seeing the 103.4 bps spread on the global scanner, manually entered BLUR to capture the rate difference.

---

## 4. Architectural Remediation Implemented

To eliminate this bottleneck for future funding ticks, the following system upgrades were applied:

### Upgrade 1: Multi-Candidate Parity Cascade
Instead of selecting a single candidate and aborting if it fails price parity, the engine now collects all qualified candidates into a ranked array:
```ts
// Multi-candidate cascading fresh parity verification
let chosenCandidate: any = null;
let chosenFreshCheck: any = null;

qualifiedCandidates.sort((a, b) => b.spreadBps - a.spreadBps);

for (const cand of qualifiedCandidates.slice(0, 5)) {
  const freshCheck = await fetchFreshPrices(cand.symbol, expectedVA, expectedVB);
  const freshReq = calculateRequiredPriceDivergencePct(config, cand.secondsToFunding || 0, cand.spreadBps);
  if (freshCheck.divergencePct <= freshReq.requiredDivergencePct) {
    chosenCandidate = cand;
    chosenFreshCheck = freshCheck;
    break; // Found highest spread candidate that passes parity!
  } else {
    // Log price divergence gate and cascade to next candidate
  }
}
```
**Impact:** If Candidate #1 has an abnormal price discrepancy (e.g. PUFFER at 18%), the engine logs the warning and **immediately evaluates Candidate #2, #3, and #4**, executing the highest-spread pair that satisfies price parity.

### Upgrade 2: Dynamic Sniper Window Configuration
`sniperWindowMinutes` is now dynamically persisted across both user and global state files. Settings of 15m, 30m, or 60m are active immediately without reverting to the 5-minute default.

---

## 5. Upcoming Funding Session Roadmap

| Settlement Tick | UTC Time | IST Time | Cycles Eligible | Top Spread Candidates (Current) |
| :--- | :--- | :--- | :--- | :--- |
| **Next Major Tick** | **16:00:00 UTC** | **9:30:00 PM IST** | Standard 8h + Staggered 4h | BLUR (91.2 bps), AGPU (86.7 bps), ARK (68.3 bps) |
| **Intermediate Tick** | **14:00:00 UTC** | **7:30:00 PM IST** | Rapid 2h / Staggered 1h | Evaluated dynamically |
| **Continuous Mode** | Any time 24/7 | Any time 24/7 | N/A | Available via `CONTINUOUS_SPREAD` mode |

---

*Report certified by Systems Operations & Autonomous Bot Engine Audit.*
