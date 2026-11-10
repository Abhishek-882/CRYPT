const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'web', 'node_modules', 'ws'));

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = path.join(__dirname, '..', 'chrome_qa_mobile_profile');
const ARTIFACT_DIR = 'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\43a8bb79-f742-4847-a44a-323a5b9b0ef8';
const DEBUG_PORT = 9556;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function runMobilePreciseTest() {
  console.log('=== PRECISE MOBILE & RESPONSIVENESS QA TEST ===');
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    '--headless=new',
    '--window-size=390,844',
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
    await send('Runtime.enable');
    await send('DOM.enable');

    // Emulate iPhone 14
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      hasTouch: true
    });

    await send('Page.navigate', { url: 'http://localhost:3000/convergence' });
    await delay(3000);

    // Now inject Divergence directly into the active mobile bottom dock
    const mobileMetrics = await send('Runtime.evaluate', {
      expression: `(() => {
        const bottomDock = document.querySelector('div.fixed.bottom-0');
        if (!bottomDock) return { error: 'No bottom dock found' };

        const initialItems = Array.from(bottomDock.querySelectorAll('a')).map(a => {
          const r = a.getBoundingClientRect();
          return {
            text: a.innerText.trim(),
            width: Math.round(r.width * 10) / 10,
            height: Math.round(r.height * 10) / 10,
            left: Math.round(r.left * 10) / 10,
            top: Math.round(r.top * 10) / 10
          };
        });

        // Insert Divergence link
        const mobileDivergence = document.createElement('a');
        mobileDivergence.href = '/divergence';
        mobileDivergence.className = 'flex flex-col items-center justify-center py-1 px-1.5 rounded-lg text-[10px] font-bold text-accent-amber min-h-[44px] min-w-[44px] transition-all bg-zinc-800/60 border border-zinc-700/60';
        mobileDivergence.id = 'simulated-divergence-mobile';
        mobileDivergence.innerHTML = '<svg class="w-4 h-4 text-accent-amber" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg><span class="text-[9px] mt-0.5 tracking-tight font-semibold">Divergence</span>';

        bottomDock.insertBefore(mobileDivergence, bottomDock.children[2]);

        const dockRect = bottomDock.getBoundingClientRect();
        const updatedItems = Array.from(bottomDock.querySelectorAll('a')).map(a => {
          const r = a.getBoundingClientRect();
          return {
            text: a.innerText.trim(),
            width: Math.round(r.width * 10) / 10,
            height: Math.round(r.height * 10) / 10,
            left: Math.round(r.left * 10) / 10,
            top: Math.round(r.top * 10) / 10,
            meetsWCAG44px: r.height >= 44 && r.width >= 44,
            isTruncatedOrWrapped: a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth
          };
        });

        // Check horizontal overflow
        const hasHorizontalOverflow = document.documentElement.scrollWidth > window.innerWidth;

        return {
          dockWidth: dockRect.width,
          dockHeight: dockRect.height,
          initialItems,
          updatedItems,
          hasHorizontalOverflow,
          viewportWidth: window.innerWidth
        };
      })()`,
      returnByValue: true
    });

    console.log('[QA Mobile Precise]', JSON.stringify(mobileMetrics.result.value, null, 2));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const shotPath = path.join(ARTIFACT_DIR, 'precise_mobile_dock_divergence.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    console.log(`[QA Mobile Precise] Saved screenshot to: ${shotPath}`);

    // Also test tablet/intermediate screen width (768px, iPad Mini)
    await send('Emulation.setDeviceMetricsOverride', {
      width: 768,
      height: 1024,
      deviceScaleFactor: 2,
      mobile: false
    });
    await delay(1500);

    const tabletMetrics = await send('Runtime.evaluate', {
      expression: `(() => {
        const desktopNav = document.querySelector('nav .hidden.sm\\\\:flex');
        const mobileDock = document.querySelector('div.fixed.bottom-0');
        const navBar = document.querySelector('nav > div');
        
        return {
          desktopNavVisible: desktopNav ? window.getComputedStyle(desktopNav).display !== 'none' : false,
          mobileDockVisible: mobileDock ? window.getComputedStyle(mobileDock).display !== 'none' : false,
          navBarScrollWidth: navBar ? navBar.scrollWidth : 0,
          navBarClientWidth: navBar ? navBar.clientWidth : 0,
          navBarOverflows: navBar ? navBar.scrollWidth > navBar.clientWidth : false
        };
      })()`,
      returnByValue: true
    });
    console.log('[QA Tablet 768px]', JSON.stringify(tabletMetrics.result.value, null, 2));

    const tabletShot = await send('Page.captureScreenshot', { format: 'png' });
    const tabletShotPath = path.join(ARTIFACT_DIR, 'tablet_768px_divergence_navbar.png');
    fs.writeFileSync(tabletShotPath, Buffer.from(tabletShot.data, 'base64'));
    console.log(`[QA Tablet Precise] Saved screenshot to: ${tabletShotPath}`);

    // Append to qa_manual_test_results.json
    const qaResultsPath = path.join(ARTIFACT_DIR, 'qa_manual_test_results.json');
    if (fs.existsSync(qaResultsPath)) {
      const data = JSON.parse(fs.readFileSync(qaResultsPath, 'utf8'));
      data.mobilePreciseMetrics = mobileMetrics.result.value;
      data.tabletMetrics = tabletMetrics.result.value;
      data.screenshots.push(shotPath, tabletShotPath);
      fs.writeFileSync(qaResultsPath, JSON.stringify(data, null, 2));
    }

    ws.close();
  } catch (err) {
    console.error('Mobile precise error:', err);
  } finally {
    try { chromeProc.kill(); } catch {}
  }
}

runMobilePreciseTest();
