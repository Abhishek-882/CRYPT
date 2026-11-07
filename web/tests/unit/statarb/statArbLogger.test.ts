import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendStatArbLog,
  getStatArbLogs,
  clearStatArbLogs,
  getActiveIncidents,
  resolveIncident,
} from '@/lib/statarb/logging/statArbLogger';

describe('StatArbLogger Unit Test Suite', () => {
  beforeEach(() => {
    clearStatArbLogs();
  });

  it('correctly formats and prepends [STATARB-OU-PERP] prefix tag', () => {
    const log = appendStatArbLog('Signal evaluated for ETHUSDT', 'info', 'ETHUSDT');
    expect(log.message).toContain('[STATARB-OU-PERP]');
    expect(log.message).toContain('Signal evaluated for ETHUSDT');
    expect(log.level).toBe('info');
    expect(log.symbol).toBe('ETHUSDT');
  });

  it('aggregates duplicate messages within 60 seconds with count [N]', () => {
    const log1 = appendStatArbLog('Gross basis magnitude < 28 bps hurdle', 'info', 'SOLUSDT');
    expect(log1.count).toBe(1);

    const log2 = appendStatArbLog('Gross basis magnitude < 28 bps hurdle', 'info', 'SOLUSDT');
    expect(log2.count).toBe(2);
    expect(log2.message).toContain('[2]');

    const logs = getStatArbLogs();
    const matches = logs.filter((l) => l.symbol === 'SOLUSDT');
    expect(matches.length).toBe(1);
    expect(matches[0].count).toBe(2);
  });

  it('registers an active incident when level is error and allows resolution', () => {
    appendStatArbLog('EC_NoImmediateQtyToFill on Bybit taker order', 'error', 'SUIUSDT');

    const incidents = getActiveIncidents(true);
    expect(incidents.length).toBeGreaterThanOrEqual(1);

    const match = incidents.find((i) => i.symbol === 'SUIUSDT');
    expect(match).toBeDefined();
    expect(match?.errorType).toBe('LEG2_REJECTION');
    expect(match?.resolved).toBe(false);

    if (match) {
      const resolved = resolveIncident(match.id, 'Unwound Leg 1 on Binance to 0.000');
      expect(resolved).toBe(true);

      const remaining = getActiveIncidents(true);
      expect(remaining.some((i) => i.id === match.id)).toBe(false);
    }
  });

  it('filters logs by severity level accurately', () => {
    appendStatArbLog('Scan cycle completed', 'info');
    appendStatArbLog('Persistence breaker warning', 'warn');
    appendStatArbLog('Delta neutral locked', 'success');
    appendStatArbLog('Execution failed', 'error');

    const errorLogs = getStatArbLogs({ severity: 'ERRORS' });
    expect(errorLogs.length).toBeGreaterThanOrEqual(1);
    expect(errorLogs.every((l) => l.level === 'error' || /failed|rejected|critical|alert|orphan|error/i.test(l.message))).toBe(true);

    const successLogs = getStatArbLogs({ severity: 'SUCCESS' });
    expect(successLogs.length).toBeGreaterThanOrEqual(1);
    expect(successLogs.every((l) => l.level === 'success')).toBe(true);
  });
});
