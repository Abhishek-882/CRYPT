/**
 * STATARB-OU-PERP Convergence Cockpit Components Barrel
 */

export { default as ConvergenceTelemetryHUD } from "./ConvergenceTelemetryHUD";
export type { ConvergenceTelemetryHUDProps } from "./ConvergenceTelemetryHUD";

export { default as ConvergenceZScoreChart } from "./ConvergenceZScoreChart";
export type { ConvergenceZScoreChartProps, DataPoint } from "./ConvergenceZScoreChart";

export { default as ConvergenceControls } from "./ConvergenceControls";
export type { ConvergenceControlsProps } from "./ConvergenceControls";

export { default as ConvergenceRadarTable } from "./ConvergenceRadarTable";
export type { ConvergenceRadarTableProps, RadarPair, RadarGateBadges } from "./ConvergenceRadarTable";

export { default as ConvergenceExecutionAuditTable } from "./ConvergenceExecutionAuditTable";
export type {
  ConvergenceExecutionAuditTableProps,
  ActivePositionItem,
  CompletedFillItem,
} from "./ConvergenceExecutionAuditTable";

export { default as ConvergenceAuditStream } from "./ConvergenceAuditStream";
