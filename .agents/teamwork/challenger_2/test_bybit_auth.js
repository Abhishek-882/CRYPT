const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

const vaultKey = '2f1afca42db8f9b86e03660cf5591193c3c061b5c01b99002892c4c5e5454d18';

function decryptVaultSecret(cipherText) {
  if (!cipherText || !cipherText.startsWith('enc:v1:')) return cipherText || '';
  try {
    const parts = cipherText.substring('enc:v1:'.length).split(':');
    if (parts.length !== 3) return cipherText;
    const [ivHex, tagHex, dataHex] = parts;
    const key = Buffer.from(vaultKey, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    return '';
  }
}

const store = JSON.parse(fs.readFileSync('C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/user_accounts_store.json', 'utf8'));
const admin = store.find(u => u.id === 'usr_admin_varsha');

const byKey = admin.apiKeys.bybitKey;
const bySec = decryptVaultSecret(admin.apiKeys.bybitSecret);

function signBybit(timestamp, apiKey, recvWindow, queryString, secret) {
  const message = timestamp + apiKey + recvWindow + queryString;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

async function bybitGet(endpoint, queryString = '') {
  return new Promise((resolve, reject) => {
    const ts = Date.now().toString();
    const recvWindow = '5000';
    const sig = signBybit(ts, byKey, recvWindow, queryString, bySec);
    const url = `https://api.bybit.com${endpoint}${queryString ? '?' + queryString : ''}`;
    
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'X-BAPI-API-KEY': byKey,
        'X-BAPI-SIGN': sig,
        'X-BAPI-TIMESTAMP': ts,
        'X-BAPI-RECV-WINDOW': recvWindow
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log("Testing Bybit authenticated endpoints for agreement / permissions info...");
  
  // 1. /v5/user/query-api
  try {
    const qApi = await bybitGet('/v5/user/query-api');
    console.log("\n--- /v5/user/query-api ---");
    console.log("retCode:", qApi.retCode, qApi.retMsg);
    console.log("result:", JSON.stringify(qApi.result, null, 2));
  } catch (e) {
    console.error("query-api error:", e.message);
  }

  // 2. /v5/account/info
  try {
    const accInfo = await bybitGet('/v5/account/info');
    console.log("\n--- /v5/account/info ---");
    console.log("retCode:", accInfo.retCode, accInfo.retMsg);
    console.log("result:", JSON.stringify(accInfo.result, null, 2));
  } catch (e) {
    console.error("account/info error:", e.message);
  }
}

run();
