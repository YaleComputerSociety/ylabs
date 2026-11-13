import { describe, expect, it } from 'vitest';

import { startLongRunProgress } from '../longRunProgress';

function harness(totalKeys: number) {
  let clock = 0;
  const lines: string[] = [];
  let beat: (() => void) | undefined;
  let beatEveryMs = Infinity;
  let stopped = false;
  const progress = startLongRunProgress('run', totalKeys, {
    everyKeys: 3,
    everyMs: 60_000,
    now: () => clock,
    log: (line) => lines.push(line),
    setInterval: (callback, ms) => {
      beat = callback;
      beatEveryMs = ms;
      return { unref: () => undefined };
    },
    clearInterval: () => {
      stopped = true;
    },
  });
  return {
    progress,
    lines,
    advance(ms: number) {
      const until = clock + ms;
      while (clock + beatEveryMs <= until) {
        clock += beatEveryMs;
        beat?.();
      }
      clock = until;
    },
    stopped: () => stopped,
  };
}

describe('long-run progress', () => {
  it('announces the run before the first key, so a slow prefetch is visible', () => {
    const run = harness(616);
    expect(run.lines).toEqual(['[run] starting: 616 keys']);
  });

  it('prints a heartbeat while no key completes for longer than the interval', () => {
    const run = harness(10);
    run.advance(30_000);
    expect(run.lines).toHaveLength(1);
    run.advance(29_000);
    expect(run.lines).toHaveLength(1);
    run.advance(1_000);
    expect(run.lines[1]).toBe(
      '[run] still working: 0/10 keys, 60 s since the last key, 60 s elapsed',
    );
    run.progress.tick(false);
    run.advance(60_000);
    expect(run.lines.at(-1)).toMatch(/still working: 1\/10 keys, 60 s since the last key/);
  });

  it('keeps the heartbeat a minute after a progress line that lands between timer firings', () => {
    const run = harness(10);
    run.advance(60_000);
    run.progress.tick(false);
    run.progress.tick(false);
    run.advance(10_000);
    run.progress.tick(false);
    expect(run.lines.at(-1)).toBe('[run] 3/10 keys, 0 error(s), 70 s elapsed');
    run.advance(60_000);
    expect(run.lines.at(-1)).toBe(
      '[run] still working: 3/10 keys, 60 s since the last key, 130 s elapsed',
    );
  });

  it('reports every N keys and at the end, counting errors', () => {
    const run = harness(4);
    run.progress.tick(false);
    run.progress.tick(true);
    run.progress.tick(false);
    run.progress.tick(false);
    expect(run.lines.slice(1)).toEqual([
      '[run] 3/4 keys, 1 error(s), 0 s elapsed',
      '[run] 4/4 keys, 1 error(s), 0 s elapsed',
    ]);
  });

  it('stays quiet after the last key and stops its timer', () => {
    const run = harness(1);
    run.progress.tick(false);
    run.advance(120_000);
    expect(run.lines).toHaveLength(2);
    run.progress.stop();
    expect(run.stopped()).toBe(true);
  });
});
