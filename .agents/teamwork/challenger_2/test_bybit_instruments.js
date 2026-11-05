const https = require('https');

const testSymbols = ['BXUSDT', 'EQTUSDT', 'CIENUSDT', 'DDOGUSDT', 'BTCUSDT', 'SOLUSDT'];

async function fetchInstrument(symbol) {
  return new Promise((resolve, reject) => {
    const url = `https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=${symbol}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log("Querying Bybit /v5/market/instruments-info for test symbols...");
  for (const sym of testSymbols) {
    try {
      const res = await fetchInstrument(sym);
      if (res.retCode === 0 && res.result && res.result.list && res.result.list.length > 0) {
        const item = res.result.list[0];
        console.log(`\nSymbol: ${item.symbol}`);
        console.log(`  status: ${item.status}`);
        console.log(`  baseCoin: ${item.baseCoin}, quoteCoin: ${item.quoteCoin}, settleCoin: ${item.settleCoin}`);
        console.log(`  contractType: ${item.contractType}`);
        console.log(`  launchTime: ${item.launchTime ? new Date(parseInt(item.launchTime)).toISOString() : 'N/A'}`);
        console.log(`  deliveryTime: ${item.deliveryTime}`);
        console.log(`  isPreListing: ${item.isPreListing}`);
        console.log(`  copyTrading: ${item.copyTrading}`);
        console.log(`  unifiedMarginTrade: ${item.unifiedMarginTrade}`);
        console.log(`  lotSizeFilter:`, JSON.stringify(item.lotSizeFilter));
        console.log(`  priceFilter:`, JSON.stringify(item.priceFilter));
        // Check for any agreement or special risk flags
        console.log(`  riskParameters:`, JSON.stringify(item.riskParameters || {}));
      } else {
        console.log(`\nSymbol: ${sym} -> retCode: ${res.retCode}, retMsg: ${res.retMsg}, list: ${JSON.stringify(res.result?.list)}`);
      }
    } catch (err) {
      console.error(`Error querying ${sym}:`, err.message);
    }
  }
}

run();
