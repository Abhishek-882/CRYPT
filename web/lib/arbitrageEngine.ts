export type ArbitrageState =
  | "IDLE_SCANNING"
  | "ENTERING_HEDGE"
  | "HEDGED_MONITORING"
  | "CLOSING_HEDGE"
  | "COOLDOWN"
  | "CIRCUIT_BREAKER_TRIPPED";

export interface ArbitrageConfig {
  enabled: boolean;
  minSpreadEntryBps: number; // e.g. 10 bps
  exitSpreadTargetBps: number; // e.g. 2 bps
  positionSizeBtc: number; // e.g. 0.005 BTC
  maxSlippageBps: number; // e.g. 5 bps
  cooldownPeriodSec: number; // e.g. 30 sec
}

export interface ArbitrageLogEntry {
  id: string;
  timestamp: number;
  level: "info" | "success" | "warn" | "error";
  message: string;
  details?: any;
}

export interface ArbitrageStatus {
  state: ArbitrageState;
  activeHedge: {
    entryTimestamp: number;
    spreadAtEntryBps: number;
    binanceEntryPrice: number;
    bitgetEntryPrice: number;
    sizeBtc: number;
  } | null;
  lastStateChange: number;
  totalHedgesExecuted: number;
  unrealizedPnL: number;
}
