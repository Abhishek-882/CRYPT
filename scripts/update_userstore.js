const fs = require('fs');
let file = fs.readFileSync('C:/AI-Hedge-Cockpit/web/lib/userStore.ts', 'utf8');

// 1. Remove assignment of SYSTEM_DEFAULT_* in loadUsers
const loadRegex = /if \(!parsed\[adminIdx\]\.apiKeys\.binanceKey && SYSTEM_DEFAULT_BINANCE_KEY\) \{[\s\S]*?if \(parsed\[adminIdx\]\.apiKeys\.binanceEndpoint === "https:\/\/demo-fapi\.binance\.com"\) \{/;
if (loadRegex.test(file)) {
  file = file.replace(loadRegex, 'if (parsed[adminIdx].apiKeys.binanceEndpoint === "https://demo-fapi.binance.com") {');
  console.log('loadUsers assignment removed.');
} else {
  console.log('loadRegex did not match.');
}

// 2. Scrub defaults before disk save in saveUsers
const saveRegex = /export function saveUsers\(users: UserAccount\[\]\): void \{[\s\S]*?saveDataFile\(USERS_FILE_NAME, users\);[\s\S]*?\}/;
const replacementSave = `export function saveUsers(users: UserAccount[]): void {
  globalForUsers.userAccounts = users;
  const diskCopy = JSON.parse(JSON.stringify(users));
  for (const u of diskCopy) {
    if (u.role === "admin" && u.apiKeys) {
      if (u.apiKeys.binanceKey === SYSTEM_DEFAULT_BINANCE_KEY) u.apiKeys.binanceKey = "";
      if (u.apiKeys.bitgetKey === SYSTEM_DEFAULT_BITGET_KEY) u.apiKeys.bitgetKey = "";
      if (u.apiKeys.coindcxKey === SYSTEM_DEFAULT_COINDCX_KEY) u.apiKeys.coindcxKey = "";
      if (u.apiKeys.bybitKey === SYSTEM_DEFAULT_BYBIT_KEY) u.apiKeys.bybitKey = "";
      if (SYSTEM_DEFAULT_BINANCE_SECRET && decryptVaultSecret(u.apiKeys.binanceSecret) === SYSTEM_DEFAULT_BINANCE_SECRET) u.apiKeys.binanceSecret = "";
      if (SYSTEM_DEFAULT_BITGET_SECRET && decryptVaultSecret(u.apiKeys.bitgetSecret) === SYSTEM_DEFAULT_BITGET_SECRET) u.apiKeys.bitgetSecret = "";
      if (SYSTEM_DEFAULT_BITGET_PASSPHRASE && decryptVaultSecret(u.apiKeys.bitgetPassphrase) === SYSTEM_DEFAULT_BITGET_PASSPHRASE) u.apiKeys.bitgetPassphrase = "";
      if (SYSTEM_DEFAULT_COINDCX_SECRET && decryptVaultSecret(u.apiKeys.coindcxSecret) === SYSTEM_DEFAULT_COINDCX_SECRET) u.apiKeys.coindcxSecret = "";
      if (SYSTEM_DEFAULT_BYBIT_SECRET && decryptVaultSecret(u.apiKeys.bybitSecret) === SYSTEM_DEFAULT_BYBIT_SECRET) u.apiKeys.bybitSecret = "";
    }
  }
  saveDataFile(USERS_FILE_NAME, diskCopy);
}`;

if (saveRegex.test(file)) {
  file = file.replace(saveRegex, replacementSave);
  console.log('saveUsers updated.');
} else {
  console.log('saveRegex did not match.');
}

// 3. Fallback to system defaults in getMaskedUserApiKeys for admin
const maskedRegex = /const raw = user\.apiKeys;[\s\S]*?return \{[\s\S]*?binanceKey: raw\.binanceKey \?[\s\S]*?bybitBackupBaseUrl: raw\.bybitBackupBaseUrl \|\| "",\s*\};/;
const replacementMasked = `const raw = user.apiKeys;
  const isAdmin = user.role === "admin";
  const bKey = raw.binanceKey || (isAdmin ? SYSTEM_DEFAULT_BINANCE_KEY : "");
  const bSec = raw.binanceSecret || (isAdmin ? SYSTEM_DEFAULT_BINANCE_SECRET : "");
  const bgKey = raw.bitgetKey || (isAdmin ? SYSTEM_DEFAULT_BITGET_KEY : "");
  const bgSec = raw.bitgetSecret || (isAdmin ? SYSTEM_DEFAULT_BITGET_SECRET : "");
  const bgPass = raw.bitgetPassphrase || (isAdmin ? SYSTEM_DEFAULT_BITGET_PASSPHRASE : "");
  const cdxKey = raw.coindcxKey || (isAdmin ? SYSTEM_DEFAULT_COINDCX_KEY : "");
  const cdxSec = raw.coindcxSecret || (isAdmin ? SYSTEM_DEFAULT_COINDCX_SECRET : "");
  const bybitKey = raw.bybitKey || (isAdmin ? SYSTEM_DEFAULT_BYBIT_KEY : "");
  const bybitSec = raw.bybitSecret || (isAdmin ? SYSTEM_DEFAULT_BYBIT_SECRET : "");

  return {
    binanceKey: bKey ? (bKey.length >= 8 ? \`\${bKey.slice(0, 4)}••••\${bKey.slice(-4)}\` : "••••••••") : "",
    binanceSecret: bSec ? "••••••••••••••••" : "",
    binanceEndpoint: raw.binanceEndpoint || "https://testnet.binancefuture.com",
    bitgetKey: bgKey ? (bgKey.length >= 8 ? \`\${bgKey.slice(0, 4)}••••\${bgKey.slice(-4)}\` : "••••••••") : "",
    bitgetSecret: bgSec ? "••••••••••••••••" : "",
    bitgetPassphrase: bgPass ? "••••••••" : "",
    bitgetEnv: raw.bitgetEnv || "demo",
    coindcxKey: cdxKey ? (cdxKey.length >= 8 ? \`\${cdxKey.slice(0, 4)}••••\${cdxKey.slice(-4)}\` : "••••••••") : "",
    coindcxSecret: cdxSec ? "••••••••••••••••" : "",
    bybitKey: bybitKey ? (bybitKey.length >= 8 ? \`\${bybitKey.slice(0, 4)}••••\${bybitKey.slice(-4)}\` : "••••••••") : "",
    bybitSecret: bybitSec ? "••••••••••••••••" : "",
    bybitProxy: raw.bybitProxy || "",
    bybitBaseUrl: raw.bybitBaseUrl || "",
    bybitBackupProxy: raw.bybitBackupProxy || "",
    bybitBackupBaseUrl: raw.bybitBackupBaseUrl || "",
  };`;

if (maskedRegex.test(file)) {
  file = file.replace(maskedRegex, replacementMasked);
  console.log('getMaskedUserApiKeys updated.');
} else {
  console.log('maskedRegex did not match.');
}

fs.writeFileSync('C:/AI-Hedge-Cockpit/web/lib/userStore.ts', file, 'utf8');
console.log('Finished updating userStore.ts');
