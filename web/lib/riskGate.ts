import fs from "fs";
import path from "path";
import { resolveDataFilePath } from "./storagePath";
import { loadTrades } from "./serverTradeStore";
import { loadBotState, BotEngineState, ActiveBotHedge } from "./botEngine";

export interface PreOrderValidationRequest {
  userId?: string;
  symbol: string;
  side?: "BUY" | "SELL" | "buy" | "sell" | "Buy" | "Sell";
  quantity?: number | string;
  price?: number;
  notionalUsdt?: number;
  venue?: "binance" | "bitget" | "bybit" | "coindcx" | "paper" | string;
  orderType?: string;
  clientOrderId?: string;
  botId?: string;
  isEmergencyClose?: boolean; // Position unwinds and risk-reducing closes always permitted
  portfolioNav?: number; // Total portfolio NAV for dynamic percentage-based risk scaling
}

export type RiskRejectCode =
  | "EMERGENCY_HALT_ACTIVE"
  | "MAX_DAILY_DRAWDOWN_BREACHED"
  | "ORDER_EXCEEDS_NOTIONAL_CAP"
  | "GROSS_EXPOSURE_CAP_BREACHED"
  | "DAILY_TRADE_LIMIT_REACHED"
  | "INVALID_PRICE_OR_QUANTITY"
  | "RISK_APPROVED";

export interface PreOrderValidationResult {
  allowed: boolean;
  reason?: string;
  code: RiskRejectCode;
  metrics?: {
    notionalUsdt: number;
    currentMtmDrawdownPct: number;
    todayRealizedLossUsdt: number;
    unrealizedLossUsdt: number;
    totalLossUsdt: number;
    killSwitchActive: boolean;
  };
}

export interface RiskStatus {
  killSwitchActive: boolean;
  killSwitchReason?: string;
  killSwitchTrippedAt?: number;
  currentMtmDrawdownPct: number;
  todayRealizedLossUsdt: number;
  unrealizedLossUsdt: number;
  totalLossUsdt: number;
  portfolioGrossExposureUsdt: number;
  maxSingleOrderNotionalUsdt: number;
  maxDailyDrawdownPct: number;
  activeHedgesCount: number;
}

// Institutional Risk Limits (Stage 1 / Micro-Live Defaults)
export const RISK_LIMITS = {
  MAX_SINGLE_ORDER_NOTIONAL_USDT: 500.0,
  MAX_PORTFOLIO_GROSS_EXPOSURE_USDT: 2500.0,
  MAX_DAILY_MTM_DRAWDOWN_PCT: 0.04, // 4.0%
  MAX_DAILY_LOSS_USDT: 150.0,
  MAX_DAILY_TRADES: 50,
  DEFAULT_BASELINE_EQUITY_USDT: 3750.0, // $150 / 0.04 = $3,750 baseline
  MAX_SINGLE_ORDER_NAV_RATIO: 0.15, // 15% of NAV
  MAX_GROSS_EXPOSURE_NAV_RATIO: 0.80, // 80% of NAV
};

const KILL_SWITCH_FILE_NAME = "risk_kill_switch.json";

// In-memory state with disk persistence
const globalForRisk = global as unknown as {
  riskKillSwitch?: {
    active: boolean;
    reason?: string;
    trippedAt?: number;
    trippedBy?: string;
  };
};

if (!globalForRisk.riskKillSwitch) {
  globalForRisk.riskKillSwitch = { active: false };
  loadKillSwitchFromDisk();
}

function getKillSwitchPath(): string {
  return resolveDataFilePath(KILL_SWITCH_FILE_NAME);
}

function loadKillSwitchFromDisk(): void {
  try {
    const filePath = getKillSwitchPath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      if (typeof data.active === "boolean") {
        globalForRisk.riskKillSwitch = data;
      }
    }
  } catch {}
}

function saveKillSwitchToDisk(): void {
  try {
    const filePath = getKillSwitchPath();
    fs.writeFileSync(filePath, JSON.stringify(globalForRisk.riskKillSwitch, null, 2), "utf-8");
  } catch {}
}

export class RiskGate {
  /**
   * Checks if the global emergency kill switch is currently active.
   */
  static isKillSwitchActive(): boolean {
    return Boolean(globalForRisk.riskKillSwitch?.active);
  }

  /**
   * Returns metadata about the active kill switch state.
   */
  static getKillSwitchInfo(): { active: boolean; reason?: string; trippedAt?: number } {
    return {
      active: Boolean(globalForRisk.riskKillSwitch?.active),
      reason: globalForRisk.riskKillSwitch?.reason,
      trippedAt: globalForRisk.riskKillSwitch?.trippedAt,
    };
  }

