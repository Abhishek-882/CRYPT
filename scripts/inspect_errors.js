const fs = require('fs');

const daemonPath = 'C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/users/usr_admin_varsha/bot_daemon_state.json';
const daemon = JSON.parse(fs.readFileSync(daemonPath, 'utf8'));

console.log('=== BOTS STATUS ===');
daemon.bots.forEach(b => {
  console.log('ID:', b.id, '| Name:', b.name, '| Enabled:', b.enabled, '| Corridor:', b.corridor);
  console.log('  Mode:', b.mode, '| minSpreadBps:', b.minSpreadBps, '| minNetYieldHurdleBps:', b.minNetYieldHurdleBps, '| maxAmount:', b.maxAmountPerHedgeUsdt);
  console.log('  Cycles:', b.cyclesCompleted, '| Errors:', b.errorCount, '| Last Error:', b.lastError || 'None');
  console.log('  Quarantined Symbols:', b.quarantinedSymbols ? Object.keys(b.quarantinedSymbols) : 'None');
});

const auditPath = 'C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/users/usr_admin_varsha/bot_audit_log.json';
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
console.log('\n=== RECENT AUDIT LOGS (ERRORS & WARNINGS) ===');
const errorLogs = audit.filter(l => 
  l.level === 'ERROR' || 
  l.level === 'WARN' || 
  (l.message && (l.message.toLowerCase().includes('error') || l.message.toLowerCase().includes('fail') || l.message.toLowerCase().includes('reject') || l.message.toLowerCase().includes('warn')))
).slice(-25);

errorLogs.forEach(l => {
  console.log(`[${l.timestamp || l.time}] [${l.level || 'INFO'}] ${l.message}`);
});

console.log('\n=== LAST 15 GENERAL AUDIT LOGS ===');
audit.slice(-15).forEach(l => {
  console.log(`[${l.timestamp || l.time}] [${l.level || 'INFO'}] ${l.message}`);
});
