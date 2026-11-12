import { describe, expect, it } from 'vitest';

import { fieldScopeProgressReporter } from '../entityMaterializer';

const reporterAt = (totalKeys: number, options: { everyKeys: number; everyMs: number }) => {
  let clock = 0;
  const lines: string[] = [];
  const report = fieldScopeProgressReporter(totalKeys, {
    ...options,
    now: () => clock,
    log: (line) => lines.push(line),
  });
  return {
    lines,
    keyDone: (afterMs: number, errored = false) => {
      clock += afterMs;
      report(errored);
    },
  };
};

describe('field-scoped user materialize progress lines (#5945)', () => {
  it('logs every N keys and once more on the last key', () => {
    const progress = reporterAt(7, { everyKeys: 3, everyMs: 60_000 });
    for (let key = 0; key < 7; key += 1) progress.keyDone(10);

    expect(progress.lines).toEqual([
      '[field-scoped-user-materialize] 3/7 keys, 0 error(s), 0 s elapsed',
      '[field-scoped-user-materialize] 6/7 keys, 0 error(s), 0 s elapsed',
      '[field-scoped-user-materialize] 7/7 keys, 0 error(s), 0 s elapsed',
    ]);
  });

  it('logs a slow key once the time window has passed, so a stall shows within minutes', () => {
    const progress = reporterAt(1000, { everyKeys: 250, everyMs: 60_000 });
    progress.keyDone(1_000);
    progress.keyDone(30_000);
    expect(progress.lines).toEqual([]);

    progress.keyDone(30_000, true);

    expect(progress.lines).toEqual([
      '[field-scoped-user-materialize] 3/1000 keys, 1 error(s), 61 s elapsed',
    ]);
  });
});
