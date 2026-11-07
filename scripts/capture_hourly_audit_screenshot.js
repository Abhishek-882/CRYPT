const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'web', 'node_modules', 'ws'));

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = path.join(__dirname, '..', 'chrome_hourly_profile');
const SCREENSHOT_PATH = 'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\1d2bf9be-31cc-4a00-bea0-9564b0cbc34b\\hourly_audit_convergence.png';
const DEBUG_PORT = 9449;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function capture() {
  console.log('Launching Chrome to capture /convergence...');
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    '--headless=new',
    '--window-size=1600,1100',
    '--disable-gpu',
    '--no-first-run',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    await delay(2000);
    const targetList = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const pageTarget = targetList.find(t => t.type === 'page') || targetList[0];
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

    let reqId = 1;
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = reqId++;
        const onMsg = (raw) => {
          const msg = JSON.parse(raw);
          if (msg.id === id) {
            ws.removeListener('message', onMsg);
            if (msg.error) reject(msg.error);
            else resolve(msg.result);
          }
        };
        ws.on('message', onMsg);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Page.enable');
    await send('Page.navigate', { url: 'http://localhost:3000/convergence' });
    await delay(3500);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    console.log('Screenshot saved to:', SCREENSHOT_PATH);
    ws.close();
  } catch (err) {
    console.error('Capture error:', err);
  } finally {
    try { chromeProc.kill(); } catch {}
  }
}

capture();
