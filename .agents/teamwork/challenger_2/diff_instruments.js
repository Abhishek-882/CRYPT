const https = require('https');

async function getInfo(symbol) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=${symbol}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function check() {
  const bx = (await getInfo('BXUSDT')).result.list[0];
  const btc = (await getInfo('BTCUSDT')).result.list[0];
  console.log("Keys in BXUSDT that differ or exist:");
  for (const k of Object.keys(bx)) {
    if (JSON.stringify(bx[k]) !== JSON.stringify(btc[k])) {
      console.log(`Key [${k}]:`);
      console.log(`  BX:  `, bx[k]);
      console.log(`  BTC: `, btc[k]);
    }
  }
}

check();
