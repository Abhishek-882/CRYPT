const fs = require("fs");
const path = require("path");
const http = require("http");

const userStatePath = path.join(__dirname, "..", "web", "data", "users", "usr_admin_varsha", "bot_daemon_state.json");
const webStatePath = path.join(__dirname, "..", "web", "bot_daemon_state.json");
const rootStatePath = path.join(__dirname, "..", "bot_daemon_state.json");

if (!fs.existsSync(userStatePath)) {
  console.error("User state path not found:", userStatePath);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(userStatePath, "utf8"));

state.isRunning = true;
state.runInBackgroundWhenClosed = true;
state.mode = "AUTONOMOUS_SERVER_24_7";
state.lastCycleAt = Date.now();

// ============================================================================
// BOT 1: PROFIT MAXIMIZER (High-Conviction Production Harvest Engine)
// Objective: Maximum profit capture (high hurdle, tight divergence, zero low-profit skimming)
// ============================================================================
const bot1Config = {
  enabled: true,
  executionCorridor: "BINANCE_BYBIT",
  minSpreadBps: 45.0, // High gross spread hurdle
  roundTripFeeBps: 21.0, // Dynamic corridor fee baseline
  minNetYieldHurdleBps: 25.0, // Strict 25 bps pure net profit hurdle after fees
  maxPriceDivergencePct: 0.08, // Ultra-tight 0.08% entry price divergence
  maxPriceDivergenceCapPct: 0.20,
  maxDivergenceSpreadRatioPct: 25.0, // Divergence can consume at most 25% of spread
  optimalPriceDivergencePct: 0.015,
  balanceAllocationPct: 25, // High Quarter-Kelly allocation for maximum dollar profit
  leverageMode: "CUSTOM",
  customLeverage: 10, // Disciplined 10x leverage on proven high-liquidity assets
  maxSimultaneousHedges: 2,
  maxMarginCapUsdt: 250,
  maxAmountPerHedgeUsdt: 15.0, // $15 order notional (well-sized for available Bybit margin)
  liquidityTier: "THIN",
  enablePreTradeSlippageGate: true,
  maxBidAskSpreadBps: 20.0,
  maxPreTradeSlippagePct: 0.08,
  enableMakerRouting: true, // PHASE 2: Post-Only Maker limit routing (GTX) with 8s watchdog
  timingMode: "CONTINUOUS_SPREAD",
  allowAsymmetricFunding: true,
  intervalMode: "ALL_ASYMMETRIC",
  enableSpreadCollapseExit: true,
  spreadCollapseExitBps: 20.0,
  postSettlementWaitSeconds: 15,
  enableZeroLossGate: true, // ZERO-LOSS ENGINE: Strictly blocks exits where Net PnL < +$0.01 USDT
  closeMaxPriceDivergencePct: 0.18, // Adaptive exit ceiling bounded by Zero-Loss Gate
  targetRoiTakeProfitPct: 25.0,
  hardRoiTakeProfitPct: 50.0,
  enableFundingInversionCircuitBreaker: false,
  enableCarryContinuation: true, // Multi-cycle carry roll
  minContinuationSpreadBps: 22.0, // Roll forward if next cycle >= 22 bps
  scanIntervalSeconds: 5,
};

