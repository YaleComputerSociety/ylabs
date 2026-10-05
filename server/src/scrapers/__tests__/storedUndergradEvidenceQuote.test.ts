import { describe, expect, it } from 'vitest';
import {
  planStoredUndergradEvidenceQuoteClear,
  sourcesWithdrawingUndergradEvidenceQuote,
  withoutWithdrawnUndergradEvidenceQuotes,
} from '../storedUndergradEvidenceQuote';

const LANE = 'lab-microsite-undergrad-llm';
const GROUNDED = 'Undergraduates join the lab every fall.';
const NOTE = 'No explicit mention of undergraduates was found on the provided pages.';

const stored = (quote: string, sourceName = LANE) => ({
  undergradEvidenceQuote: quote,
  fieldProvenance: { undergradEvidenceQuote: { sourceName } },
});

describe('sourcesWithdrawingUndergradEvidenceQuote', () => {
  it('reads only the latest statement of each source', () => {
    const observations = [
      {
        field: 'undergradEvidenceQuote',
        sourceName: LANE,
        value: GROUNDED,
        observedAt: '2026-09-01',
      },
      { field: 'undergradEvidenceQuote', sourceName: LANE, value: '', observedAt: '2026-09-27' },
      { field: 'undergradEvidenceQuote', sourceName: 'other', value: '', observedAt: '2026-09-01' },
      {
        field: 'undergradEvidenceQuote',
        sourceName: 'other',
        value: GROUNDED,
        observedAt: '2026-09-27',
      },
      {
        field: 'undergradEvidenceQuote',
        sourceName: 'noted',
        value: NOTE,
        observedAt: '2026-09-27',
      },
    ];
    expect([...sourcesWithdrawingUndergradEvidenceQuote(observations)].sort()).toEqual([
      LANE,
      'noted',
    ]);
  });

  it('drops the older rows of a withdrawing source so a lossless read cannot resurrect them', () => {
    const observations = [
      { field: 'undergradEvidenceQuote', sourceName: LANE, value: GROUNDED },
      { field: 'undergradEvidenceQuote', sourceName: 'other', value: GROUNDED },
      { field: 'name', sourceName: LANE, value: 'Lab' },
    ];
    expect(withoutWithdrawnUndergradEvidenceQuotes(observations, new Set([LANE]))).toEqual([
      observations[1],
      observations[2],
    ]);
  });
});

describe('planStoredUndergradEvidenceQuoteClear', () => {
  const plan = (
    row: Record<string, unknown>,
    options: { staged?: Record<string, unknown>; withdrawing?: string[]; locked?: string[] } = {},
  ) =>
    planStoredUndergradEvidenceQuoteClear({
      stored: row,
      staged: options.staged ?? {},
      withdrawingSources: new Set(options.withdrawing ?? []),
      lockedFields: options.locked ?? [],
    });

  it('clears an inadmissible stored quote whatever its source says', () => {
    expect(plan(stored(NOTE))).toEqual({ reason: 'inadmissible', skipped: null });
  });

  it('clears a stored quote its own source has withdrawn', () => {
    expect(plan(stored(GROUNDED), { withdrawing: [LANE] })).toEqual({
      reason: 'withdrawn-by-its-source',
      skipped: null,
    });
  });

  it('does not clear on another source withdrawing', () => {
    expect(
      plan(stored(GROUNDED, 'department-undergrad-research'), { withdrawing: [LANE] }),
    ).toBeNull();
  });

  it('defers to a value this pass staged', () => {
    expect(
      plan(stored(GROUNDED), { staged: { undergradEvidenceQuote: GROUNDED }, withdrawing: [LANE] }),
    ).toBeNull();
  });

  it('reports a locked field instead of clearing it', () => {
    expect(plan(stored(NOTE), { locked: ['undergradEvidenceQuote'] })).toEqual({
      reason: 'inadmissible',
      skipped: 'field-is-locked',
    });
  });

  it('plans nothing for an empty stored quote', () => {
    expect(plan(stored(''), { withdrawing: [LANE] })).toBeNull();
  });
});

describe('the microsite lane admission rule (#3764)', () => {
  const ROTATION = 'The lab welcomes postdoctoral scientists and rotation students.';

  it('clears a stored lane quote that names no undergraduate', () => {
    expect(
      planStoredUndergradEvidenceQuoteClear({
        stored: stored(ROTATION),
        staged: {},
        withdrawingSources: new Set(),
        lockedFields: [],
      }),
    ).toEqual({ reason: 'inadmissible', skipped: null });
  });

  it('leaves the same text alone when another source stored it', () => {
    expect(
      planStoredUndergradEvidenceQuoteClear({
        stored: stored(ROTATION, 'department-undergrad-research'),
        staged: {},
        withdrawingSources: new Set(),
        lockedFields: [],
      }),
    ).toBeNull();
  });
});

describe('planStoredUndergradEvidenceQuoteClear with the row as citation context (#3592)', () => {
  const plan = (row: Record<string, unknown>) =>
    planStoredUndergradEvidenceQuoteClear({
      stored: row,
      staged: {},
      withdrawingSources: new Set(),
      lockedFields: [],
    });

  it('clears a quote held only by the retired cache backfill', () => {
    expect(plan(stored(GROUNDED, 'research-entity-cache-backfill'))).toEqual({
      reason: 'inadmissible',
      skipped: null,
    });
  });

  it('clears a lane quote cited to a department program page the row does not own', () => {
    const row = {
      entityType: 'FACULTY_RESEARCH_AREA',
      websiteUrl: '',
      undergradEvidenceQuote: GROUNDED,
      fieldProvenance: {
        undergradEvidenceQuote: {
          sourceName: LANE,
          sourceUrl: 'https://economics.yale.edu/undergraduate/employment-opportunities',
        },
      },
    };
    expect(plan(row)).toEqual({ reason: 'inadmissible', skipped: null });
  });

  it('keeps a lane quote cited to the row own lab page', () => {
    const row = {
      entityType: 'LAB',
      websiteUrl: 'https://medicine.yale.edu/lab/example/',
      undergradEvidenceQuote: GROUNDED,
      fieldProvenance: {
        undergradEvidenceQuote: {
          sourceName: LANE,
          sourceUrl: 'https://medicine.yale.edu/lab/example/people/',
        },
      },
    };
    expect(plan(row)).toBeNull();
  });
});
