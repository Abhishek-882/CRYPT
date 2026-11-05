const fs = require('fs');
const filePath = 'C:/AI-Hedge-Cockpit/web/app/api/auth/route.ts';
let code = fs.readFileSync(filePath, 'utf8');

const oldImportRegex = /ADMIN_DEFAULT_PASSWORD,(\r?\n)\} from "@\/lib\/userStore";/;
if (oldImportRegex.test(code)) {
  code = code.replace(oldImportRegex, (m, p1) => {
    return 'ADMIN_DEFAULT_PASSWORD,' + p1 +
      '  SYSTEM_DEFAULT_BINANCE_KEY,' + p1 +
      '  SYSTEM_DEFAULT_BINANCE_SECRET,' + p1 +
      '  SYSTEM_DEFAULT_BITGET_KEY,' + p1 +
      '  SYSTEM_DEFAULT_BITGET_SECRET,' + p1 +
      '  SYSTEM_DEFAULT_BITGET_PASSPHRASE,' + p1 +
      '  SYSTEM_DEFAULT_COINDCX_KEY,' + p1 +
      '  SYSTEM_DEFAULT_COINDCX_SECRET,' + p1 +
      '  SYSTEM_DEFAULT_BYBIT_KEY,' + p1 +
      '  SYSTEM_DEFAULT_BYBIT_SECRET,' + p1 +
      '} from "@/lib/userStore";';
  });
  console.log('Imports replaced successfully');
} else {
  console.log('Target import not found');
}

const targetFuncRegex = /function sanitizeUserApiKeys\(user: any\) \{[\s\S]*?return \{[\s\S]*?\};\s*\}/;

const newFunc = `function sanitizeUserApiKeys(user: any) {
  const keys = user?.apiKeys || {};
  const isAdmin = user?.role === "admin";

  const binanceKey = keys.binanceKey || (isAdmin ? SYSTEM_DEFAULT_BINANCE_KEY : "");
  const hasBinanceSecret = Boolean(keys.binanceSecret || (isAdmin && SYSTEM_DEFAULT_BINANCE_SECRET));

  const bitgetKey = keys.bitgetKey || (isAdmin ? SYSTEM_DEFAULT_BITGET_KEY : "");
  const hasBitgetSecret = Boolean(keys.bitgetSecret || (isAdmin && SYSTEM_DEFAULT_BITGET_SECRET));
  const bitgetPassphrase = keys.bitgetPassphrase || (isAdmin ? SYSTEM_DEFAULT_BITGET_PASSPHRASE : "");
  const hasBitgetPassphrase = Boolean(keys.bitgetPassphrase || (isAdmin && SYSTEM_DEFAULT_BITGET_PASSPHRASE));

  const coindcxKey = keys.coindcxKey || (isAdmin ? SYSTEM_DEFAULT_COINDCX_KEY : "");
  const hasCoinDcxSecret = Boolean(keys.coindcxSecret || (isAdmin && SYSTEM_DEFAULT_COINDCX_SECRET));

  const bybitKey = keys.bybitKey || (isAdmin ? SYSTEM_DEFAULT_BYBIT_KEY : "");
  const hasBybitSecret = Boolean(keys.bybitSecret || (isAdmin && SYSTEM_DEFAULT_BYBIT_SECRET));

  return {
    binanceKey,
    binanceSecret: hasBinanceSecret ? "••••••••••••" : "",
    hasBinanceSecret,
    binanceEndpoint: keys.binanceEndpoint || (isAdmin ? (process.env.BINANCE_ENDPOINT || "https://fapi.binance.com") : "https://testnet.binancefuture.com"),
    bitgetKey,
    bitgetSecret: hasBitgetSecret ? "••••••••••••" : "",
    hasBitgetSecret,
    bitgetPassphrase: hasBitgetPassphrase ? "••••••••••••" : "",
    hasBitgetPassphrase,
    bitgetEnv: keys.bitgetEnv || "demo",
    coindcxKey,
    coindcxSecret: hasCoinDcxSecret ? "••••••••••••" : "",
    hasCoinDcxSecret,
    bybitKey,
    bybitSecret: hasBybitSecret ? "••••••••••••" : "",
    hasBybitSecret,
    bybitProxy: keys.bybitProxy || "",
    bybitBaseUrl: keys.bybitBaseUrl || "",
    bybitBackupProxy: keys.bybitBackupProxy || "",
    bybitBackupBaseUrl: keys.bybitBackupBaseUrl || "",
  };
}`;

if (targetFuncRegex.test(code)) {
  code = code.replace(targetFuncRegex, newFunc);
  console.log('sanitizeUserApiKeys replaced successfully');
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('File written successfully');
} else {
  console.log('Function regex match failed');
}
