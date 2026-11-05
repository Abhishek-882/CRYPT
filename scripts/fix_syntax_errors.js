const fs = require('fs');

// 1. Fix web/lib/exchangeFundingMeta.ts
const metaPath = 'C:/AI-Hedge-Cockpit/web/lib/exchangeFundingMeta.ts';
let codeMeta = fs.readFileSync(metaPath, 'utf8');

const oldBlock = `  let effectiveMode: FundingIntervalMode = "STRICT_SYNC_ONLY";
  if (options?.intervalMode) {
    effectiveMode = options.intervalMode;
  } else if (options?.allowAsymmetric === true) {
    effectiveMode = "ALL_ASYMMETRIC";
  } else if (options?.allowAsymmetric === false) {
    effectiveMode = "STRICT_SYNC_ONLY";
  } else {
    effectiveMode = "STRICT_SYNC_ONLY";
  } else {
    effectiveMode = "ALL_ASYMMETRIC";
  }`;

const newBlock = `  let effectiveMode: FundingIntervalMode = "STRICT_SYNC_ONLY";
  if (options?.intervalMode) {
    effectiveMode = options.intervalMode;
  } else if (options?.allowAsymmetric === true) {
    effectiveMode = "ALL_ASYMMETRIC";
  } else if (options?.allowAsymmetric === false) {
    effectiveMode = "STRICT_SYNC_ONLY";
  } else {
    effectiveMode = "STRICT_SYNC_ONLY";
  }`;

if (codeMeta.includes(oldBlock)) {
  codeMeta = codeMeta.replace(oldBlock, newBlock);
} else {
  // Regex fallback
  codeMeta = codeMeta.replace(
    /let effectiveMode: FundingIntervalMode = [\s\S]*?effectiveMode = "ALL_ASYMMETRIC";\s*\}/,
    newBlock
  );
}

fs.writeFileSync(metaPath, codeMeta, 'utf8');
console.log('Fixed exchangeFundingMeta.ts');

// 2. Fix web/app/api/coins/route.ts
const coinsPath = 'C:/AI-Hedge-Cockpit/web/app/api/coins/route.ts';
let codeCoins = fs.readFileSync(coinsPath, 'utf8');

const badBinanceBlockRegex = /async function fetchBinancePremiumIndex\(\): Promise<any\[\]> \{[\s\S]*?async function fetchBitgetTickers\(\)/;

const cleanBinanceAndBitget = `async function fetchBinancePremiumIndex(): Promise<any[]> {
  const endpoints = [
    "https://www.binance.com/fapi/v1/premiumIndex",
    "https://fapi.binance.com/fapi/v1/premiumIndex",
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "FundingArbitrage/2.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data;
        }
      }
    } catch (e: any) {
      lastUpstreamError = e;
    }
  }

  // Fallback to classic testnet only if both production endpoints fail
  try {
    const res = await fetch("https://testnet.binancefuture.com/fapi/v1/premiumIndex", {
      headers: { "User-Agent": "FundingArbitrage/2.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (e: any) {
    lastUpstreamError = e;
  }

  return [];
}

async function fetchBitgetTickers()`;

if (badBinanceBlockRegex.test(codeCoins)) {
  codeCoins = codeCoins.replace(badBinanceBlockRegex, cleanBinanceAndBitget);
  fs.writeFileSync(coinsPath, codeCoins, 'utf8');
  console.log('Fixed coins route.ts');
} else {
  console.error('Regex match failed for coins route.ts');
}
