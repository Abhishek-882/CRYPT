# Project: STATARB-OU-PERP Live On-Exchange Execution Transition

## Architecture
Cross-Exchange Statistical Arbitrage & Ornstein-Uhlenbeck Convergence Sweeper between Binance USD-M Perpetuals and Bybit Linear Perpetuals transitioning from simulated execution to 100% live on-exchange trading.

```
                    ┌────────────────────────────┐
                    │      StatArbEngine         │
                    │  (Corridor Scanner & PnL)  │
                    └─────────────┬──────────────┘
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
       ┌──────────────────────┐        ┌──────────────────────┐
       │   zScoreEngine.ts    │        │   exitOptimizer.ts   │
       │ (Gates 1-5, Edge>0.08%)       │ (Hurdle >= +$0.0100) │
       └──────────────────────┘        └──────────────────────┘
                  │                               │
                  └───────────────┬───────────────┘
                                  ▼
                    ┌────────────────────────────┐
                    │   MakerTakerOrderRouter    │
                    │  (normalizeQuantity, 120ms │
                    │   adverse drift watchdog)  │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │    LiveExchangeAdapter     │
                    │ (ExchangeExecutionAdapter) │
                    └──────┬──────────────┬──────┘
                           │              │
           Leg 1 Post-Only │              │ Leg 2 IOC Taker
           Maker Limit     │              │ (Sub-35ms WS)
                           ▼              ▼
                    ┌────────────┐  ┌────────────┐
                    │  Binance   │  │   Bybit    │
                    │   USD-M    │  │   Linear   │
                    └────────────┘  └────────────┘
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Exchange Filter Registry | Dedicated module with tickSize, stepSize, minQty, and minNotional ($5.00 USDT) per pair with in-memory caching and offline fallbacks | M1 | Survey 1 |
| 2 | Contract Multiplier Normalization | Enforce contract multiplier scaling in `normalizeQuantity()` and wire into `orderRouter.ts` Leg 2 IOC taker sizing | M1 | Survey 1, 3 |
| 3 | Normalized Delta-Neutrality Invariant | Multiplier-aware `checkZeroOrphanInvariant` ensuring \|Delta_net\| < 0.001 in normalized base tokens | M1 | Survey 1 |
| 4 | Asymmetric Multiplier PnL Fix | Normalize price differences and quantities in `statArbEngine.ts` and `exitOptimizer.ts` for pairs like SATS (10x) and TURBO (1000x) | M1 | Survey 1, 3 |
| 5 | LiveExchangeAdapter Core | Implementation of `ExchangeExecutionAdapter` (5 methods) loading credentials for `usr_admin_varsha` via `cryptoVault` | M2 | Survey 2 |
| 6 | Leg 1 Post-Only Maker Limit | Binance GTX & Bybit PostOnly limit orders with micro-repricing on book-cross (-2010 / 110007), 8s watchdog, and 120ms adverse drift cancel | M2 | Survey 2 |
| 7 | Leg 2 High-Speed WS IOC Taker | Sub-35ms IOC taker via `binanceTradeStream` / `bybitTradeStream` with 500ms watchdog circuit breaker fallback to signed REST | M2 | Survey 2 |
| 8 | Emergency Market Unwind Guard | Market unwind with `reduceOnly: true` on Leg 1 if Leg 2 fails on both WS and REST, eliminating orphan legs | M2 | Survey 2 |
| 9 | Gate 5 Pre-Flight Net-Edge Enforcement | Gross spread hurdle > 0.080% (covering 0.020% Binance Maker + 0.055% Bybit Taker + slippage buffer) wired into default configs and radar route | M3 | Survey 3 |
| 10 | Exit Optimizer Zero-Loss Hurdle | Mandatory net profit hurdle >= +$0.0100 USDT after deducting roundtrip fees; Invariant 6 (30m persistence breaker) & Invariant 7 (sticky decoupling) | M3 | Survey 3 |
| 11 | Telemetry Integrity & Mock Data Purge | Purge synthetic seed positions (`arb_pepe_fill_101`, etc.) and fake `latencySeed` from `audit/route.ts`; bind telemetry to genuine on-exchange fills | M3 | Survey 3 |
| 12 | Text & Symbol Hygiene | Purge legacy basis bot references and convert all display spreads/gaps from raw "bps" to formatted "%" | M3 | Survey 3 |
| 13 | Engine Integration & Live Daemon Route | Wire `LiveExchangeAdapter` into `StatArbEngine` and `daemon/route.ts` when `dryRun: false` | M4 | Survey 2, 3 |
| 14 | Comprehensive Verification Suite & Clean Build | Vitest tests for normalization, filters, Gate 5, live adapter; Clean Next.js build (`npm run build`) with 0 errors | M5 | Survey 1, 2, 3 |
| 15 | Adversarial Hardening & Forensic Audit | Challenger empirical stress testing and Forensic Auditor integrity verification (zero cheating/facades) | M5 | Requirements |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Multiplier Normalization & Exchange Filters | `exchangeFilterRegistry.ts`, `contractMapper.ts`, `orderRouter.ts` sizing, `invariantGuard.ts`, PnL calculations | none | PLANNED |
| M2 | LiveExchangeAdapter & WS Routing | `liveExchangeAdapter.ts`, credential loading, GTX/PostOnly Maker, sub-35ms WS IOC Taker, emergency unwind | M1 | PLANNED |
| M3 | Zero-Loss Gate 5, Net Exit Hurdle & Telemetry Purge | `zScoreEngine.ts`, `DEFAULT_STATARB_CONFIG`, `exitOptimizer.ts`, `audit/route.ts` mock purge, % formatting | M1 | PLANNED |
| M4 | Engine Integration & Route Wiring | `statArbEngine.ts`, `daemon/route.ts` (`dryRun: false` wiring) | M2, M3 | PLANNED |
| M5 | Verification, Clean Build & Forensic Audit | Unit tests in `tests/unit/statarb/`, `npm run build`, Challenger stress tests, Forensic Integrity Audit | M4 | PLANNED |

## Interface Contracts

### ExchangeFilterRegistry ↔ OrderRouter & Engine
```typescript
export interface SymbolFilterSpec {
  symbol: string;
  venue: 'BINANCE' | 'BYBIT';
  tickSize: number;
  stepSize: number;
  minQty: number;
  minNotional: number; // e.g. 5.0 USDT
  priceDecimals: number;
  qtyDecimals: number;
}

