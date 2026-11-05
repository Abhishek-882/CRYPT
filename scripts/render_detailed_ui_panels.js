const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const artDir = 'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\96e9bf14-d4f9-4915-964a-9c7503f3cf5d';

// Panel 1: Multi-Bot Fleet & Configuration Settings (Showing up to 10 bots, bps spread, 0.05% parity)
const configHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1400px;
    height: 900px;
    background: #090D16;
    color: #F8FAFC;
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
    padding: 30px 40px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .header-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-b: 1px solid #1E293B;
    padding-bottom: 20px;
    border-bottom: 1px solid #1E293B;
  }
  .title-group h2 { font-size: 24px; font-weight: 700; color: #FFFFFF; }
  .title-group p { font-size: 13px; color: #94A3B8; margin-top: 4px; }
  .fleet-badge {
    background: rgba(6, 182, 212, 0.15);
    border: 1px solid #06B6D4;
    color: #38BDF8;
    padding: 6px 16px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
  }
  .fleet-selector {
    display: flex;
    gap: 15px;
    margin: 20px 0;
  }
  .fleet-card {
    flex: 1;
    background: #111827;
    border: 1px solid #1F2937;
    border-radius: 10px;
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .fleet-card.active {
    background: rgba(16, 185, 129, 0.08);
    border-color: #10B981;
  }
  .fleet-name { font-size: 15px; font-weight: 700; color: #FFFFFF; }
  .fleet-sub { font-size: 11px; color: #94A3B8; margin-top: 2px; }
  .status-pill {
    font-size: 10px;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 4px;
    background: rgba(16, 185, 129, 0.2);
    color: #34D399;
    border: 1px solid #10B981;
  }
  .grid-form {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
    background: #111827;
    border: 1px solid #1F2937;
    border-radius: 12px;
    padding: 24px;
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .form-group label {
    font-size: 12px;
    font-weight: 700;
    color: #38BDF8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .form-control {
    background: #090D16;
    border: 1px solid #374151;
    border-radius: 8px;
    padding: 12px 16px;
    color: #F8FAFC;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .form-help {
    font-size: 11px;
    color: #9CA3AF;
    line-height: 1.35;
  }
  .slider-bar {
    width: 100%;
    height: 8px;
    background: #1F2937;
    border-radius: 4px;
    position: relative;
    margin: 8px 0;
  }
  .slider-fill {
    width: 60%;
    height: 100%;
    background: #10B981;
    border-radius: 4px;
  }
  .save-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #162032;
    border: 1px solid #10B981;
    border-radius: 10px;
    padding: 16px 24px;
    margin-top: 15px;
  }
  .btn-primary {
    background: #10B981;
    color: #FFFFFF;
    font-weight: 700;
    padding: 10px 24px;
    border-radius: 6px;
    font-size: 13px;
    border: none;
    cursor: pointer;
  }
  .btn-cyan {
    background: #06B6D4;
    color: #FFFFFF;
    font-weight: 700;
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 13px;
    border: none;
  }
</style>
</head>
<body>
  <div class="header-bar">
    <div class="title-group">
      <h2>MULTI-BOT FLEET MANAGER & STRATEGY ENGINE</h2>
      <p>Configure parallel execution capacity, parity tolerance gates, and risk allocation.</p>
    </div>
    <div class="fleet-badge">PARALLEL FLEET CAPACITY: UP TO 10 ACTIVE BOTS</div>
  </div>

  <div class="fleet-selector">
    <div class="fleet-card active">
      <div>
        <div class="fleet-name">Bot #1 — Top-Tier Funding Sniper</div>
        <div class="fleet-sub">Active Preset: conservative_5bps_sniper.set</div>
      </div>
      <div class="status-pill">ACTIVE AUTOPILOT (24/7)</div>
    </div>
    <div class="fleet-card">
      <div>
        <div class="fleet-name">Bot #2 — High-Momentum Altcoin Desk</div>
        <div class="fleet-sub">Active Preset: balanced_10bps_harvest.set</div>
      </div>
      <div class="status-pill" style="background:rgba(56,189,248,0.2); border-color:#06B6D4; color:#38BDF8;">STANDBY PARALLEL</div>
    </div>
    <div class="fleet-card">
      <div>
        <div class="fleet-name">Bot #3 — Continuous Yield Engine</div>
        <div class="fleet-sub">Active Preset: continuous_spread_247.set</div>
      </div>
      <div class="status-pill" style="background:rgba(245,158,11,0.2); border-color:#F59E0B; color:#FBBF24;">STANDBY PARALLEL</div>
    </div>
  </div>

  <div class="grid-form">
    <div class="form-group">
      <label>1. Maximum Simultaneous Parallel Hedges</label>
      <div class="form-control">
        <span>Parallel Position Capacity</span>
        <span style="color:#34D399; font-size:16px;">6 Simultaneous Bots</span>
      </div>
      <div class="slider-bar"><div class="slider-fill"></div></div>
      <div class="form-help">Scales execution across 1 to 10 pairs concurrently without cross-contamination.</div>
    </div>

    <div class="form-group">
      <label>2. Minimum Gross Spread Threshold</label>
      <div class="form-control">
        <span>Minimum Funding Rate Delta</span>
        <span style="color:#38BDF8; font-size:16px;">5.0 bps (0.050%)</span>
      </div>
      <div class="form-help">The engine ignores opportunities below this cutoff to guarantee yields exceed fees.</div>
    </div>

    <div class="form-group">
      <label>3. Price Parity Tolerance Gate (Basis Drag Protection)</label>
      <div class="form-control" style="border-color:#10B981;">
        <span>Max Price Divergence Allowed</span>
        <span style="color:#34D399; font-size:16px;">0.050% Strict Gate</span>
      </div>
      <div class="form-help">Strictly blocks trade dispatch if spot prices deviate &gt;0.05%, preventing entry basis losses.</div>
    </div>

    <div class="form-group">
      <label>4. Execution Corridor & Margin Cap</label>
      <div class="form-control">
        <span>Tier-1 Exchange Pairing</span>
        <span style="color:#FBBF24; font-size:14px;">CoinDCX Domestic + Bybit Global</span>
      </div>
      <div class="form-help">Maximum 50% margin allocation cap. 50% liquid cash cushion permanently preserved.</div>
    </div>
  </div>

  <div class="save-bar">
    <div>
      <div style="font-weight:700; color:#FFFFFF; font-size:14px;">SAVE CURRENT PARAMETERS TO REUSABLE .SET FILE</div>
      <div style="font-size:11.5px; color:#94A3B8; margin-top:2px;">Export or restore strategy configurations with one click.</div>
    </div>
    <div style="display:flex; gap:12px;">
      <button class="btn-cyan">Open Presets Library (.set)</button>
      <button class="btn-primary">Save as New .SET File</button>
    </div>
  </div>
</body>
</html>
`;

// Panel 2: Save Set File Modal & Presets Library Manager
const setModalHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1400px;
    height: 900px;
    background: #090D16;
    color: #F8FAFC;
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
    padding: 30px 40px;
    display: flex;
    gap: 30px;
  }
  .modal-box {
    flex: 1;
    background: #111827;
    border: 1px solid #1F2937;
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .modal-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #1F2937;
    padding-bottom: 16px;
    margin-bottom: 20px;
  }
  .modal-title h3 { font-size: 16px; font-weight: 700; color: #FFFFFF; }
  .preset-item {
    background: #090D16;
    border: 1px solid #1F2937;
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .preset-item.active {
    border-color: #10B981;
    background: rgba(16, 185, 129, 0.05);
  }
  .preset-name { font-size: 14px; font-weight: 700; color: #FFFFFF; }
  .preset-desc { font-size: 11.5px; color: #9CA3AF; margin-top: 3px; }
  .badge-built {
    font-size: 10px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 4px;
    background: #1E293B;
    color: #38BDF8;
    border: 1px solid #334155;
  }
  .form-group { margin-bottom: 16px; }
  .form-group label { font-size: 11.5px; font-weight: 700; color: #38BDF8; display: block; margin-bottom: 6px; }
  .form-input {
    width: 100%;
    background: #090D16;
    border: 1px solid #374151;
    border-radius: 6px;
    padding: 10px 14px;
    color: #FFFFFF;
    font-size: 13px;
  }
  .btn-submit {
    background: #06B6D4;
    color: #FFFFFF;
    font-weight: 700;
    padding: 12px 20px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    width: 100%;
    font-size: 14px;
    margin-top: 10px;
  }
</style>
</head>
<body>
  <!-- Left Box: Presets Library Manager -->
  <div class="modal-box">
    <div>
      <div class="modal-title">
        <h3>STRATEGY PRESETS LIBRARY (.SET)</h3>
        <span style="font-size:11px; color:#10B981; font-weight:700;">INSTITUTIONAL SUITE</span>
      </div>

      <div class="preset-item active">
        <div>
          <div style="display:flex; gap:10px; align-items:center;">
            <div class="preset-name">Conservative 5 bps Sniper</div>
            <span class="badge-built">Built-in Preset</span>
          </div>
          <div class="preset-desc">File: conservative_5bps_sniper.set  •  Strict 0.03% price parity  •  10x Leverage  •  Top-Tier pairs only.</div>
        </div>
        <span style="color:#10B981; font-size:12px; font-weight:700;">ACTIVE</span>
      </div>

      <div class="preset-item">
        <div>
          <div style="display:flex; gap:10px; align-items:center;">
            <div class="preset-name">Balanced 10 bps Harvest</div>
            <span class="badge-built">Built-in Preset</span>
          </div>
          <div class="preset-desc">File: balanced_10bps_harvest.set  •  0.05% parity tolerance  •  10x Leverage  •  Standard liquidity divergence.</div>
        </div>
        <button style="background:#1E293B; border:1px solid #374151; color:#F8FAFC; padding:5px 12px; border-radius:4px; font-size:11px; cursor:pointer;">Load Preset</button>
      </div>

      <div class="preset-item">
        <div>
          <div style="display:flex; gap:10px; align-items:center;">
            <div class="preset-name">Continuous 24/7 Spread Engine</div>
            <span class="badge-built">Built-in Preset</span>
          </div>
          <div class="preset-desc">File: continuous_spread_247.set  •  24/7 continuous spread harvesting without settlement freeze.</div>
        </div>
        <button style="background:#1E293B; border:1px solid #374151; color:#F8FAFC; padding:5px 12px; border-radius:4px; font-size:11px; cursor:pointer;">Load Preset</button>
      </div>
    </div>
    <div style="border-top:1px solid #1F2937; padding-top:14px; font-size:11px; color:#9CA3AF;">
      Loaded set files automatically configure all mathematical risk limits, parity clamps, and margin sizes with 1 click.
    </div>
  </div>

  <!-- Right Box: Save Custom Set File Modal -->
  <div class="modal-box">
    <div>
      <div class="modal-title">
        <h3>SAVE STRATEGY SET FILE (.SET)</h3>
        <span style="font-size:11px; color:#38BDF8; font-weight:700;">CUSTOM EXPORT</span>
      </div>

      <div class="form-group">
        <label>FILE NAME (.set)</label>
        <input class="form-input" value="client_institutional_profile_10bps.set" readonly>
      </div>

      <div class="form-group">
        <label>DISPLAY NAME</label>
        <input class="form-input" value="Client Institutional Profile (10 bps Parity)" readonly>
      </div>

      <div class="form-group">
        <label>STRATEGY DESCRIPTION</label>
        <textarea class="form-input" rows="3" readonly style="resize:none;">Tailored for client accounts deploying $10,000 margin. Enforces 0.05% parity gate with 6 parallel bot capacity across Tier-1 corridors.</textarea>
      </div>

      <div style="background:#090D16; border:1px solid #1F2937; border-radius:6px; padding:12px; font-size:11.5px; color:#34D399; margin-top:15px;">
        ✓ Includes all 12 parameters: Min Spread, Parity Clamps, Leverage Mode, Corridor Routing, and Timing Countdown.
      </div>
    </div>

    <div>
      <button class="btn-submit">Export & Save Strategy Set File (.set)</button>
    </div>
  </div>
</body>
</html>
`;

const temp1 = path.join(artDir, 'temp_config_view.html');
const temp2 = path.join(artDir, 'temp_modal_view.html');
const shot1 = path.join(artDir, 'ui_bot_config_detailed.png');
const shot2 = path.join(artDir, 'ui_set_presets_modal.png');

fs.writeFileSync(temp1, configHtml, 'utf8');
fs.writeFileSync(temp2, setModalHtml, 'utf8');

console.log('Rendering ui_bot_config_detailed.png...');
spawnSync(edgePath, [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  '--window-size=1400,900',
  '--hide-scrollbars',
  `--screenshot=${shot1}`,
  `file:///${temp1.replace(/\\/g, '/')}`
], { stdio: 'pipe' });

console.log('Rendering ui_set_presets_modal.png...');
spawnSync(edgePath, [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  '--window-size=1400,900',
  '--hide-scrollbars',
  `--screenshot=${shot2}`,
  `file:///${temp2.replace(/\\/g, '/')}`
], { stdio: 'pipe' });

if (fs.existsSync(temp1)) fs.unlinkSync(temp1);
if (fs.existsSync(temp2)) fs.unlinkSync(temp2);

console.log('Config shot:', fs.existsSync(shot1) ? `${(fs.statSync(shot1).size / 1024).toFixed(1)} KB` : 'fail');
console.log('Set modal shot:', fs.existsSync(shot2) ? `${(fs.statSync(shot2).size / 1024).toFixed(1)} KB` : 'fail');
