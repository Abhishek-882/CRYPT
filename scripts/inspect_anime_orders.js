const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

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
  console.log('=== INSPECTING ANIMEUSDT BYBIT ORDERS & EXECUTIONS ===');
  
  // 1. Fetch orders for ANIMEUSDT
  const orderRes = await callBybit('/v5/order/history', { category: 'linear', symbol: 'ANIMEUSDT', limit: 50 });
  console.log('Order History Count:', orderRes?.result?.list?.length);
  if (orderRes?.result?.list) {
    for (const o of orderRes.result.list.slice(0, 15)) {
      const time = new Date(parseInt(o.createdTime)).toISOString();
      console.log(`[${time}] ID: ${o.orderId} LinkId: ${o.orderLinkId} Side: ${o.side} Type: ${o.orderType} Qty: ${o.qty} Price: ${o.price || o.avgPrice} Status: ${o.orderStatus} ReduceOnly: ${o.reduceOnly}`);
    }
  }

  // 2. Fetch Closed PnL list specifically for ANIMEUSDT
  const closedRes = await callBybit('/v5/position/closed-pnl', { category: 'linear', symbol: 'ANIMEUSDT', limit: 20 });
  console.log('\nClosed PnL for ANIMEUSDT (sample):');
  if (closedRes?.result?.list) {
    for (const c of closedRes.result.list.slice(0, 10)) {
      const time = new Date(parseInt(c.updatedTime)).toISOString();
      console.log(`[${time}] Side: ${c.side} Qty: ${c.qty} Entry: ${c.avgEntryPrice} Exit: ${c.avgExitPrice} PnL: ${c.closedPnl} OrderId: ${c.orderId}`);
    }
  }
}

run().catch(console.error);
