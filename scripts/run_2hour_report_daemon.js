/**
 * Standalone Autonomous 2-Hour Fleet Reporting Daemon
 * Generates and archives comprehensive fleet telemetry reports every 2 hours (7,200,000 ms).
 * Operates independently around the clock to ensure uninterrupted historical audit tracking.
 */

const fs = require('fs');
const path = require('path');
const { generateReport } = require('./generate_fleet_status_report');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000; // 7,200,000 ms
const RETRY_DELAY_MS = 60 * 1000; // 60s retry on failure

const logDir = path.join(__dirname, '..', 'web', 'data', 'reports');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const auditLogPath = path.join(logDir, 'scheduler_audit.log');

function logSchedulerEvent(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}\n`;
  console.log(line.trim());
  try {
    fs.appendFileSync(auditLogPath, line, 'utf8');
  } catch (e) {
    console.error('Could not write to scheduler audit log:', e.message);
  }
}

let isRunning = false;
let timerHandle = null;

async function executeReportCycle() {
  if (isRunning) return;
  isRunning = true;

  logSchedulerEvent('Starting 2-hour fleet report execution cycle...');

  try {
    const result = await generateReport();
    logSchedulerEvent(
      `2-Hour Fleet Report successfully generated. Total NAV: $${result.totalNav.toFixed(2)} | Binance: $${result.binanceUsdt.toFixed(2)} | Bybit: $${result.bybitUsableMargin.toFixed(2)} | Open Positions: ${result.totalOpenPositions}. Archive: ${path.basename(result.archivePath)}`,
      'SUCCESS'
    );
    scheduleNext(TWO_HOURS_MS);
  } catch (err) {
    logSchedulerEvent(`Report generation encountered an error: ${err.message}. Retrying in 60 seconds...`, 'ERROR');
    scheduleNext(RETRY_DELAY_MS);
  } finally {
    isRunning = false;
  }
}

function scheduleNext(delayMs) {
  if (timerHandle) clearTimeout(timerHandle);
  const nextRunTime = new Date(Date.now() + delayMs).toLocaleTimeString();
  logSchedulerEvent(`Next 2-hour report scheduled for ${nextRunTime} (in ${(delayMs / 1000 / 60).toFixed(1)} minutes).`);
  timerHandle = setTimeout(() => {
    executeReportCycle();
  }, delayMs);
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  logSchedulerEvent('2-Hour Reporting Daemon shutting down gracefully (SIGINT).', 'WARN');
  if (timerHandle) clearTimeout(timerHandle);
  process.exit(0);
});

process.on('SIGTERM', () => {
  logSchedulerEvent('2-Hour Reporting Daemon shutting down gracefully (SIGTERM).', 'WARN');
  if (timerHandle) clearTimeout(timerHandle);
  process.exit(0);
});

console.log('================================================================================');
console.log('   AI HEDGE COCKPIT: AUTONOMOUS 2-HOUR REPORTING DAEMON LAUNCHED                ');
console.log('   Interval: Every 2 Hours (7,200,000 ms)                                       ');
console.log(`   Audit Log: ${auditLogPath}                                                  `);
console.log('================================================================================');

logSchedulerEvent('2-Hour Reporting Daemon initialized. Executing baseline report...');
executeReportCycle();
