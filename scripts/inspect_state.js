const fs = require('fs');
const s = JSON.parse(fs.readFileSync('bot_daemon_state.json', 'utf8'));
console.log("isRunning:", s.isRunning);
console.log("cyclesCount:", s.cyclesCount);
console.log("activeCorridor:", s.activeCorridor);
console.log("openTrades:", s.openTrades);
console.log("bots count:", (s.bots || []).length);
(s.bots || []).forEach(b => {
  console.log(`Bot: id=${b.id}, name="${b.name}", enabled=${b.enabled}, corridor=${b.corridor}, pair=${b.pair}`);
});
console.log("recentLogs (last 10):");
(s.recentLogs || []).slice(-10).forEach(l => console.log(l));
