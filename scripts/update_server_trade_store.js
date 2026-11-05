const fs = require('fs');

const filePath = 'C:/AI-Hedge-Cockpit/web/lib/serverTradeStore.ts';
let code = fs.readFileSync(filePath, 'utf8');

// 1. Update imports
code = code.replace(
  'import { readDataFile, saveDataFile, readUserDataFile, saveUserDataFile } from "./storagePath";',
  'import { readDataFile, saveDataFile, readUserDataFile, saveUserDataFile, resolveUserStoragePath, resolveDataFilePath } from "./storagePath";'
);

// 2. Update cache and loadTrades
const oldCacheSection = [
  '// In-memory per-tenant trade cache',
  'const globalForTrades = global as unknown as {',
  '  tenantTrades?: Record<string, ServerHedgeTrade[]>;',
  '};',
  '',
  'if (!globalForTrades.tenantTrades) {',
  '  globalForTrades.tenantTrades = {};',
  '}',
  '',
  'export function loadTrades(userId?: string): ServerHedgeTrade[] {',
  '  const cacheKey = userId || "global_default";',
  '',
  '  if (globalForTrades.tenantTrades?.[cacheKey] !== undefined) {',
  '    return globalForTrades.tenantTrades[cacheKey];',
  '  }'
].join('\n');

const newCacheSection = [
  '// In-memory per-tenant trade cache with disk mtime synchronization',
  'const globalForTrades = global as unknown as {',
  '  tenantTrades?: Record<string, ServerHedgeTrade[]>;',
  '  tenantTradesMtime?: Record<string, number>;',
  '};',
  '',
  'if (!globalForTrades.tenantTrades) {',
  '  globalForTrades.tenantTrades = {};',
  '}',
  'if (!globalForTrades.tenantTradesMtime) {',
  '  globalForTrades.tenantTradesMtime = {};',
  '}',
  '',
  'function getTradesFileMtime(userId?: string): number {',
  '  try {',
  '    let filePath = "";',
  '    if (userId && userId !== "global_default") {',
  '      filePath = resolveUserStoragePath(userId, TRADES_FILE_NAME);',
  '    } else {',
  '      filePath = resolveDataFilePath(TRADES_FILE_NAME);',
  '    }',
  '    if (fs.existsSync(filePath)) {',
  '      return fs.statSync(filePath).mtimeMs;',
  '    }',
  '  } catch {}',
  '  return 0;',
  '}',
  '',
  'export function loadTrades(userId?: string, forceDiskRead: boolean = false): ServerHedgeTrade[] {',
  '  const cacheKey = userId || "global_default";',
  '  const diskMtime = getTradesFileMtime(userId);',
  '',
  '  // If cached in memory AND disk mtime has not changed AND not forcing reload, return cache',
  '  if (',
  '    !forceDiskRead &&',
  '    globalForTrades.tenantTrades?.[cacheKey] !== undefined &&',
  '    globalForTrades.tenantTradesMtime?.[cacheKey] === diskMtime &&',
  '    diskMtime > 0',
  '  ) {',
  '    return globalForTrades.tenantTrades[cacheKey];',
  '  }'
].join('\n');

if (!code.includes(oldCacheSection)) {
  console.error('ERROR: oldCacheSection not matched!');
  process.exit(1);
}
code = code.replace(oldCacheSection, newCacheSection);

// 3. Update return of loadTrades
code = code.replace(
  'globalForTrades.tenantTrades![cacheKey] = parsed;\n  return parsed;\n}',
  'globalForTrades.tenantTrades![cacheKey] = parsed;\n  globalForTrades.tenantTradesMtime![cacheKey] = getTradesFileMtime(userId);\n  return parsed;\n}'
);

// 4. Update saveTrades to set mtime
code = code.replace(
  'saveDataFile(TRADES_FILE_NAME, trades);\n  }\n}',
  'saveDataFile(TRADES_FILE_NAME, trades);\n  }\n\n  globalForTrades.tenantTradesMtime![cacheKey] = getTradesFileMtime(userId);\n}'
);

// 5. In recordServerTrade, force fresh read
code = code.replace(
  'const targetUser = userId || trade.userId || "global_default";\n  const trades = loadTrades(targetUser);',
  'const targetUser = userId || trade.userId || "global_default";\n  const trades = loadTrades(targetUser, true);'
);

fs.writeFileSync(filePath, code, 'utf8');
console.log('Successfully updated serverTradeStore.ts with bulletproof live disk synchronization!');
