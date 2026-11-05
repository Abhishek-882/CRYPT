const fs = require('fs');
const path = require('path');

const bots = [
  {
    id: "bot-binance-bybit",
    name: "Binance ⇄ Bybit Real USD Sniper",
    activeSetFileName: "binance_bybit_sniper.set",
    enabled: true,
    maxMarginCapUsdt: 500,
    config: {
      enabled: true,
      minSpreadBps: 35,
      maxPriceDivergencePct: 0.05,
      maxDivergenceSpreadRatioPct: 50,
      maxPriceDivergenceCapPct: 0.5,
      optimalPriceDivergencePct: 0.01,
      balanceAllocationPct: 20,
      leverageMode: "MAX_PER_COIN",
      customLeverage: 20,
      maxSimultaneousHedges: 3,
      maxMarginCapUsdt: 500,
      maxAmountPerHedgeUsdt: 30,
      postSettlementWaitSeconds: 15,
      closeMaxPriceDivergencePct: 0.03,
      scanIntervalSeconds: 5,
      timingMode: "FUNDING_SNIPER_5M",
      executionCorridor: "BINANCE_BYBIT",
      enableFlattenMemoryLock: true,
      allowAsymmetricFunding: false
    },
    flattenedCoinsBlacklist: [],
    symbolCooldowns: {},
    activeHedges: [],
    completedHedges: [],
    logs: [],
    statusText: "STARTING",
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "bot-1",
    name: "Conservative Funding Sniper",
    activeSetFileName: "conservative_5bps_sniper.set",
    enabled: true,
    maxMarginCapUsdt: 500,
    config: {
      enabled: true,
      minSpreadBps: 35,
      maxPriceDivergencePct: 0.05,
      maxDivergenceSpreadRatioPct: 50,
      maxPriceDivergenceCapPct: 0.5,
      optimalPriceDivergencePct: 0.01,
      balanceAllocationPct: 20,
      leverageMode: "MAX_PER_COIN",
      customLeverage: 50,
      maxSimultaneousHedges: 3,
      maxMarginCapUsdt: 500,
      maxAmountPerHedgeUsdt: 30,
      postSettlementWaitSeconds: 15,
      closeMaxPriceDivergencePct: 0.03,
      scanIntervalSeconds: 5,
      timingMode: "FUNDING_SNIPER_5M",
      executionCorridor: "COINDCX_BYBIT",
      enableFlattenMemoryLock: true,
      allowAsymmetricFunding: false
    },
    flattenedCoinsBlacklist: [],
    symbolCooldowns: {},
    activeHedges: [],
    completedHedges: [],
    logs: [],
    statusText: "STARTING",
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

const statePayload = {
  isRunning: true,
  runInBackgroundWhenClosed: true,
  mode: "AUTONOMOUS_SERVER_24_7",
  startedAt: Date.now(),
  lastCycleAt: Date.now(),
  cyclesCompleted: 0,
  activeBotId: "bot-binance-bybit",
  bots: bots
};

const targets = [
  'C:/AI-Hedge-Cockpit/web/bot_daemon_state.json',
  'C:/AI-Hedge-Cockpit/bot_daemon_state.json',
  'C:/AI-Hedge-Cockpit/web/data/bot_daemon_state.json',
  'C:/AI-Hedge-Cockpit/web/data/users/usr_admin_varsha/bot_daemon_state.json'
];

targets.forEach(t => {
  const dir = path.dirname(t);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(t, JSON.stringify(statePayload, null, 2), 'utf8');
  console.log('Updated active bot state at:', t);
});

console.log('Active bots configuration completed successfully.');
