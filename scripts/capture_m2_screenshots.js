const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const WebSocket = require(path.join(__dirname, '..', 'web', 'node_modules', 'ws'));

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = path.join(__dirname, '..', 'chrome_automation_profile');
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');
const DEBUG_PORT = 9444;

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.pending = new Map();
    this.events = new EventEmitter();

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        } else if (msg.method) {
          this.events.emit(msg.method, msg.params);
        }
      } catch (err) {
        console.error('CDP message parse error:', err);
      }
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(eventName, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.events.removeListener(eventName, handler);
        reject(new Error(`Timeout waiting for event ${eventName}`));
      }, timeoutMs);
      const handler = (params) => {
        clearTimeout(timer);
        resolve(params);
      };
      this.events.once(eventName, handler);
    });
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getJson(url, retries = 25, delayMs = 300) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      const req = http.get(url, (res) => {
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
      req.on('error', (err) => {
        if (remaining > 0) {
          setTimeout(() => attempt(remaining - 1), delayMs);
        } else {
          reject(err);
        }
      });
    };
    attempt(retries);
  });
}

async function run() {
  console.log('=== Milestone 2: Automated Chrome Authentication & Screenshot Capture ===');
  console.log(`Chrome Binary: ${CHROME_PATH}`);
  console.log(`Isolated Profile: ${USER_DATA_DIR}`);
  console.log(`Screenshots Target: ${SCREENSHOTS_DIR}`);

  // Clean old profile locks if needed
  try {
    const lockfile = path.join(USER_DATA_DIR, 'lockfile');
    if (fs.existsSync(lockfile)) fs.unlinkSync(lockfile);
  } catch {}

  console.log('\n[1/7] Launching Google Chrome with isolated profile...');
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    '--headless=new',
    '--window-size=1920,1080',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    'about:blank'
  ], { stdio: 'ignore' });

  console.log(`Chrome started (PID: ${chromeProc.pid})`);

  try {
    console.log('[2/7] Connecting to Chrome DevTools Protocol...');
    const versionInfo = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    console.log(`Connected to: ${versionInfo.Browser}`);

    // Query /json/list for the default page target
    const targetList = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    console.log(`Discovered ${targetList.length} targets:`, targetList.map(t => ({ type: t.type, title: t.title })));
    const pageTarget = targetList.find(t => t.type === 'page') || targetList[0];
    if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
      throw new Error('No page target with webSocketDebuggerUrl found');
    }
    console.log(`Using page target ID: ${pageTarget.id}`);
    console.log(`WebSocket Target: ${pageTarget.webSocketDebuggerUrl}`);

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const cdp = new CDPClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('DOM.enable');

    // Set viewport
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });

    console.log('\n[3/7] Navigating to http://localhost:3000/login...');
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/login' });
    await delay(3000); // Allow Next.js React hydration

    // Check login page loaded
    const pageCheck = await cdp.send('Runtime.evaluate', {
      expression: `({
        url: window.location.href,
        title: document.title,
        hasEmail: !!document.querySelector('input[type="email"]'),
        hasPassword: !!document.querySelector('input[type="password"]'),
        hasSubmit: !!document.querySelector('button[type="submit"]')
      })`,
      returnByValue: true
    });
    console.log('Login page state:', pageCheck.result.value);

    console.log('\n[4/7] Entering admin credentials and submitting login form...');
    const loginExec = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const emailInput = document.querySelector('input[type="email"]');
        const passInput = document.querySelector('input[type="password"]');
        const submitBtn = document.querySelector('button[type="submit"]');

        if (!emailInput || !passInput || !submitBtn) {
          return { success: false, error: 'Form elements not found' };
        }

        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        nativeInputSetter.call(emailInput, 'admin@safecoiner.com');
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));

        nativeInputSetter.call(passInput, '123456Safe');
        passInput.dispatchEvent(new Event('input', { bubbles: true }));

        submitBtn.click();
        return { success: true, email: emailInput.value };
      })()`,
      returnByValue: true
    });
    console.log('Login form fill result:', loginExec.result.value);

    // Poll for redirect to terminal
    console.log('Waiting for authentication and redirection to /terminal...');
    let redirected = false;
    let finalUrl = '';
    for (let i = 0; i < 30; i++) {
      await delay(500);
      const urlCheck = await cdp.send('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true
      });
      finalUrl = urlCheck.result.value;
      if (finalUrl.includes('/terminal') || finalUrl === 'http://localhost:3000/') {
        redirected = true;
        break;
      }
    }

    if (!redirected) {
      console.warn(`Redirection not completed yet, current URL: ${finalUrl}`);
      // Check for error message on login page
      const errMsg = await cdp.send('Runtime.evaluate', {
        expression: 'document.body.innerText',
        returnByValue: true
      });
      console.log('Page text snippet:', (errMsg.result.value || '').substring(0, 300));
    } else {
      console.log(`Authentication confirmed! Redirected to: ${finalUrl}`);
    }

    // Wait 4 seconds for authenticated dashboard UI to fully render
    await delay(4000);

    console.log('\n[5/7] Capturing Screenshot 1: Authenticated Dashboard...');
    const dashScreenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    });

    const dashPath = path.join(SCREENSHOTS_DIR, 'authenticated_dashboard.png');
    fs.writeFileSync(dashPath, Buffer.from(dashScreenshot.data, 'base64'));
    const dashStat = fs.statSync(dashPath);
    console.log(`Saved: ${dashPath} (${(dashStat.size / 1024).toFixed(1)} KB)`);

    console.log('\n[6/7] Navigating to http://localhost:3000/bot...');
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/bot' });
    await delay(4000); // Wait for bot fleet status, daemon badge, and log stream

    const botPageCheck = await cdp.send('Runtime.evaluate', {
      expression: `({
        url: window.location.href,
        title: document.title,
        hasServerDaemonActive: document.body.innerText.includes('SERVER DAEMON ACTIVE') || document.body.innerText.includes('AUTONOMOUS'),
        hasBotName: document.body.innerText.includes('Binance ⇄ Bybit') || document.body.innerText.includes('USD Sniper')
      })`,
      returnByValue: true
    });
    console.log('Bot page indicators:', botPageCheck.result.value);

    console.log('\n[7/7] Capturing Screenshot 2: Active Trading Bot Status...');
    const botScreenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    });

    const botPath = path.join(SCREENSHOTS_DIR, 'active_bot_status.png');
    fs.writeFileSync(botPath, Buffer.from(botScreenshot.data, 'base64'));
    const botStat = fs.statSync(botPath);
    console.log(`Saved: ${botPath} (${(botStat.size / 1024).toFixed(1)} KB)`);

    console.log('\n=== Summary of Captured Verification Artifacts ===');
    console.log(`1. ${dashPath} | Size: ${dashStat.size} bytes`);
    console.log(`2. ${botPath} | Size: ${botStat.size} bytes`);

    ws.close();
  } finally {
    console.log('\nTerminating automated Chrome instance...');
    chromeProc.kill('SIGTERM');
  }
}

run().catch(err => {
  console.error('Execution failed:', err);
  process.exit(1);
});
