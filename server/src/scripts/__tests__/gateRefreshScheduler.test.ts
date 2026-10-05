import { EventEmitter } from 'events';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const captureServerWarning = vi.hoisted(() => vi.fn());

vi.mock('../../utils/errorTracking', () => ({ captureServerWarning }));

import {
  gateRefreshIntervalMs,
  startGateRefreshScheduler,
  watchGateRefreshCycle,
} from '../gateRefreshScheduler';

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

describe('a gate refresh cycle', () => {
  beforeEach(() => {
    captureServerWarning.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  const watchedCycle = () => {
    const child = new EventEmitter();
    const onSettled = vi.fn();
    watchGateRefreshCycle(child, onSettled);
    return { child, onSettled };
  };

  it('reports nothing for a cycle that exits cleanly', () => {
    const { child, onSettled } = watchedCycle();

    child.emit('close', 0);

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(captureServerWarning).not.toHaveBeenCalled();
  });

  it('reports a non-zero exit once as a degraded-service warning', () => {
    const { child } = watchedCycle();

    child.emit('close', 1);

    expect(captureServerWarning).toHaveBeenCalledTimes(1);
    expect(captureServerWarning).toHaveBeenCalledWith('gate_refresh_failed');
  });

  it('reports a spawn failure once even when a close follows it', () => {
    const { child, onSettled } = watchedCycle();

    child.emit('error', new Error('spawn yarn ENOENT'));
    child.emit('close', -2);

    expect(onSettled).toHaveBeenCalled();
    expect(captureServerWarning).toHaveBeenCalledTimes(1);
    expect(captureServerWarning).toHaveBeenCalledWith('gate_refresh_failed');
  });
});
