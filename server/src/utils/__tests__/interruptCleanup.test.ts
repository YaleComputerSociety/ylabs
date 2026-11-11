import { afterEach, describe, expect, it, vi } from 'vitest';
import { INTERRUPT_CLEANUP_TIMEOUT_MS, onInterrupt } from '../interruptCleanup';

function lastListener(signal: NodeJS.Signals): () => void {
  return process.listeners(signal).at(-1) as () => void;
}

describe('onInterrupt (#3595)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shares one handler per signal however many cleanups are registered', () => {
    const before = process.listeners('SIGINT').length;
    const detachFirst = onInterrupt(() => undefined);
    const detachSecond = onInterrupt(() => undefined);

    expect(process.listeners('SIGINT').length).toBe(before + 1);
    detachFirst();
    expect(process.listeners('SIGINT').length).toBe(before + 1);
    detachSecond();
    expect(process.listeners('SIGINT').length).toBe(before);
  });

  it('settles every cleanup before it re-raises the signal', async () => {
    const order: string[] = [];
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      order.push('kill');
      return true;
    });
    let releaseSlow: () => void = () => undefined;
    onInterrupt(
      () =>
        new Promise<void>((resolve) => {
          releaseSlow = () => {
            order.push('slow');
            resolve();
          };
        }),
    );
    onInterrupt(() => {
      order.push('fast');
    });

    lastListener('SIGINT')();
    await new Promise((resolve) => setImmediate(resolve));
    expect(kill).not.toHaveBeenCalled();

    releaseSlow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['fast', 'slow', 'kill']);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT');
  });

  it('re-raises after the timeout when a cleanup hangs', async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    onInterrupt(() => new Promise<void>(() => undefined));

    lastListener('SIGTERM')();
    await vi.advanceTimersByTimeAsync(INTERRUPT_CLEANUP_TIMEOUT_MS - 1);
    expect(kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });

  it('logs a failing cleanup and still runs the others', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const other = vi.fn();
    onInterrupt(() => {
      throw new Error('cleanup broke');
    });
    onInterrupt(other);

    lastListener('SIGINT')();
    await new Promise((resolve) => setImmediate(resolve));

    expect(other).toHaveBeenCalledWith('SIGINT');
    expect(consoleError.mock.calls.flat().join(' ')).toContain('cleanup broke');
    expect(kill).toHaveBeenCalledTimes(1);
  });
});