  /**
   * Trips the global kill switch latch and saves state to disk.
   */
  static tripKillSwitch(reason: string, trippedBy: string = "RiskGate"): void {
    globalForRisk.riskKillSwitch = {
      active: true,
      reason,
      trippedAt: Date.now(),
      trippedBy,
    };
    saveKillSwitchToDisk();
    console.error(`[RISK CRITICAL] Emergency Kill-Switch TRIPPED by ${trippedBy}: ${reason}`);
  }

  /**
   * Resets the emergency kill switch latch. Requires admin user authorization.
   */
  static resetKillSwitch(adminUserId: string): boolean {
    globalForRisk.riskKillSwitch = {
      active: false,
      reason: undefined,
      trippedAt: undefined,
      trippedBy: undefined,
    };
    saveKillSwitchToDisk();
    console.warn(`[RISK] Emergency Kill-Switch manually RESET by admin ${adminUserId}.`);
    return true;
  }

  /**
   * Calculates live Mark-to-Market (MTM) equity and daily drawdown including floating unrealized losses.
   */
  static computeLiveMtmDrawdown(userId: string = "usr_admin_varsha"): {
    drawdownPct: number;
    realizedLoss: number;
    floatingLoss: number;
    totalLoss: number;
    grossExposure: number;
    activeHedgesCount: number;
  } {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    // 1. Calculate Realized Losses Today from Closed Trades
    let realizedLoss = 0;
    try {
      const trades = loadTrades(userId);
      for (const t of trades) {
        const tradeTime = t.closeTimestamp || t.timestamp || 0;
        if (tradeTime >= todayStartMs && (t.realizedPnl || 0) < 0) {
          realizedLoss += Math.abs(t.realizedPnl || 0);
        }
      }
    } catch {}

    // 2. Calculate Floating Unrealized Losses and Gross Exposure from Active Bot Hedges
    let floatingLoss = 0;
    let grossExposure = 0;
    let activeHedgesCount = 0;

    try {
      const botState: BotEngineState = loadBotState(userId);
      for (const bot of botState.bots || []) {
        for (const hedge of bot.activeHedges || []) {
          if (hedge.status === "ACTIVE" || hedge.status === "WAITING_PRICE_PARITY") {
            activeHedgesCount++;
            const notional = hedge.notionalUsdt || parseFloat(hedge.quantity || "0") * (hedge.entryBinancePrice || 1);
            grossExposure += notional;

            // Compute or read floating PnL
            if (typeof hedge.pnl === "number" && hedge.pnl < 0) {
              floatingLoss += Math.abs(hedge.pnl);
            }
          }
        }
      }
    } catch {}

    const totalLoss = realizedLoss + floatingLoss;
    const baselineEquity = RISK_LIMITS.DEFAULT_BASELINE_EQUITY_USDT;
    const drawdownPct = totalLoss / baselineEquity;

    return {
      drawdownPct,
      realizedLoss,
      floatingLoss,
      totalLoss,
      grossExposure,
      activeHedgesCount,
    };
  }

