import { describe, expect, it } from 'vitest';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';
import {
  plannedOutputFingerprint,
  scoreLaneReplay,
  summarizeLiveModelRuns,
  type BenchmarkLabel,
  type LaneReplayScore,
  allowedReplayMisses,
  staleReplayReason,
} from '../laneScorecardCore';

const wrongSite = 'https://example.org/someone-elses-lab';
const label = (entityKey: string, field: string, value: string): BenchmarkLabel => ({
  entityKey,
  field,
  valueKey: fieldValueRefusalKey(field, value),
  rule: 'wrong_owner',
});

describe('scoreLaneReplay', () => {
  it('counts a planned citation of a refused website as known wrong', () => {
    const score = scoreLaneReplay(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'row-a',
          field: 'sourceUrls',
          value: [wrongSite],
        },
        {
          entityType: 'researchEntity',
          entityKey: 'row-a',
          field: 'sourceUrls',
          value: ['https://ok.org'],
        },
        {
          entityType: 'researchEntity',
          entityKey: 'row-b',
          field: 'sourceUrls',
          value: [wrongSite],
        },
      ],
      [label('row-a', 'websiteUrl', wrongSite)],
    );
    expect(score.emitted).toBe(3);
    expect(score.knownWrong).toBe(1);
    expect(score.labelsMatched).toBe(1);
    expect(score.byField).toEqual([
      { field: 'sourceUrls', emitted: 3, labeledEntityEmitted: 2, knownWrong: 1 },
    ]);
  });

  it('resolves an entityId-keyed observation through the slug map', () => {
    const score = scoreLaneReplay(
      [{ entityType: 'researchEntity', entityId: 'id-1', field: 'websiteUrl', value: wrongSite }],
      [label('row-a', 'websiteUrl', wrongSite)],
      new Map([['id-1', 'row-a']]),
    );
    expect(score.knownWrong).toBe(1);
  });

  it('never labels an observation about another subject', () => {
    const score = scoreLaneReplay(
      [{ entityType: 'user', entityKey: 'row-a', field: 'websiteUrl', value: wrongSite }],
      [label('row-a', 'websiteUrl', wrongSite)],
    );
    expect(score.knownWrong).toBe(0);
    expect(score.byField[0].labeledEntityEmitted).toBe(0);
  });

  it('does not read a URL citation against a prose label', () => {
    const score = scoreLaneReplay(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'row-a',
          field: 'sourceUrls',
          value: ['Borrowed prose.'],
        },
      ],
      [label('row-a', 'fullDescription', 'Borrowed prose.')],
    );
    expect(score.knownWrong).toBe(0);
    expect(score.byField[0].labeledEntityEmitted).toBe(0);
  });
});

describe('scoreLaneReplay ingest refusals', () => {
  it('does not score a value the observation store refuses at ingest', () => {
    const score = scoreLaneReplay(
      [
        { entityType: 'researchEntity', entityKey: 'row-a', field: 'kind', value: 'lab' },
        { entityType: 'researchEntity', entityKey: 'row-a', field: 'entityType', value: 'LAB' },
      ],
      [label('row-a', 'kind', 'lab'), label('row-a', 'entityType', 'LAB')],
    );
    expect(score.emitted).toBe(1);
    expect(score.refusedAtIngest).toBe(1);
    expect(score.knownWrong).toBe(1);
    expect(score.byField.map((field) => field.field)).toEqual(['entityType']);
  });
});

describe('plannedOutputFingerprint', () => {
  const a = { entityType: 'researchEntity', entityKey: 'row-a', field: 'name', value: 'A' };
  const b = { entityType: 'researchEntity', entityKey: 'row-b', field: 'name', value: 'B' };

  it('does not depend on emission order', () => {
    expect(plannedOutputFingerprint([a, b])).toBe(plannedOutputFingerprint([b, a]));
  });

  it('ignores the instant a lane stamps into a value', () => {
    const health = (readAt: string) => ({
      entityType: 'departmentRosterHealth',
      entityKey: 'dept',
      field: 'rosterHealth',
      value: { status: 'ok', read: { pagesRead: 3, readAt } },
    });
    expect(plannedOutputFingerprint([health('2026-09-26T21:40:01.123Z')])).toBe(
      plannedOutputFingerprint([health('2026-09-26T21:52:47.906Z')]),
    );
  });

  it('still counts a date the page stated', () => {
    expect(plannedOutputFingerprint([{ ...a, value: '2026-09-01' }])).not.toBe(
      plannedOutputFingerprint([{ ...a, value: '2026-09-02' }]),
    );
  });

  it('still counts a page-stated deadline serialized as a full instant', () => {
    const opening = (deadline: string) => ({ ...a, value: { deadline } });
    expect(plannedOutputFingerprint([opening('2026-09-01T00:00:00.000Z')])).not.toBe(
      plannedOutputFingerprint([opening('2026-09-02T00:00:00.000Z')]),
    );
  });

  it('changes when a planned value changes', () => {
    expect(plannedOutputFingerprint([a, b])).not.toBe(
      plannedOutputFingerprint([a, { ...b, value: 'B2' }]),
    );
  });
});