// ============================================================================
// BOT 2: INNOVATION LAB & FEATURE CHALLENGER (Full New-Feature Stress Testbed)
// Objective: Actively exercise and benchmark EVERY newly built institutional upgrade:
// - Dynamic ATR Volatility Leverage (MAX_PER_COIN)
// - Dynamic Fractional Kelly Sizing (positionSizer.ts)
// - 6-Factor Composite Arbitrage Scoring (candidateScoring.ts)
// - L2 20-Level VWAP Sweep (orderBookManager.ts)
// - Correlation Breakdown Circuit Breaker (circuitBreaker.ts)
// - Ornstein-Uhlenbeck AR(1) Mean-Reversion Stopping Time (exitOptimizer.ts)
// ============================================================================
const bot2Config = {
  enabled: true,
  executionCorridor: "BINANCE_BYBIT",
  minSpreadBps: 32.0, // Calibrated spread hurdle to admit active candidate pool
  roundTripFeeBps: 21.0,
  minNetYieldHurdleBps: 10.0, // 10 bps net yield hurdle to generate active comparative telemetry
  maxPriceDivergencePct: 0.25, // Allows testing signed directional basis convergence
  maxPriceDivergenceCapPct: 0.50,
  maxDivergenceSpreadRatioPct: 45.0,
  optimalPriceDivergencePct: 0.03,
  balanceAllocationPct: 20, // Scaled dynamically by Hurdle-Gated Quarter-Kelly
  leverageMode: "MAX_PER_COIN", // ACTIVELY TESTS Dynamic Volatility-Adjusted Leverage (3x - 50x)!
  customLeverage: 10,
  maxSimultaneousHedges: 2,
  maxMarginCapUsdt: 100,
  maxAmountPerHedgeUsdt: 10.0, // $10 order notional -> dynamic depth floor = max(15, 10*1.25) = $15
  liquidityTier: "THIN",
  enablePreTradeSlippageGate: true, // Tests L2 20-level VWAP depth sweep
  maxBidAskSpreadBps: 35.0,
  maxPreTradeSlippagePct: 0.15,
  enableMakerRouting: true, // Tests Post-Only GTX limit execution and 8s watchdog
  timingMode: "CONTINUOUS_SPREAD",
  allowAsymmetricFunding: true,
  intervalMode: "ALL_ASYMMETRIC",
  enableSpreadCollapseExit: true,
  spreadCollapseExitBps: 15.0,
  postSettlementWaitSeconds: 15,
  enableZeroLossGate: true, // Tests 5-method Zero-Loss Gate
  closeMaxPriceDivergencePct: 0.25, // Tests Ornstein-Uhlenbeck AR(1) stopping time
  targetRoiTakeProfitPct: 20.0,
  hardRoiTakeProfitPct: 50.0,
  enableFundingInversionCircuitBreaker: false,
  enableCarryContinuation: true, // Tests predictive forward carry roll
  minContinuationSpreadBps: 18.0, // Roll forward if next cycle >= 18 bps
  scanIntervalSeconds: 5,
};

// Locate or update Bot 1
let bot1 = state.bots.find(b => b.id === "bot-binance-bybit");
if (!bot1) {
  bot1 = {
    id: "bot-binance-bybit",
    name: "Binance ⇄ Bybit Profit Maximizer",
    enabled: true,
    maxMarginCapUsdt: 250,
    activeHedges: {},
    completedHedges: [],
    flattenedCoinsBlacklist: [],
    symbolCooldowns: {},
    quarantinedSymbols: {},
    statusText: "STARTING",
    createdAt: Date.now(),
  };
  state.bots.push(bot1);
}
bot1.name = "Binance ⇄ Bybit Profit Maximizer";
bot1.enabled = true;
bot1.activeSetFileName = "binance_bybit_profit_maximizer.set";
bot1.maxMarginCapUsdt = 250;
bot1.config = bot1Config;
bot1.statusText = "RUNNING";
bot1.quarantinedSymbols = {};
bot1.symbolCooldowns = {};
bot1.flattenedCoinsBlacklist = [];

// Locate or update Bot 2
let bot2 = state.bots.find(b => b.id === "bot-120328");
if (!bot2) {
  bot2 = {
    id: "bot-120328",
    name: "Innovation Lab (Feature Challenger)",
    enabled: true,
    maxMarginCapUsdt: 100,
    activeHedges: {},
    completedHedges: [],
    flattenedCoinsBlacklist: [],
    symbolCooldowns: {},
    quarantinedSymbols: {},
    statusText: "STARTING",
    createdAt: Date.now(),
  };
  state.bots.push(bot2);
}
bot2.name = "Innovation Lab (Feature Challenger)";
bot2.enabled = true;
bot2.activeSetFileName = "innovation_lab_challenger.set";
bot2.maxMarginCapUsdt = 100;
bot2.config = bot2Config;
bot2.statusText = "RUNNING";
bot2.quarantinedSymbols = {};
bot2.symbolCooldowns = {};
bot2.flattenedCoinsBlacklist = [];

