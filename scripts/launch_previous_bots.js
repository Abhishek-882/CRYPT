const fs = require("fs");
const path = require("path");

const origPath = path.join(__dirname, "..", "web", "data", "users", "usr_admin_varsha", "bot_daemon_state_original.json");
const userStatePath = path.join(__dirname, "..", "web", "data", "users", "usr_admin_varsha", "bot_daemon_state.json");
const webStatePath = path.join(__dirname, "..", "web", "bot_daemon_state.json");
const rootStatePath = path.join(__dirname, "..", "bot_daemon_state.json");

const state = JSON.parse(fs.readFileSync(origPath, "utf8"));

state.isRunning = true;
state.runInBackgroundWhenClosed = true;
state.mode = "AUTONOMOUS_SERVER_24_7";
state.startedAt = Date.now();
state.lastCycleAt = Date.now();

// Enable all previously configured bots
for (const bot of state.bots) {
  bot.enabled = true;
  if (bot.config) {
    bot.config.enabled = true;
  }
  bot.statusText = "STARTING";
  console.log(`Enabled bot: ${bot.name} (${bot.id}) - Corridor: ${bot.config ? bot.config.executionCorridor : "N/A"}`);
}

const jsonStr = JSON.stringify(state, null, 2);
fs.writeFileSync(userStatePath, jsonStr, "utf8");
fs.writeFileSync(webStatePath, jsonStr, "utf8");
fs.writeFileSync(rootStatePath, jsonStr, "utf8");
console.log("Successfully launched and updated bot states!");