describe('run-clock fields', () => {
  const observed = (at: Date) => ({
    entityType: 'researchEntity',
    entityKey: 'lab',
    field: 'lastObservedAt',
    value: at,
  });

  it('masks a field the lane stamps with the run clock', () => {
    const clock = new Set(['lastObservedAt']);
    expect(plannedOutputFingerprint([observed(new Date(1))], clock)).toBe(
      plannedOutputFingerprint([observed(new Date(2))], clock),
    );
  });

  it('keeps the same field when the lane does not declare it a run clock', () => {
    expect(plannedOutputFingerprint([observed(new Date(1))])).not.toBe(
      plannedOutputFingerprint([observed(new Date(2))]),
    );
  });
});

describe('summarizeLiveModelRuns', () => {
  const score = (fingerprint: string, fields: Record<string, number>): LaneReplayScore => ({
    emitted: Object.values(fields).reduce((sum, count) => sum + count, 0),
    refusedAtIngest: 0,
    knownWrong: 0,
    labelsMatched: 0,
    labelCount: 0,
    outputFingerprint: fingerprint,
    byField: Object.entries(fields).map(([field, emitted]) => ({
      field,
      emitted,
      labeledEntityEmitted: 0,
      knownWrong: 0,
    })),
  });

  it('reports the band of each field across runs, counting an absent field as zero', () => {
    const spread = summarizeLiveModelRuns([
      score('x', { undergradEvidenceQuote: 4, joinPageUrl: 1 }),
      score('y', { undergradEvidenceQuote: 6 }),
      score('x', { undergradEvidenceQuote: 5, joinPageUrl: 2 }),
    ]);
    expect(spread.runs).toBe(3);
    expect(spread.distinctFingerprints).toBe(2);
    expect(spread.emitted).toEqual({ min: 5, max: 7, mean: 6 });
    expect(spread.byField).toEqual([
      {
        field: 'joinPageUrl',
        emitted: { min: 0, max: 2, mean: 1 },
        knownWrong: { min: 0, max: 0, mean: 0 },
      },
      {
        field: 'undergradEvidenceQuote',
        emitted: { min: 4, max: 6, mean: 5 },
        knownWrong: { min: 0, max: 0, mean: 0 },
      },
    ]);
  });

  it('refuses an empty set of runs', () => {
    expect(() => summarizeLiveModelRuns([])).toThrow(/at least one run/);
  });
});

describe('allowedReplayMisses', () => {
  it('uses the count the capture recorded', () => {
    expect(allowedReplayMisses({ unfrozenRequestCount: 2, codeSha: 'a' }, [])).toBe(2);
  });

  it('falls back to the first replay stored at the capture commit', () => {
    const runs = [
      { codeSha: 'b', pagesMissed: 6, measuredAt: new Date(3) },
      { codeSha: 'a', pagesMissed: 1, measuredAt: new Date(2) },
      { codeSha: 'a', pagesMissed: 0, measuredAt: new Date(1) },
    ];
    expect(allowedReplayMisses({ codeSha: 'a' }, runs)).toBe(0);
  });

  it('knows nothing without a count or a replay at the capture commit', () => {
    expect(
      allowedReplayMisses({ codeSha: 'a' }, [{ codeSha: 'b', pagesMissed: 0 }]),
    ).toBeUndefined();
    expect(allowedReplayMisses({}, [{ codeSha: 'b', pagesMissed: 0 }])).toBeUndefined();
  });
});

describe('staleReplayReason', () => {
  it('accepts misses up to what the capture left unfrozen', () => {
    expect(staleReplayReason(2, 2)).toBeUndefined();
    expect(staleReplayReason(0, undefined)).toBeUndefined();
  });

  it('refuses a replay that missed more than the capture left unfrozen', () => {
    expect(staleReplayReason(39, 2)).toMatch(
      /missed 39 request\(s\) where the capture left 2 unfrozen/,
    );
  });

  it('refuses any miss it cannot explain', () => {
    expect(staleReplayReason(2, undefined)).toMatch(/no clean baseline/);
  });
});
