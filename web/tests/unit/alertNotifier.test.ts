/**
 * Vitest Unit Tests: Emergency Alert & Notification Dispatcher (Track C / SRE-SEC)
 * 
 * Verifies:
 * 1. Correct markdown formatting for Telegram alerts with icons & metadata
 * 2. Fallback offline dispatching via simulated log channel
 * 3. Payload integrity across CRITICAL, WARNING, and INFO events
 */

import { describe, it, expect } from "vitest";
import { AlertNotifier } from "../../lib/alertNotifier";

describe("Milestone 11: Emergency Alert Dispatcher (Track C / SRE-SEC)", () => {
  it("should format Telegram markdown message correctly for CRITICAL events", () => {
    const notifier = new AlertNotifier();
    const alert = {
      title: "KILL_SWITCH_TRIPPED",
      eventType: "KILL_SWITCH_TRIP" as const,
      severity: "CRITICAL" as const,
      message: "Daily MTM drawdown exceeded 4.0% limit (-$260 USDT). All trading halted.",
      context: { mtmLoss: 260.5, limit: 200.0, activeHedgesClosed: 2 },
      timestamp: 1729000000000,
    };

    const formatted = notifier.formatTelegramMessage(alert);

    expect(formatted).toContain("🚨");
    expect(formatted).toContain("*[SafeCoiner Alert: KILL_SWITCH_TRIPPED]*");
    expect(formatted).toContain("*Severity:* CRITICAL");
    expect(formatted).toContain("*Event:* KILL_SWITCH_TRIP");
    expect(formatted).toContain("Daily MTM drawdown exceeded 4.0% limit");
    expect(formatted).toContain('"mtmLoss": 260.5');
  });

  it("should format WARNING alerts with warning emoji", () => {
    const notifier = new AlertNotifier();
    const alert = {
      title: "STARTUP_ORPHANS_FOUND",
      eventType: "STARTUP_ORPHAN_QUARANTINE" as const,
      severity: "WARNING" as const,
      message: "Unhedged position detected on Bybit for SOLUSDT. Fleet placed into quarantine.",
    };

    const formatted = notifier.formatTelegramMessage(alert);

    expect(formatted).toContain("⚠️");
    expect(formatted).toContain("*Severity:* WARNING");
    expect(formatted).toContain("Fleet placed into quarantine");
  });

  it("should dispatch via fallback simulated log channel when no external webhooks are configured", async () => {
    const notifier = new AlertNotifier({}); // Empty credentials
    const res = await notifier.sendAlert({
      title: "DAEMON_ONLINE",
      eventType: "DAEMON_RECOVERED",
      severity: "INFO",
      message: "SafeCoiner daemon rebooted and healthy.",
    });

    expect(res.dispatched).toBe(true);
    expect(res.channel).toBe("SIMULATED_STDOUT");
    expect(res.success).toBe(true);
  });
});
