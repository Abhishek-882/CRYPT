# AI Hedge — Autonomous Funding Rate Arbitrage Cockpit

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)
[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](https://opensource.org/licenses/MIT)
[![Next.js 14](https://img.shields.io/badge/Next.js-14.2-black)](https://nextjs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-WebGL-049EF4)](https://threejs.org/)
[![Delta-Neutral](https://img.shields.io/badge/Delta--Neutral-100%25-emerald)](https://binance.com)

A high-frequency, delta-neutral crypto funding rate arbitrage platform connecting **Binance USD-M Futures** (Leg 1) and **Bitget Perpetuals** (Leg 2), powered by **Dual-Stream WebSockets**, **Aggressive Fill Chase** leg-out protection, and a real-time **Three.js 3D Prismatic Visualizer**.

---

## Key Features

- **Sub-250ms Dual WebSockets**: Direct in-browser WebSocket connections to Binance (`wss://fstream.binance.com`) and Bitget (`wss://ws.bitget.com`) computing live basis spread and annualized APY in real time.
- **24/7 Autonomous Autopilot Engine**: Continuous background state machine that automatically opens dual hedges when the basis spread expands ($\ge 12\text{ bps}$) and dual-closes upon spread convergence ($\le 2\text{ bps}$).
- **Aggressive Fill Chase Circuit Breaker**: If Leg 2 fails on Bitget, the engine executes up to 3 rapid Taker retries within $1.5\text{s}$. If all retries fail, it triggers an instant emergency market unwind on Leg 1 to eliminate unhedged directional exposure.
- **Client-Side Session Vault**: Zero server-side key storage. API keys, secrets, and passphrases are stored strictly in the operator's browser session (`localStorage`) and forwarded via encrypted HTTPS request headers.
- **Three.js 3D Prismatic Core**: Interactive WebGL crystal visualization reflecting live basis spread expansion, particle ring orbits, and inspectable 360° turntable.

---

## Live Hedging Benchmark Results

Verified live against exchange matching engines:
```
==========================================================================================
  [*] PURE HEDGING BENCHMARK & SIMULTANEOUS DUAL-CLOSE SUITE
  Testing: Inter-Leg Latency Delta & Zero-Loss Delta Neutrality Proof
==========================================================================================
  [Clock Sync] Calibrated server time offset: +633,115 ms
  [Live Reference] BTCUSDT Mark Price: $86,430.90

  [PHASE 1] CONCURRENT DUAL ENTRY (Parallel Dispatch)
  Position Size : 0.005 BTC (Notional: ~$432.15)
  Leg 1 (Binance Testnet) : BUY (LONG)   @ $86,391.00 (Dispatch: 237.3ms)
  Leg 2 (Bitget Mirror)   : SELL (SHORT) @ $86,426.58 (Dispatch: 22.2ms)
  Inter-Leg Network Delta : 215.17 ms
  Hedge Delta Status      : NET ZERO (0.000 BTC unhedged exposure)

  [PHASE 2] HOLDING & DELTA STABILITY
  BTC Market Shift during hold : -$131.90 drop

  [PHASE 3] SIMULTANEOUS DUAL-CLOSE (AT ONCE)
  Leg 1 Exit (SELL) : $86,429.40 | PnL: +$0.1920 USDT
  Leg 2 Exit (BUY)  : $86,263.41 | PnL: +$0.8158 USDT
  Simultaneous Close Duration: 932.08 ms

  NET DIRECTIONAL RISK PnL: +$1.0078 USDT (100% Delta Hedged)
```

---

## 1-Click Deployment on Render

This repository is pre-configured with [`render.yaml`](./render.yaml) for Render's Free Web Service tier:

### Option A: Via Render Blueprint (Recommended)
1. Fork or push this repository to your GitHub account.
2. In [Render Dashboard](https://dashboard.render.com/), click **New +** $\to$ **Blueprint**.
3. Select this repository. Render will automatically detect `render.yaml`, configure `web/` as root, install dependencies, and launch the service.

### Option B: Manual Web Service Setup
- **Environment**: Node
- **Root Directory**: `web`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Plan**: Free

---

## Local Development Setup

```bash
# 1. Clone repository
git clone https://github.com/Abhishek-882/Ai_hedge.git
cd Ai_hedge

# 2. Navigate to web directory
cd web

# 3. Install dependencies
npm install

# 4. Start local development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the cockpit.

---

## Project Structure

```
Ai_hedge/
├── render.yaml                     # Render Blueprint specification
├── package.json                    # Root build runner
├── requirements.txt                # Python benchmark dependencies
├── README.md                       # Documentation & guide
├── web/                            # Next.js 14 Full-Stack Application
│   ├── app/
│   │   ├── page.tsx                # Cockpit Dashboard & Autopilot Runner
│   │   └── api/
│   │       ├── account/            # Binance Account Proxy
│   │       ├── bitget/             # Bitget V2/V3 Account & Order Proxies
│   │       ├── hedge/              # Concurrent Parallel Hedge Dispatch
│   │       ├── close/              # Simultaneous Dual-Close
│   │       └── ticker/             # Basis Spread Calculator
│   ├── components/
│   │   ├── PrismaticCore3D.tsx     # Three.js WebGL Visualization
│   │   ├── ControlCockpit.tsx      # Autopilot Controls & Manual Execution
│   │   ├── SettingsModal.tsx       # Client-Side Session Vault
│   │   ├── TelemetryHUD.tsx        # Funding Countdown & Clock Calibration
│   │   ├── SpreadTracker.tsx       # Cross-Exchange Basis Comparison
│   │   └── PositionsTable.tsx      # Open Positions Tracker
│   ├── hooks/
│   │   └── useDualExchangeWebSockets.ts # Binance + Bitget WebSockets
│   └── lib/
│       ├── binanceSigner.ts        # Binance HMAC Signer & Dual Testnet
│       ├── bitgetSigner.ts         # Bitget V2/V3 Signer & Fill Chase
│       └── arbitrageEngine.ts      # Deterministic State Machine
└── scripts/
    ├── demo_hedge_latency_test.py  # Dual-leg latency profiler
    └── live_binance_testnet_trader.py # Binance testnet CLI verification
```

---

## Security Invariants

1. **Zero Server Key Retention**: API keys and secrets are never committed to git, logged to stdout, or saved in server databases.
2. **IP Whitelisting**: Bound IP addresses prevent unauthorized API invocation.
3. **Withdrawal Lockdown**: The bot operates strictly with trade/read permissions. Withdrawal capabilities must remain disabled.

---

## License

MIT © 2026 Abhishek