export function getSymbolFilter(venue: 'BINANCE' | 'BYBIT', symbol: string): SymbolFilterSpec;
export function roundPrice(price: number, tickSize: number, side: 'BUY' | 'SELL'): number;
export function roundQuantity(qty: number, stepSize: number): number;
export function reconcileDualLegQuantities(
  targetNotional: number,
  price1: number,
  price2: number,
  venue1: 'BINANCE' | 'BYBIT',
  venue2: 'BINANCE' | 'BYBIT',
  canonical: string
): {
  valid: boolean;
  leg1Qty: number;
  leg2Qty: number;
  leg1Notional: number;
  leg2Notional: number;
  rejectionReason?: string;
};
```

### LiveExchangeAdapter ↔ OrderRouter
```typescript
export interface ExchangeExecutionAdapter {
  placeMakerLimit(
    venue: ExchangeVenue,
    symbol: string,
    side: OrderSide,
    price: number,
    qty: number,
    clientOrderId: string,
    timeInForce: 'GTX' | 'PostOnly'
  ): Promise<{ orderId: string; status: 'NEW' | 'REJECTED'; rejectReason?: string }>;

  cancelOrder(
    venue: ExchangeVenue,
    symbol: string,
    orderId: string,
    clientOrderId: string
  ): Promise<{ success: boolean; executedQty: number }>;

  pollOrderStatus(
    venue: ExchangeVenue,
    symbol: string,
    orderId: string,
    clientOrderId: string
  ): Promise<{ status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED'; executedQty: number; avgPrice: number }>;

  placeTakerIoc(
    venue: ExchangeVenue,
    symbol: string,
    side: OrderSide,
    qty: number,
    clientOrderId: string,
    useWebSocket: boolean,
    expectedPrice?: number
  ): Promise<{ orderId: string; executedQty: number; avgPrice: number; feeUsdt: number; latencyMs: number }>;

  emergencyMarketUnwind(
    venue: ExchangeVenue,
    symbol: string,
    side: OrderSide,
    qty: number
  ): Promise<{ success: boolean; executedQty: number; avgPrice: number }>;
}
```

## Code Layout
- `web/lib/statarb/utils/exchangeFilterRegistry.ts` — Exchange filter definitions, tick/step rounding, dual-leg lot reconciliation
- `web/lib/statarb/utils/contractMapper.ts` — Multiplier normalization and symbol mapping
- `web/lib/statarb/execution/liveExchangeAdapter.ts` — Live on-exchange execution adapter (Binance USD-M & Bybit Linear)
- `web/lib/statarb/execution/orderRouter.ts` — Order routing, 120ms adverse drift checks, micro-repricing, normalized Leg 2 sizing
- `web/lib/statarb/execution/exitOptimizer.ts` — Minimum profit hurdle (>= +$0.0100 USDT) and net PnL evaluation
- `web/lib/statarb/execution/invariantGuard.ts` — Invariants 4, 6, 7 and normalized delta-neutrality invariant (|Delta_net| < 0.001)
- `web/lib/statarb/math/zScoreEngine.ts` — Gates 1-5 evaluation with `minNetEdgeBps: 8.0` (0.080%)
- `web/lib/statarb/engine/statArbEngine.ts` — Sizing, corridor scanning, position lifecycle, `dryRun` handling
- `web/app/api/convergence/daemon/route.ts` — Live daemon route integrating `LiveExchangeAdapter` when `dryRun: false`
- `web/app/api/convergence/audit/route.ts` — Clean audit route purged of mock seed data
- `web/components/convergence/` — User-facing UI formatted with `%` (zero "bps")
- `web/tests/unit/statarb/` — Unit and integration tests
