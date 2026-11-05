const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9445;
const TEMP_PROFILE = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'chrome_snap_' + Date.now());
const SCREENSHOT_DIR = 'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\42bc4ac4-b5d2-4b58-b8c4-2862df424716\\screenshots';

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  console.log('Spawning Chrome headless on debug port', DEBUG_PORT);
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${TEMP_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1920,1080',
    'about:blank'
  ], { detached: false });

  await sleep(1500);

  let versionInfo;
  for (let i = 0; i < 15; i++) {
    try {
      const data = await httpGet(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const list = JSON.parse(data);
      if (list && list.length > 0) {
        versionInfo = list[0];
        break;
      }
    } catch (e) {
      await sleep(300);
    }
  }

  if (!versionInfo || !versionInfo.webSocketDebuggerUrl) {
    chromeProc.kill('SIGINT');
    throw new Error('Could not connect to Chrome DevTools Protocol');
  }

  const WebSocket = require(path.resolve(__dirname, '../web/node_modules/ws'));
  const ws = new WebSocket(versionInfo.webSocketDebuggerUrl);

  let id = 1;
  const callbacks = new Map();

  ws.on('message', (msg) => {
    const parsed = JSON.parse(msg.toString());
    if (parsed.id && callbacks.has(parsed.id)) {
      const cb = callbacks.get(parsed.id);
      callbacks.delete(parsed.id);
      if (parsed.error) cb.reject(new Error(parsed.error.message));
      else cb.resolve(parsed.result);
    }
  });

  await new Promise((resolve) => ws.on('open', resolve));

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const reqId = id++;
      callbacks.set(reqId, { resolve, reject });
      ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  }

  await send('Page.enable');
  await send('Network.enable');

  await send('Network.setCookie', {
    name: 'auth_session',
    value: 'usr_admin_varsha',
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    secure: false,
  });

  // 1. Capture /bot (the exact page from the user screenshot)
  console.log('Navigating to http://127.0.0.1:3000/bot ...');
  await send('Page.navigate', { url: 'http://127.0.0.1:3000/bot' });
  await sleep(4000);
  const shotBot = await send('Page.captureScreenshot', { format: 'png' });
  const botPath = path.join(SCREENSHOT_DIR, 'bot_page_fixed.png');
  fs.writeFileSync(botPath, Buffer.from(shotBot.data, 'base64'));
  console.log('Saved /bot screenshot to:', botPath);

  // 2. Capture /terminal
  console.log('Navigating to http://127.0.0.1:3000/terminal ...');
  await send('Page.navigate', { url: 'http://127.0.0.1:3000/terminal' });
  await sleep(4500);
  const shotTerm = await send('Page.captureScreenshot', { format: 'png' });
  const termPath = path.join(SCREENSHOT_DIR, 'terminal_page_fixed.png');
  fs.writeFileSync(termPath, Buffer.from(shotTerm.data, 'base64'));
  console.log('Saved /terminal screenshot to:', termPath);

  ws.close();
  chromeProc.kill('SIGINT');
  try {
    fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });
  } catch (e) {}
  console.log('All screenshots captured successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