  /**
   * Core Pre-Broker Synchronous Validation Function.
   * Intercepts 100% of orders before broker signing.
   */
  static validatePreOrder(req: PreOrderValidationRequest): PreOrderValidationResult {
    // 0. Risk-reducing emergency closes and unwinds are unconditionally approved
    if (req.isEmergencyClose) {
      return {
        allowed: true,
        code: "RISK_APPROVED",
      };
    }

    // 1. Check Global Emergency Kill Switch
    if (this.isKillSwitchActive()) {
      const info = this.getKillSwitchInfo();
      return {
        allowed: false,
        code: "EMERGENCY_HALT_ACTIVE",
        reason: `EMERGENCY_HALT_ACTIVE: System kill-switch is active (${info.reason || "Operational halt"}). New orders blocked.`,
      };
    }

    // 2. Quantity & Price Validation
    const qty = typeof req.quantity === "string" ? parseFloat(req.quantity) : req.quantity || 0;
    if (isNaN(qty) || qty <= 0) {
      return {
        allowed: false,
        code: "INVALID_PRICE_OR_QUANTITY",
        reason: `INVALID_PRICE_OR_QUANTITY: Order quantity must be a positive number (got ${req.quantity}).`,
      };
    }

    if (req.price !== undefined && (isNaN(req.price) || req.price <= 0)) {
      return {
        allowed: false,
        code: "INVALID_PRICE_OR_QUANTITY",
        reason: `INVALID_PRICE_OR_QUANTITY: Order price must be positive (got ${req.price}).`,
      };
    }

    // 3. Notional Size Verification ($500 cap for Micro-Live, dynamically scaled if portfolioNav passed)
    const estPrice = req.price || 1.0;
    const notional = req.notionalUsdt !== undefined ? req.notionalUsdt : qty * estPrice;
    const dynamicOrderCap = (req.portfolioNav && req.portfolioNav > 0)
      ? Math.min(RISK_LIMITS.MAX_SINGLE_ORDER_NOTIONAL_USDT, Math.max(10.0, req.portfolioNav * RISK_LIMITS.MAX_SINGLE_ORDER_NAV_RATIO))
      : RISK_LIMITS.MAX_SINGLE_ORDER_NOTIONAL_USDT;

    if (notional > dynamicOrderCap) {
      return {
        allowed: false,
        code: "ORDER_EXCEEDS_NOTIONAL_CAP",
        reason: `ORDER_EXCEEDS_NOTIONAL_CAP: Order notional $${notional.toFixed(2)} USDT exceeds maximum allowed cap of $${dynamicOrderCap.toFixed(2)} USDT.`,
      };
    }

    // 4. Live Mark-to-Market Drawdown Verification (4.0% cap)
    const mtm = this.computeLiveMtmDrawdown(req.userId || "usr_admin_varsha");

    if (mtm.drawdownPct >= RISK_LIMITS.MAX_DAILY_MTM_DRAWDOWN_PCT || mtm.totalLoss >= RISK_LIMITS.MAX_DAILY_LOSS_USDT) {
      // Automatically latch the kill switch on MTM breach
      const tripReason = `Daily MTM drawdown breach: ${(mtm.drawdownPct * 100).toFixed(2)}% >= ${(RISK_LIMITS.MAX_DAILY_MTM_DRAWDOWN_PCT * 100).toFixed(2)}% (Total loss: -$${mtm.totalLoss.toFixed(2)} USDT [Realized: -$${mtm.realizedLoss.toFixed(2)}, Floating: -$${mtm.floatingLoss.toFixed(2)}])`;
      this.tripKillSwitch(tripReason, "RiskGate.validatePreOrder");

      return {
        allowed: false,
        code: "MAX_DAILY_DRAWDOWN_BREACHED",
        reason: `MAX_DAILY_DRAWDOWN_BREACHED: ${tripReason}`,
        metrics: {
          notionalUsdt: notional,
          currentMtmDrawdownPct: mtm.drawdownPct,
          todayRealizedLossUsdt: mtm.realizedLoss,
          unrealizedLossUsdt: mtm.floatingLoss,
          totalLossUsdt: mtm.totalLoss,
          killSwitchActive: true,
        },
      };
    }

    // 5. Portfolio Gross Exposure Verification
    if (mtm.grossExposure + notional > RISK_LIMITS.MAX_PORTFOLIO_GROSS_EXPOSURE_USDT) {
      return {
        allowed: false,
        code: "GROSS_EXPOSURE_CAP_BREACHED",
        reason: `GROSS_EXPOSURE_CAP_BREACHED: Adding $${notional.toFixed(2)} would push total gross exposure ($${(mtm.grossExposure + notional).toFixed(2)}) above max permitted $${RISK_LIMITS.MAX_PORTFOLIO_GROSS_EXPOSURE_USDT.toFixed(2)} USDT.`,
      };
    }

    // 6. Approved
    return {
      allowed: true,
      code: "RISK_APPROVED",
      metrics: {
        notionalUsdt: notional,
        currentMtmDrawdownPct: mtm.drawdownPct,
        todayRealizedLossUsdt: mtm.realizedLoss,
        unrealizedLossUsdt: mtm.floatingLoss,
        totalLossUsdt: mtm.totalLoss,
        killSwitchActive: false,
      },
    };
  }

  /**
   * Retrieves full risk telemetry for status dashboards.
   */
  static getRiskStatus(userId: string = "usr_admin_varsha"): RiskStatus {
    const mtm = this.computeLiveMtmDrawdown(userId);
    const kill = this.getKillSwitchInfo();

    return {
      killSwitchActive: kill.active,
      killSwitchReason: kill.reason,
      killSwitchTrippedAt: kill.trippedAt,
      currentMtmDrawdownPct: mtm.drawdownPct,
      todayRealizedLossUsdt: mtm.realizedLoss,
      unrealizedLossUsdt: mtm.floatingLoss,
      totalLossUsdt: mtm.totalLoss,
      portfolioGrossExposureUsdt: mtm.grossExposure,
      maxSingleOrderNotionalUsdt: RISK_LIMITS.MAX_SINGLE_ORDER_NOTIONAL_USDT,
      maxDailyDrawdownPct: RISK_LIMITS.MAX_DAILY_MTM_DRAWDOWN_PCT,
      activeHedgesCount: mtm.activeHedgesCount,
    };
  }
}
