const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'web', 'node_modules', 'ws'));

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = path.join(__dirname, '..', 'chrome_qa_profile');
const ARTIFACT_DIR = 'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\43a8bb79-f742-4847-a44a-323a5b9b0ef8';
const DEBUG_PORT = 9555;

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

async function runQATest() {
  console.log('=== STARTING MANUAL COCKPIT UX & BROWSER QA TEST ===');
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  // Launch Chrome with remote debugging
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    '--headless=new',
    '--window-size=1920,1080',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { stdio: 'ignore' });

  let ws;
  try {
    await delay(2500);
    const targetList = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const pageTarget = targetList.find(t => t.type === 'page') || targetList[0];
    if (!pageTarget) throw new Error('No Chrome page target found');

    ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
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

    // Enable domains
    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');
    await send('Network.enable');

    console.log('[QA] Chrome CDP connected.');

    // 1. Authenticate session
    console.log('[QA] Setting up authenticated session for admin@safecoiner.com...');
    await send('Page.navigate', { url: 'http://localhost:3000/login' });
    await delay(2000);

    const loginRes = await send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const res = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'login',
              email: 'admin@safecoiner.com',
              password: '123456Safe'
            })
          });
          return await res.json();
        } catch(e) {
          return { error: e.message };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('[QA] Login API response:', JSON.stringify(loginRes.result.value));

    // 2. Desktop Navigation Test: Intro Page
    console.log('[QA] Navigating to http://localhost:3000/ (Intro Page)...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await delay(3000);

    const introShot = await send('Page.captureScreenshot', { format: 'png' });
    const introShotPath = path.join(ARTIFACT_DIR, 'cockpit_intro_desktop.png');
    fs.writeFileSync(introShotPath, Buffer.from(introShot.data, 'base64'));
    console.log(`[QA] Saved intro desktop screenshot: ${introShotPath}`);

    // 3. Desktop Navigation Test: Convergence Cockpit
    console.log('[QA] Navigating to http://localhost:3000/convergence (Convergence Cockpit)...');
    await send('Page.navigate', { url: 'http://localhost:3000/convergence' });
    await delay(4000);

    // Collect DOM inspection data on Convergence Cockpit
    const cockpitInspect = await send('Runtime.evaluate', {
      expression: `(() => {
        const title = document.title;
        const navLinks = Array.from(document.querySelectorAll('nav a')).map(a => ({
          href: a.getAttribute('href'),
          text: a.innerText.trim(),
          rect: a.getBoundingClientRect()
        }));

        const cards = Array.from(document.querySelectorAll('.rounded-xl, .rounded-lg, .border')).map(c => ({
          text: c.innerText.slice(0, 80).replace(/\\n/g, ' '),
          className: c.className
        })).filter(c => c.text.length > 5).slice(0, 15);

        // Check for notation consistency
        const pageText = document.body.innerText;
        const bpsMatches = pageText.match(/\\b\\d+(?:\\.\\d+)?\\s*(?:bps|BPS)\\b/g) || [];
        const pctMatches = pageText.match(/\\b[-+]?\\d+(?:\\.\\d+)?%/g) || [];

        // Check tables
        const tables = Array.from(document.querySelectorAll('table')).map(t => {
          const headers = Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim());
          const rowCount = t.querySelectorAll('tbody tr').length;
          return { headers, rowCount };
        });

        // Performance / memory
        const memory = window.performance && window.performance.memory ? {
          usedJSHeapSizeMB: Math.round(window.performance.memory.usedJSHeapSize / 1048576 * 10) / 10,
          totalJSHeapSizeMB: Math.round(window.performance.memory.totalJSHeapSize / 1048576 * 10) / 10
        } : null;

        return {
          title,
          navLinks,
          cardsCount: cards.length,
          tables,
          bpsMatches,
          pctMatchesCount: pctMatches.length,
          memory
        };
      })()`,
      returnByValue: true
    });

    console.log('[QA] Cockpit Inspection:', JSON.stringify(cockpitInspect.result.value, null, 2));

    const convergenceShot = await send('Page.captureScreenshot', { format: 'png' });
    const convergenceShotPath = path.join(ARTIFACT_DIR, 'cockpit_convergence_desktop.png');
    fs.writeFileSync(convergenceShotPath, Buffer.from(convergenceShot.data, 'base64'));
    console.log(`[QA] Saved convergence desktop screenshot: ${convergenceShotPath}`);

    // Capture Full Page of Convergence Cockpit
    const fullConvergenceShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const fullConvergenceShotPath = path.join(ARTIFACT_DIR, 'cockpit_convergence_fullpage.png');
    fs.writeFileSync(fullConvergenceShotPath, Buffer.from(fullConvergenceShot.data, 'base64'));
    console.log(`[QA] Saved convergence fullpage screenshot: ${fullConvergenceShotPath}`);

    // 4. Test Mobile Responsive Viewport (390 x 844, iPhone 14)
    console.log('[QA] Testing Mobile Responsive Viewport (390x844)...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      hasTouch: true
    });
    await delay(1500);

    // Inspect mobile elements & bottom dock
    const mobileInspect = await send('Runtime.evaluate', {
      expression: `(() => {
        const bottomDock = document.querySelector('div.fixed.bottom-0');
        let dockItems = [];
        let dockRect = null;
        if (bottomDock) {
          dockRect = bottomDock.getBoundingClientRect();
          dockItems = Array.from(bottomDock.querySelectorAll('a')).map(a => {
            const r = a.getBoundingClientRect();
            return {
              href: a.getAttribute('href'),
              text: a.innerText.trim(),
              width: r.width,
              height: r.height,
              top: r.top,
              left: r.left
            };
          });
        }

        const horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth;
        const scrollWidth = document.documentElement.scrollWidth;
        const innerWidth = window.innerWidth;

        return {
          hasBottomDock: !!bottomDock,
          dockRect,
          dockItems,
          horizontalOverflow,
          scrollWidth,
          innerWidth
        };
      })()`,
      returnByValue: true
    });

    console.log('[QA] Mobile Inspection:', JSON.stringify(mobileInspect.result.value, null, 2));

    const mobileConvergenceShot = await send('Page.captureScreenshot', { format: 'png' });
    const mobileConvergenceShotPath = path.join(ARTIFACT_DIR, 'cockpit_convergence_mobile.png');
    fs.writeFileSync(mobileConvergenceShotPath, Buffer.from(mobileConvergenceShot.data, 'base64'));
    console.log(`[QA] Saved mobile convergence screenshot: ${mobileConvergenceShotPath}`);

    // 5. Test Fleet Bots View (`/bot`)
    console.log('[QA] Testing /bot view...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', { url: 'http://localhost:3000/bot' });
    await delay(3500);

    const botShot = await send('Page.captureScreenshot', { format: 'png' });
    const botShotPath = path.join(ARTIFACT_DIR, 'cockpit_fleet_bots_desktop.png');
    fs.writeFileSync(botShotPath, Buffer.from(botShot.data, 'base64'));
    console.log(`[QA] Saved bot fleet desktop screenshot: ${botShotPath}`);

    // 6. SIMULATION: Verify insertion of /divergence into Navbar.tsx
    console.log('[QA] Simulating insertion of /divergence link in Desktop Navbar & Mobile Dock...');
    await send('Page.navigate', { url: 'http://localhost:3000/convergence' });
    await delay(2500);

    const simulationResult = await send('Runtime.evaluate', {
      expression: `(() => {
        // Find desktop nav container
        const desktopNavContainer = document.querySelector('nav .hidden.sm\\\\:flex');
        let desktopMetrics = {};
        if (desktopNavContainer) {
          const initialWidth = desktopNavContainer.getBoundingClientRect().width;
          const initialChildren = desktopNavContainer.children.length;

          // Clone Convergence link to simulate Divergence
          const divergenceLink = document.createElement('a');
          divergenceLink.href = '/divergence';
          divergenceLink.className = 'flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all text-accent-amber bg-zinc-800 border border-zinc-700 ring-1 ring-amber-500/20';
          divergenceLink.id = 'simulated-divergence-desktop';
          divergenceLink.innerHTML = '<svg class="w-3.5 h-3.5 text-accent-amber" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg><span>Divergence</span>';

          // Insert after Convergence (child index 1)
          if (desktopNavContainer.children.length > 1) {
            desktopNavContainer.insertBefore(divergenceLink, desktopNavContainer.children[2]);
          } else {
            desktopNavContainer.appendChild(divergenceLink);
          }

          const newWidth = desktopNavContainer.getBoundingClientRect().width;
          const navRow = document.querySelector('nav > div');
          const navRowOverflow = navRow ? navRow.scrollWidth > navRow.clientWidth : false;

          desktopMetrics = {
            initialWidth,
            newWidth,
            widthDelta: newWidth - initialWidth,
            initialChildren,
            newChildren: desktopNavContainer.children.length,
            navRowOverflow
          };
        }

        // Simulate on mobile bottom dock
        const bottomDock = document.querySelector('div.fixed.bottom-0');
        let mobileMetrics = {};
        if (bottomDock) {
          const initialItemCount = bottomDock.querySelectorAll('a').length;
          
          const mobileDivergence = document.createElement('a');
          mobileDivergence.href = '/divergence';
          mobileDivergence.className = 'flex flex-col items-center justify-center py-1 px-1.5 rounded-lg text-[10px] font-bold text-accent-amber min-h-[44px] min-w-[44px]';
          mobileDivergence.id = 'simulated-divergence-mobile';
          mobileDivergence.innerHTML = '<svg class="w-4 h-4 text-accent-amber" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg><span class="text-[9px] mt-0.5">Divergence</span>';

          if (bottomDock.children.length > 1) {
            bottomDock.insertBefore(mobileDivergence, bottomDock.children[2]);
          } else {
            bottomDock.appendChild(mobileDivergence);
          }

          const items = Array.from(bottomDock.querySelectorAll('a')).map(a => {
            const r = a.getBoundingClientRect();
            return {
              text: a.innerText.trim(),
              width: Math.round(r.width * 10) / 10,
              height: Math.round(r.height * 10) / 10,
              meetsWCAG44px: r.height >= 44 && r.width >= 44
            };
          });

          mobileMetrics = {
            initialItemCount,
            newItemCount: items.length,
            items
          };
        }

        return { desktopMetrics, mobileMetrics };
      })()`,
      returnByValue: true
    });

    console.log('[QA] Simulation Results:', JSON.stringify(simulationResult.result.value, null, 2));

    // Desktop screenshot with simulated divergence tab
    const desktopSimShot = await send('Page.captureScreenshot', { format: 'png' });
    const desktopSimShotPath = path.join(ARTIFACT_DIR, 'navbar_desktop_divergence_sim.png');
    fs.writeFileSync(desktopSimShotPath, Buffer.from(desktopSimShot.data, 'base64'));
    console.log(`[QA] Saved desktop nav simulation screenshot: ${desktopSimShotPath}`);

    // Mobile screenshot with simulated divergence bottom dock tab
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      hasTouch: true
    });
    await delay(1500);

    const mobileSimShot = await send('Page.captureScreenshot', { format: 'png' });
    const mobileSimShotPath = path.join(ARTIFACT_DIR, 'navbar_mobile_divergence_sim.png');
    fs.writeFileSync(mobileSimShotPath, Buffer.from(mobileSimShot.data, 'base64'));
    console.log(`[QA] Saved mobile dock simulation screenshot: ${mobileSimShotPath}`);

    // 7. Measure Continuous Polling Latency and Performance Impact (2,500ms intervals)
    console.log('[QA] Measuring API latencies and polling stress...');
    const timingEval = await send('Runtime.evaluate', {
      expression: `(async () => {
        const endpoints = [
          '/api/convergence/daemon',
          '/api/convergence/radar',
          '/api/convergence/audit'
        ];
        const results = [];
        for (const ep of endpoints) {
          const t0 = performance.now();
          try {
            const res = await fetch(ep, { cache: 'no-store' });
            const data = await res.json();
            const elapsed = Math.round((performance.now() - t0) * 10) / 10;
            results.push({
              endpoint: ep,
              status: res.status,
              latencyMs: elapsed,
              payloadBytes: JSON.stringify(data).length,
              ok: res.ok
            });
          } catch(e) {
            results.push({
              endpoint: ep,
              error: e.message,
              latencyMs: Math.round((performance.now() - t0) * 10) / 10
            });
          }
        }
        return results;
      })()`,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('[QA] Polling Endpoints Latency & Payload:', JSON.stringify(timingEval.result.value, null, 2));

    // Write complete QA data report
    const qaReportData = {
      timestamp: new Date().toISOString(),
      cockpitInspect: cockpitInspect.result.value,
      mobileInspect: mobileInspect.result.value,
      simulationResult: simulationResult.result.value,
      timingEval: timingEval.result.value,
      screenshots: [
        introShotPath,
        convergenceShotPath,
        fullConvergenceShotPath,
        mobileConvergenceShotPath,
        botShotPath,
        desktopSimShotPath,
        mobileSimShotPath
      ]
    };

    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'qa_manual_test_results.json'),
      JSON.stringify(qaReportData, null, 2)
    );
    console.log('[QA] Full QA test execution complete! Results saved.');

    ws.close();
  } catch (err) {
    console.error('[QA] Test runner failed with error:', err);
  } finally {
    try { chromeProc.kill(); } catch {}
  }
}

runQATest();
