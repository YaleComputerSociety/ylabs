import { describe, expect, it } from 'vitest';
import {
  planRunScopedEmailSupersede,
  subjectsToRederive,
  type RunScopedEmailRow,
} from '../runScopedEmailSupersede';

const LANE = 'fixture-profile-lane';
const PAGE = 'https://example.edu/people/fixture-person';
const KEY = 'netid:fx2002';

let nextId = 0;
function row(
  value: unknown,
  run: string,
  minute: number,
  overrides: Partial<RunScopedEmailRow> = {},
): RunScopedEmailRow {
  nextId += 1;
  return {
    id: `row-${nextId}`,
    sourceName: LANE,
    entityKey: KEY,
    sourceUrl: PAGE,
    scrapeRunId: run,
    observedAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
    value,
    ...overrides,
  };
}

const retiredIds = (rows: RunScopedEmailRow[]) =>
  planRunScopedEmailSupersede(rows).map((retirement) => retirement.id);

describe('planRunScopedEmailSupersede (#5705)', () => {
  it('retires an earlier-run address the newest read no longer states', () => {
    const old = row('a@example.edu', 'run-1', 1);
    const fresh = row('b@example.edu', 'run-2', 2);
    expect(retiredIds([old, fresh])).toEqual([old.id]);
  });

  it('keeps an earlier-run address the newest read restates, ignoring case', () => {
    expect(
      retiredIds([row('A@Example.edu', 'run-1', 1), row('a@example.edu', 'run-2', 2)]),
    ).toEqual([]);
  });

  it('never retires a row of the newest read itself', () => {
    expect(
      retiredIds([row('a@example.edu', 'run-2', 2), row('b@example.edu', 'run-2', 2)]),
    ).toEqual([]);
  });

  it('lets a blank-valued read state nothing', () => {
    expect(retiredIds([row('a@example.edu', 'run-1', 1), row('  ', 'run-2', 2)])).toEqual([]);
  });

  it('refuses to pick a newest read when two runs overlap in time', () => {
    expect(
      retiredIds([
        row('a@example.edu', 'run-1', 1),
        row('a@example.edu', 'run-1', 3),
        row('b@example.edu', 'run-2', 2),
      ]),
    ).toEqual([]);
  });

  it('leaves a row it cannot place in a read alone', () => {
    const noPage = row('a@example.edu', 'run-1', 1, { sourceUrl: undefined });
    const noRun = row('a@example.edu', 'run-1', 1, { scrapeRunId: undefined });
    expect(retiredIds([noPage, noRun, row('b@example.edu', 'run-2', 2)])).toEqual([]);
  });

  it('joins identity forms through any row that carries both', () => {
    const byId = row('a@example.edu', 'run-1', 1, { entityKey: undefined, entityId: 'oid-1' });
    const both = row('b@example.edu', 'run-2', 2, { entityId: 'oid-1' });
    expect(retiredIds([byId, both])).toEqual([byId.id]);
  });

  it('re-derives each subject once, preferring the key form', () => {
    const retirements = planRunScopedEmailSupersede([
      row('a@example.edu', 'run-1', 1),
      row('c@example.edu', 'run-1', 1),
      row('b@example.edu', 'run-2', 2),
    ]);
    expect(retirements).toHaveLength(2);
    expect(subjectsToRederive(retirements)).toEqual([{ entityKey: KEY }]);
  });
});
