const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

// Master key decryption
const rawKey = fs.readFileSync('C:/AI-Hedge-Cockpit/.vault_master_key', 'utf8').trim();
const masterKey = crypto.createHash('sha256').update(rawKey).digest();

function decryptSecret(cipherText) {
  if (!cipherText || !cipherText.startsWith('enc:v1:')) return cipherText;
  const parts = cipherText.substring('enc:v1:'.length).split(':');
  if (parts.length !== 3) return cipherText;
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const store = JSON.parse(fs.readFileSync('C:/AI-Hedge-Cockpit/user_accounts_store.json', 'utf8'));
const admin = store[0];
const apiKey = admin.apiKeys.bybitKey;
const apiSecret = decryptSecret(admin.apiKeys.bybitSecret);

function callBybit(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        searchParams.append(k, String(v));
      }
    }
    const queryString = searchParams.toString();
    const paramStr = timestamp + apiKey + recvWindow + queryString;
    const signature = crypto.createHmac('sha256', apiSecret).update(paramStr).digest('hex');

    const options = {
      hostname: 'api.bybit.com',
      port: 443,
      path: endpoint + (queryString ? '?' + queryString : ''),
      method: 'GET',
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-SIGN': signature,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN-TYPE': '1',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('=== BYBIT FORENSIC ACCOUNT AUDIT ===');
  
  // 1. Wallet Balance & Equity
  const bal = await callBybit('/v5/account/wallet-balance', { accountType: 'UNIFIED' });
  const coin = bal?.result?.list?.[0]?.coin?.find(c => c.coin === 'USDT') || {};
  console.log('Current Wallet Balance:', coin.walletBalance, 'USDT');
  console.log('Current Equity:', coin.equity, 'USDT');
  console.log('Cumulative Realised PnL (Account Lifetime):', coin.cumRealisedPnl, 'USDT');
  console.log('Total Available Balance:', coin.availableToWithdraw || coin.equity, 'USDT');

  // 2. Fetch all closed positions (up to 100)
  let cursor = '';
  let allClosed = [];
  for (let i = 0; i < 3; i++) {
    const res = await callBybit('/v5/position/closed-pnl', { category: 'linear', limit: 50, cursor: cursor || undefined });
    if (res?.result?.list?.length) {
      allClosed.push(...res.result.list);
      cursor = res.result.nextPageCursor;
      if (!cursor) break;
    } else {
      break;
    }
  }

  console.log(`\n=== TOTAL CLOSED POSITIONS RETRIEVED: ${allClosed.length} ===`);
  const bySymbol = {};
  let totalClosedPnl = 0;
  let totalOrderLoss = 0;
  let totalOrderGain = 0;

  for (const c of allClosed) {
    const pnl = parseFloat(c.closedPnl || 0);
    totalClosedPnl += pnl;
    if (pnl >= 0) totalOrderGain += pnl;
    else totalOrderLoss += pnl;

    if (!bySymbol[c.symbol]) {
      bySymbol[c.symbol] = { count: 0, pnl: 0, wins: 0, losses: 0, latest: c.updatedTime };
    }
    bySymbol[c.symbol].count++;
    bySymbol[c.symbol].pnl += pnl;
    if (pnl >= 0) bySymbol[c.symbol].wins++;
    else bySymbol[c.symbol].losses++;
  }

  console.log('\n--- PnL Breakdown by Symbol ---');
  console.table(Object.entries(bySymbol).map(([sym, stats]) => ({
    Symbol: sym,
    Trades: stats.count,
    Wins: stats.wins,
    Losses: stats.losses,
    'Total PnL (USDT)': stats.pnl.toFixed(4)
  })).sort((a, b) => a['Total PnL (USDT)'] - b['Total PnL (USDT)']));

  console.log('\nSum of all retrieved Closed PnL:', totalClosedPnl.toFixed(4), 'USDT');
  console.log('Total Winning Trades Value:', totalOrderGain.toFixed(4), 'USDT');
  console.log('Total Losing Trades Value:', totalOrderLoss.toFixed(4), 'USDT');

  // 3. Transaction Log (Funding fees + trading fees + cash flow)
  console.log('\n=== RECENT TRANSACTION LOG (Fees & Funding) ===');
  const txLog = await callBybit('/v5/account/transaction-log', { accountType: 'UNIFIED', category: 'linear', limit: 25 });
  if (txLog?.result?.list) {
    for (const t of txLog.result.list) {
      const time = new Date(parseInt(t.transactionTime)).toISOString();
      console.log(`[${time}] ${t.symbol || 'GLOBAL'} Type: ${t.type} Change: ${t.cashFlow} Fee: ${t.fee || '0'} BalanceAfter: ${t.cashBalance}`);
    }
  } else {
    console.log('Transaction log response:', JSON.stringify(txLog));
  }
}

run().catch(console.error);