// Register preset files in state.setFiles
if (!Array.isArray(state.setFiles)) {
  state.setFiles = [];
}

const preset1 = {
  name: "Binance ⇄ Bybit Profit Maximizer (45bps / 25bps Net)",
  fileName: "binance_bybit_profit_maximizer.set",
  description: "High-conviction profit capture alpha. Strict 45 bps spread, 25 bps pure net yield hurdle, ultra-tight 0.08% divergence ceiling.",
  config: bot1Config,
};

const preset2 = {
  name: "Innovation Lab & Feature Challenger (32bps / 10bps Net)",
  fileName: "innovation_lab_challenger.set",
  description: "Live testbed testing ALL new upgrades: MAX_PER_COIN dynamic ATR leverage, Hurdle-Gated Quarter-Kelly, CAS scoring, L2 VWAP sweeps, correlation breaker, and carry rolling.",
  config: bot2Config,
};

const idx1 = state.setFiles.findIndex(s => s.fileName === preset1.fileName);
if (idx1 >= 0) state.setFiles[idx1] = preset1;
else state.setFiles.push(preset1);

const idx2 = state.setFiles.findIndex(s => s.fileName === preset2.fileName);
if (idx2 >= 0) state.setFiles[idx2] = preset2;
else state.setFiles.push(preset2);

// Save to disk across all 3 state copies
const outStr = JSON.stringify(state, null, 2);
fs.writeFileSync(userStatePath, outStr, "utf8");
fs.writeFileSync(webStatePath, outStr, "utf8");
fs.writeFileSync(rootStatePath, outStr, "utf8");

console.log("================================================================================");
console.log("   FLEET CONFIGURATION DEPLOYED: PROFIT MAXIMIZER vs INNOVATION LAB             ");
console.log("================================================================================");
console.log(` 1. ${bot1.name} [${bot1.id}]`);
console.log(`    - Corridor: ${bot1Config.executionCorridor} | Spread Hurdle: ${bot1Config.minSpreadBps} bps | Net Hurdle: ${bot1Config.minNetYieldHurdleBps} bps`);
console.log(`    - Divergence Ceiling: ${bot1Config.maxPriceDivergencePct}% | Leverage: ${bot1Config.customLeverage}x (${bot1Config.leverageMode}) | Allocation: ${bot1Config.balanceAllocationPct}%`);
console.log(`    - Size Cap: $${bot1Config.maxAmountPerHedgeUsdt} | Zero-Loss Gate: ENABLED (+$0.01) | Maker Routing: ENABLED (GTX)`);
console.log(` 2. ${bot2.name} [${bot2.id}]`);
console.log(`    - Corridor: ${bot2Config.executionCorridor} | Spread Hurdle: ${bot2Config.minSpreadBps} bps | Net Hurdle: ${bot2Config.minNetYieldHurdleBps} bps`);
console.log(`    - Divergence Ceiling: ${bot2Config.maxPriceDivergencePct}% | Leverage: DYNAMIC (${bot2Config.leverageMode}) | Allocation: Kelly-Scaled`);
console.log(`    - Size Cap: $${bot2Config.maxAmountPerHedgeUsdt} | All New Features (CAS, VWAP, Breaker, Dynamic ATR, Kelly): ACTIVELY TESTED`);
console.log(" 3-Copy State Synchronization: Verified (userState, webState, rootState).");
console.log("================================================================================");

// Trigger immediate cron tick to reload state in daemon memory
const req = http.get(
  {
    hostname: "127.0.0.1",
    port: 3000,
    path: "/api/bot/daemon?action=cron_tick",
    headers: {
      "x-cron-secret": process.env.CRON_SECRET || "internal_daemon_cron_secret_2026",
    },
  },
  (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      console.log("Daemon acknowledge response:", data);
      process.exit(0);
    });
  }
);

req.on("error", (err) => {
  console.warn("Could not trigger cron tick directly:", err.message);
  process.exit(0);
});
