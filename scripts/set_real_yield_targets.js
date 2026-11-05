const fs = require("fs");
const path = require("path");

const userStatePath = path.join(__dirname, "..", "web", "data", "users", "usr_admin_varsha", "bot_daemon_state.json");
const webStatePath = path.join(__dirname, "..", "web", "bot_daemon_state.json");
const rootStatePath = path.join(__dirname, "..", "bot_daemon_state.json");

const state = JSON.parse(fs.readFileSync(userStatePath, "utf8"));

for (const bot of state.bots) {
  if (bot.id === "bot-binance-bybit") {
    bot.config.minNetYieldHurdleBps = 25.0;
    bot.config.minSpreadBps = 50.0;
    console.log(`Updated ${bot.name} (${bot.id}): minNetYieldHurdleBps = 25.0`);
  } else if (bot.id === "bot-120328") {
    bot.config.minNetYieldHurdleBps = 10.0;
    bot.config.minSpreadBps = 35.0;
    console.log(`Updated ${bot.name} (${bot.id}): minNetYieldHurdleBps = 10.0`);
  }
}

if (state.config) {
  state.config.minNetYieldHurdleBps = 25.0;
}

if (Array.isArray(state.setFiles)) {
  for (const s of state.setFiles) {
    if (s.fileName === "binance_bybit_profit_harvester.set") {
      s.config.minNetYieldHurdleBps = 25.0;
      s.name = "Binance ⇄ Bybit Profit Harvester (50bps / 25bps Net)";
    } else if (s.fileName === "remediation_verifier_loosened.set") {
      s.config.minNetYieldHurdleBps = 10.0;
      s.name = "Remediation Verifier (Loosened 35bps / 10bps Net)";
    }
  }
}

const outStr = JSON.stringify(state, null, 2);
fs.writeFileSync(userStatePath, outStr, "utf8");
fs.writeFileSync(webStatePath, outStr, "utf8");
fs.writeFileSync(rootStatePath, outStr, "utf8");
console.log("State files written successfully!");
