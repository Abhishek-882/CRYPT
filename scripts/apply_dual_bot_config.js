const fs = require("fs");
const path = require("path");

const userStatePath = path.join(__dirname, "..", "web", "data", "users", "usr_admin_varsha", "bot_daemon_state.json");
const webStatePath = path.join(__dirname, "..", "web", "bot_daemon_state.json");
const rootStatePath = path.join(__dirname, "..", "bot_daemon_state.json");
const webDataStatePath = path.join(__dirname, "..", "web", "data", "bot_daemon_state.json");

const state = JSON.parse(fs.readFileSync(userStatePath, "utf8"));

state.isRunning = true;
state.runInBackgroundWhenClosed = true;
state.mode = "AUTONOMOUS_SERVER_24_7";
state.lastCycleAt = Date.now();

// 1. Bot 1: Profit Maximizer
const bot1Config = {
  enabled: true,
  executionCorridor: "BINANCE_BYBIT",
  minSpreadBps: 45.0,
  roundTripFeeBps: 21.0,
  minNetYieldHurdleBps: 25.0,
  maxPriceDivergencePct: 0.08,
  maxPriceDivergenceCapPct: 0.20,
  maxDivergenceSpreadRatioPct: 25.0,
  optimalPriceDivergencePct: 0.015,
  balanceAllocationPct: 25,
  leverageMode: "CUSTOM",
  customLeverage: 10,
  maxSimultaneousHedges: 2,
  maxMarginCapUsdt: 250,
  maxAmountPerHedgeUsdt: 15.0,
  liquidityTier: "THIN",
  enablePreTradeSlippageGate: true,
  maxBidAskSpreadBps: 20.0,
  maxPreTradeSlippagePct: 0.08,
  enableMakerRouting: true,
  timingMode: "CONTINUOUS_SPREAD",
  allowAsymmetricFunding: true,
  intervalMode: "ALL_ASYMMETRIC",
  enableSpreadCollapseExit: true,
  spreadCollapseExitBps: 20.0,
  postSettlementWaitSeconds: 15,
  enableZeroLossGate: true,
  closeMaxPriceDivergencePct: 0.18,
  targetRoiTakeProfitPct: 25.0,
  hardRoiTakeProfitPct: 50.0,
  enableFundingInversionCircuitBreaker: false,
  enableCarryContinuation: true,
  minContinuationSpreadBps: 22.0,
  scanIntervalSeconds: 5,
};

// 2. Bot 2: Innovation Lab & Feature Challenger
const bot2Config = {
  enabled: true,
  executionCorridor: "BINANCE_BYBIT",
  minSpreadBps: 32.0,
  roundTripFeeBps: 21.0,
  minNetYieldHurdleBps: 10.0,
  maxPriceDivergencePct: 0.25,
  maxPriceDivergenceCapPct: 0.50,
  maxDivergenceSpreadRatioPct: 45.0,
  optimalPriceDivergencePct: 0.03,
  balanceAllocationPct: 20,
  leverageMode: "MAX_PER_COIN", // Dynamic ATR leverage testing
  customLeverage: 10,
  maxSimultaneousHedges: 2,
  maxMarginCapUsdt: 100,
  maxAmountPerHedgeUsdt: 10.0,
  liquidityTier: "THIN",
  enablePreTradeSlippageGate: true,
  maxBidAskSpreadBps: 35.0,
  maxPreTradeSlippagePct: 0.15,
  enableMakerRouting: true,
  timingMode: "CONTINUOUS_SPREAD",
  allowAsymmetricFunding: true,
  intervalMode: "ALL_ASYMMETRIC",
  enableSpreadCollapseExit: true,
  spreadCollapseExitBps: 15.0,
  postSettlementWaitSeconds: 15,
  enableZeroLossGate: true,
  closeMaxPriceDivergencePct: 0.25,
  targetRoiTakeProfitPct: 20.0,
  hardRoiTakeProfitPct: 50.0,
  enableFundingInversionCircuitBreaker: false,
  enableCarryContinuation: true,
  minContinuationSpreadBps: 18.0,
  scanIntervalSeconds: 5,
};

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

const outStr = JSON.stringify(state, null, 2);
fs.writeFileSync(userStatePath, outStr, "utf8");
fs.writeFileSync(webStatePath, outStr, "utf8");
fs.writeFileSync(rootStatePath, outStr, "utf8");
fs.writeFileSync(webDataStatePath, outStr, "utf8");

console.log("State written to all 4 locations successfully.");
