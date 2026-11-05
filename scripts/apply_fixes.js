const fs = require('fs');

// 1. Patch web/app/api/coins/route.ts
let coinsRoute = fs.readFileSync('C:/AI-Hedge-Cockpit/web/app/api/coins/route.ts', 'utf8');

// Ensure lastUpstreamError is cleared at start of GET
if (!coinsRoute.includes('lastUpstreamError = null; // Reset for new request')) {
  coinsRoute = coinsRoute.replace(
    '  const fetchStart = Date.now();',
    '  const fetchStart = Date.now();\n  lastUpstreamError = null; // Reset for new request'
  );
}

// Find failover safeguard block
const failoverPattern = /\/\/ Failover safeguard: retain cached response if both exchanges return empty[\s\S]*?error: "Exchange endpoints returned empty or failed: serving cached market data",\s*\}\);\s*\}/;

const newFailover = `// Failover safeguard: retain cached response if both exchanges return empty, or return 500 on cold cache
    if (binanceData.length === 0 && bitgetData.length === 0) {
      if (cachedResponse) {
        const errDetail = lastUpstreamError && lastUpstreamError.message ? ' (' + lastUpstreamError.message + ')' : '';
        return NextResponse.json({
          ...cachedResponse,
          cached: true,
          updatedAt: lastFetchTime,
          error: 'Exchange endpoints returned empty or failed: serving cached market data' + errDetail,
        });
      }
      return NextResponse.json({
        success: false,
        error: lastUpstreamError && lastUpstreamError.message ? 'Upstream exchange endpoints failed: ' + lastUpstreamError.message : 'Exchange endpoints returned empty data',
        count: 0,
        cached: false,
        updatedAt: now,
        fetchLatencyMs: 0,
        marketSummary: {
          binanceTotal: 0,
          bitgetTotal: 0,
          mutualTotal: 0,
          binanceOverThresholdTotal: 0,
          bitgetOverThresholdTotal: 0,
          blacklistedTotal: 0,
          binanceOnlyTotal: 0,
          bitgetOnlyTotal: 0,
          coindcxTotal: 0,
          coindcxMutualTotal: 0,
          bybitTotal: 0,
          bybitMutualTotal: 0,
          fetchLatencyMs: 0,
        },
        coins: [],
        binanceRanked: [],
        bitgetRanked: [],
        coindcxRanked: [],
        bybitRanked: [],
        binanceOverThreshold: [],
        bitgetOverThreshold: [],
        blacklistedCoins: [],
      }, { status: 500 });
    }`;

if (failoverPattern.test(coinsRoute)) {
  coinsRoute = coinsRoute.replace(failoverPattern, newFailover);
  fs.writeFileSync('C:/AI-Hedge-Cockpit/web/app/api/coins/route.ts', coinsRoute, 'utf8');
  console.log('web/app/api/coins/route.ts updated successfully.');
} else {
  console.log('failoverPattern did not match in coins/route.ts');
}

// 2. Patch web/lib/exchangeFundingMeta.ts
let metaFile = fs.readFileSync('C:/AI-Hedge-Cockpit/web/lib/exchangeFundingMeta.ts', 'utf8');
const oldEffectiveMode = `  let effectiveMode: FundingIntervalMode = "STRICT_SYNC_ONLY";
  if (options?.intervalMode) {
    effectiveMode = options.intervalMode;
  } else if (options?.allowAsymmetric === true) {
    effectiveMode = "ALL_ASYMMETRIC";
  } else if (options?.allowAsymmetric === false) {
    effectiveMode = "STRICT_SYNC_ONLY";
  } else {
    effectiveMode = "STRICT_SYNC_ONLY";
  }`;

const newEffectiveMode = `  let effectiveMode: FundingIntervalMode = "ALL_ASYMMETRIC";
  if (options?.intervalMode) {
    effectiveMode = options.intervalMode;
  } else if (options?.allowAsymmetric === false) {
    effectiveMode = "STRICT_SYNC_ONLY";
  } else {
    effectiveMode = "ALL_ASYMMETRIC";
  }`;

if (metaFile.includes(oldEffectiveMode)) {
  metaFile = metaFile.replace(oldEffectiveMode, newEffectiveMode);
  fs.writeFileSync('C:/AI-Hedge-Cockpit/web/lib/exchangeFundingMeta.ts', metaFile, 'utf8');
  console.log('web/lib/exchangeFundingMeta.ts updated to default ALL_ASYMMETRIC.');
} else {
  console.log('oldEffectiveMode not found in exchangeFundingMeta.ts');
}

// 3. Patch tests/test_architectural_anti_loss_safeguards.js
let safeFile = fs.readFileSync('C:/AI-Hedge-Cockpit/tests/test_architectural_anti_loss_safeguards.js', 'utf8');

// Test R1.1
safeFile = safeFile.replace(
  'const syncCheck = checkFundingSynchronization("Binance", "Bybit", mockMeta, now);',
  'const syncCheck = checkFundingSynchronization("Binance", "Bybit", mockMeta, now, { allowAsymmetric: false, intervalMode: "STRICT_SYNC_ONLY" });'
);

// Test R1.4
safeFile = safeFile.replace(
  'const result = evaluatePairwiseArbitrage(venues, 8);',
  'const result = evaluatePairwiseArbitrage(venues, 8, { allowAsymmetric: false, intervalMode: "STRICT_SYNC_ONLY" });'
);

// Test R1.6
safeFile = safeFile.replace(
  'const res = evaluatePairwiseArbitrage(venues, 8);',
  'const res = evaluatePairwiseArbitrage(venues, 8, { allowAsymmetric: false, intervalMode: "STRICT_SYNC_ONLY" });'
);

// Test R1.9
safeFile = safeFile.replace(
  'const syncCheck = checkFundingSynchronization("Binance", "Bybit", liveMetaDesynced, now);',
  'const syncCheck = checkFundingSynchronization("Binance", "Bybit", liveMetaDesynced, now, { allowAsymmetric: false, intervalMode: "STRICT_SYNC_ONLY" });'
);

fs.writeFileSync('C:/AI-Hedge-Cockpit/tests/test_architectural_anti_loss_safeguards.js', safeFile, 'utf8');
console.log('tests/test_architectural_anti_loss_safeguards.js updated successfully.');
