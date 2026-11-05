/**
 * Emergency Alert & Notification Dispatcher
 * Track C / SRE-SEC: Real-time Operator Alerts
 * 
 * Emits immediate high-priority alerts via Telegram Bot API or Discord Webhook
 * upon critical system events:
 * 1. Kill-Switch Trip (MTM Drawdown breach)
 * 2. Startup Orphan Quarantine Lock (Option B)
 * 3. Watchdog Heartbeat Stale or Daemon Crash
 */

import { pooledFetch } from "./agentPoolManager";

export type AlertSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface AlertPayload {
  title: string;
  eventType: "KILL_SWITCH_TRIP" | "STARTUP_ORPHAN_QUARANTINE" | "WATCHDOG_STALE" | "DAEMON_RECOVERED";
  severity: AlertSeverity;
  message: string;
  context?: Record<string, any>;
  timestamp?: number;
}

export interface AlertDispatchResult {
  dispatched: boolean;
  channel: "TELEGRAM" | "DISCORD" | "SIMULATED_STDOUT";
  success: boolean;
  error?: string;
}

export class AlertNotifier {
  private telegramBotToken?: string;
  private telegramChatId?: string;
  private discordWebhookUrl?: string;

  constructor(config?: {
    telegramBotToken?: string;
    telegramChatId?: string;
    discordWebhookUrl?: string;
  }) {
    this.telegramBotToken = config?.telegramBotToken || process.env.ALERT_TELEGRAM_BOT_TOKEN;
    this.telegramChatId = config?.telegramChatId || process.env.ALERT_TELEGRAM_CHAT_ID;
    this.discordWebhookUrl = config?.discordWebhookUrl || process.env.ALERT_DISCORD_WEBHOOK_URL;
  }

  /**
   * Format message for Telegram MarkdownV2 or plain text
   */
  public formatTelegramMessage(alert: AlertPayload): string {
    const icon = alert.severity === "CRITICAL" ? "🚨" : alert.severity === "WARNING" ? "⚠️" : "ℹ️";
    const ts = new Date(alert.timestamp || Date.now()).toISOString();
    let text = `${icon} *[SafeCoiner Alert: ${alert.title}]*\n`;
    text += `*Severity:* ${alert.severity}\n`;
    text += `*Event:* ${alert.eventType}\n`;
    text += `*Time:* ${ts}\n\n`;
    text += `${alert.message}\n`;

    if (alert.context && Object.keys(alert.context).length > 0) {
      text += `\n*Details:*\n` + JSON.stringify(alert.context, null, 2);
    }
    return text;
  }

  /**
   * Dispatch alert to configured channels
   */
  public async sendAlert(alert: AlertPayload): Promise<AlertDispatchResult> {
    const timestamp = alert.timestamp || Date.now();
    const formattedMsg = this.formatTelegramMessage({ ...alert, timestamp });

    // 1. Telegram Dispatch
    if (this.telegramBotToken && this.telegramChatId) {
      try {
        const url = `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`;
        const res = await pooledFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.telegramChatId,
            text: formattedMsg,
            parse_mode: "Markdown",
          }),
          timeoutMs: 4000,
        });

        if (res.json?.ok) {
          return { dispatched: true, channel: "TELEGRAM", success: true };
        } else {
          return { dispatched: true, channel: "TELEGRAM", success: false, error: res.json?.description };
        }
      } catch (err: any) {
        return { dispatched: true, channel: "TELEGRAM", success: false, error: err.message };
      }
    }

    // 2. Discord Webhook Dispatch
    if (this.discordWebhookUrl) {
      try {
        const res = await pooledFetch(this.discordWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: formattedMsg,
          }),
          timeoutMs: 4000,
        });
        return { dispatched: true, channel: "DISCORD", success: res.ok };
      } catch (err: any) {
        return { dispatched: true, channel: "DISCORD", success: false, error: err.message };
      }
    }

    // 3. Fallback / Offline Simulation Logging
    console.warn(`[SafeCoiner Alert Dispatched via Log]: ${alert.title} - ${alert.message}`);
    return { dispatched: true, channel: "SIMULATED_STDOUT", success: true };
  }
}

export const globalAlertNotifier = new AlertNotifier();
