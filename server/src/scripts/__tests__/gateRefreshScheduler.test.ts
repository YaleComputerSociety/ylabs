import { describe, it, expect } from 'vitest';
import { gateRefreshIntervalMs, startGateRefreshScheduler } from '../gateRefreshScheduler';

describe('gateRefreshScheduler', () => {
  it('is disabled (0) when the interval env is unset, zero, or non-numeric', () => {
    expect(gateRefreshIntervalMs({})).toBe(0);
    expect(gateRefreshIntervalMs({ GATE_REFRESH_INTERVAL_MINUTES: '0' })).toBe(0);
    expect(gateRefreshIntervalMs({ GATE_REFRESH_INTERVAL_MINUTES: 'abc' })).toBe(0);
    expect(gateRefreshIntervalMs({ GATE_REFRESH_INTERVAL_MINUTES: '-5' })).toBe(0);
  });

  it('converts a positive minute interval to milliseconds', () => {
    expect(gateRefreshIntervalMs({ GATE_REFRESH_INTERVAL_MINUTES: '30' })).toBe(30 * 60_000);
    // Sub-floor intervals clamp to the 5-minute minimum.
    expect(gateRefreshIntervalMs({ GATE_REFRESH_INTERVAL_MINUTES: '1.5' })).toBe(5 * 60_000);
  });

  it('does not start (and spawns nothing) when disabled', () => {
    expect(startGateRefreshScheduler({})).toBe(false);
  });
});
