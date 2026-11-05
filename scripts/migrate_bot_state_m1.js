// scripts/migrate_bot_state_m1.js
const fs = require('fs');
const path = require('path');

const targetFiles = [
  'C:\\AI-Hedge-Cockpit\\web\\bot_daemon_state.json',
  'C:\\AI-Hedge-Cockpit\\bot_daemon_state.json'
];

targetFiles.forEach((filePath) => {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  // 1. Root updates
  data.isRunning = true;
  data.statusText = 'SCANNING [CoinDCX⇄Bybit]';

  if (!data.config) {
    data.config = {};
  }
  data.config.enabled = true;
  data.config.executionCorridor = 'COINDCX_BYBIT';
  data.config.maxMarginCapUsdt = 50;
  data.config.maxAmountPerHedgeUsdt = 20;
  data.config.balanceAllocationPct = 25;
  data.config.minSpreadBps = 5.0;
  data.config.timingMode = 'FUNDING_SNIPER_5M';

  // 2. Bots array update
  if (Array.isArray(data.bots) && data.bots.length > 0) {
    const b0 = data.bots[0];
    b0.name = 'CoinDCX ⇄ Bybit Real USD Sniper';
    b0.activeSetFileName = 'conservative_5bps_sniper.set';
    b0.enabled = true;
    b0.maxMarginCapUsdt = 50;
    b0.statusText = 'SCANNING [CoinDCX⇄Bybit]';

    if (!b0.config) {
      b0.config = {};
    }
    b0.config.enabled = true;
    b0.config.executionCorridor = 'COINDCX_BYBIT';
    b0.config.maxMarginCapUsdt = 50;
    b0.config.maxAmountPerHedgeUsdt = 20;
    b0.config.balanceAllocationPct = 25;
    b0.config.minSpreadBps = 5.0;
    b0.config.timingMode = 'FUNDING_SNIPER_5M';
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Successfully updated ${filePath}`);
});
