# Implementation Plan: Multi-Bot Isolation, Setfile Persistence & 25 bps Fee Hurdle

## 1. Problem & Forensic Diagnosis Summary

1. **What happened to the coin (`BLURUSDT`)?**
   * **Orders:** Binance `#6400879863` & Bybit `#24e018b0-bbc5-4e0d-b5b3-83956b154417`
   * **Opened at Divergence:** **$\mathbf{0.03771\%}$ (3.77 bps)** — exceptionally tight price parity!
   * **Current Status:** **`ACTIVE`** (It is open, live, and running right now in `ExposureBot` awaiting funding settlement).
2. **Why did pausing a bot make the whole system look paused?**
   * In `AutoBotPanel.tsx`, the Hero card state was bound to `isBotActive = isMasterRunning && activeBot.enabled`.
   * When `activeBot` was paused, the entire Cockpit turned amber, and `route.ts` set the daemon status text to `"PAUSED_BY_USER"`, giving the false impression that all bots and the 24/7 engine were halted.
3. **Why did settings revert / setfile not stay saved?**
   * `saveSetFiles()` filtered out presets marked `isBuiltIn: true`, causing user adjustments to built-in presets to be dropped.
   * State was stored in two disconnected locations (`root` vs `data/users/<userId>`), causing settings to desynchronize when the site reloaded.

---

## 2. Step-by-Step Implementation Plan

### Step 1: Independent Multi-Bot Fleet Isolation
* **`route.ts` & `botEngine.ts`:**
  - Update `route.ts` GET response status text:
    ```typescript
    const enabledBotsCount = state.bots.filter(b => b.enabled).length;
    statusText: state.isRunning
      ? `${enabledBotsCount} of ${state.bots.length} Bots Active`
      : "STOPPED"
    ```
  - Ensure `toggle_bot` explicitly alters only the target bot without modifying the master daemon or any other bot.
* **`AutoBotPanel.tsx` UI Decoupling:**
  - The Hero Banner will show the **Global Fleet Status** (`Active Bots: N/M | Daemon: 24/7 RUNNING`).
  - Each bot card in the roster will feature its own dedicated `[START]` / `[PAUSE]` button with independent visual state.
  - Pausing Bot 1 will **NEVER** turn the Hero card amber or pause Bot 2.

### Step 2: Robust Setfile & Settings Persistence
* **`botEngine.ts`:**
  - Remove the `isBuiltIn` exclusion filter in `saveSetFiles()` so that user tweaks to presets are permanently saved.
  - When `editBot()` or `applySetFileToBot()` is called, immediately write the updated configuration to:
    1. Root `bot_daemon_state.json`
    2. Tenant `data/users/<userId>/bot_daemon_state.json`
    3. The active `.set` file
  - Ensure `loadBotState()` merges and preserves user-configured fields (`timingMode`, `roundTripFeeBps`, `minSpreadBps`, `maxPriceDivergencePct`) across server rebuilds and site updates.

### Step 3: Configurable Round-Trip Taker Fee (Default: 25 bps)
* Add `roundTripFeeBps` (default `25.0`) to `BotConfig` and `spreadCalculation.ts`.
* Expose an editable numeric input in the Bot Configuration Modal so the user can freely tune this hurdle.
* Update net spread formula:
  $$\text{netSpreadBps} = \text{grossSpreadBps} - \text{roundTripFeeBps}$$

### Step 4: Zero-Loss Trade Logging & 8-Hour Candidate Pruning
* Add `trade_audit_permanent.jsonl` to record 100% of order fills, cashflows, and exits permanently without circular truncation.
* Prune candidate scanner noise for untraded coins every 8 hours, while permanently retaining all logs for coins that executed trades.

---

## 3. Verification Protocol
1. **Compilation:** Run `npm run build` in `web/` to guarantee zero TypeScript or React errors.
2. **Multi-Bot Toggle Test:** Start Bot 1 and Pause Bot 2; verify in the API and logs that Bot 1 continues executing while Bot 2 is idle.
3. **Setfile Persistence Test:** Edit `timingMode` to `CONTINUOUS_SPREAD` and `roundTripFeeBps` to `25`, trigger a reload, and verify that the settings remain 100% intact.
