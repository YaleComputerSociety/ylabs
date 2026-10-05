import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_LEGACY_ACCESS_SIGNALS_REASON,
  LEGACY_ACCESS_SIGNAL_PREDICATES,
  PROTECTED_ACCESS_SIGNAL_SOURCES,
  RETIRED_ACCESS_SIGNAL_TYPES,
  RETIRED_TYPE_ACCESS_SIGNAL_PREDICATES,
  SOURCE_SCOPED_LEGACY_ACCESS_SIGNAL_PREDICATES,
  assertLegacyAccessSignalsFullyArchived,
  legacyAccessSignalPredicateMatches,
  type LegacyAccessSignalRow,
} from '../archiveLegacyAccessSignalsCore';
import {
  archiveLegacyAccessSignals,
  assertArchiveLegacyAccessSignalsApplyAllowed,
  parseArchiveLegacyAccessSignalsArgs,
} from '../archiveLegacyAccessSignals';

const matchesAny = (row: LegacyAccessSignalRow) =>
  LEGACY_ACCESS_SIGNAL_PREDICATES.some((predicate) =>
    legacyAccessSignalPredicateMatches(predicate, row),
  );

const matchesSourceScoped = (row: LegacyAccessSignalRow) =>
  SOURCE_SCOPED_LEGACY_ACCESS_SIGNAL_PREDICATES.some((predicate) =>
    legacyAccessSignalPredicateMatches(predicate, row),
  );

const reachOut = (sourceName: string, archived = false): LegacyAccessSignalRow => ({
  type: 'REACH_OUT_PLAUSIBLE',
  archived,
  source: { name: sourceName },
});

describe('legacy access signal predicates', () => {
  it('targets the boilerplate reach-out rows from the three sources with no producer', () => {
    for (const source of [
      'visibility-repair-queue',
      'dept-faculty-roster',
      'research-entity-cache-backfill',
    ]) {
      expect(matchesAny(reachOut(source))).toBe(true);
    }
  });

  it('targets the retired logistics types from any source', () => {
    for (const type of ['CURRENT_AVAILABILITY', 'MODALITY']) {
      expect(matchesAny({ type, source: { name: 'lab-microsite-undergrad-llm' } })).toBe(true);
    }
  });

  it('never matches a protected source with a source-scoped predicate', () => {
    for (const source of PROTECTED_ACCESS_SIGNAL_SOURCES) {
      expect(matchesSourceScoped(reachOut(source))).toBe(false);
    }
  });

  it('archives each retired type from every source, and only that type (#4637)', () => {
    for (const predicate of RETIRED_TYPE_ACCESS_SIGNAL_PREDICATES) {
      for (const type of RETIRED_ACCESS_SIGNAL_TYPES) {
        for (const source of [...PROTECTED_ACCESS_SIGNAL_SOURCES, 'visibility-repair-queue']) {
          expect(
            legacyAccessSignalPredicateMatches(predicate, { type, source: { name: source } }),
          ).toBe(type === predicate.name);
        }
      }
    }
  });

  it('never touches a kept access type, whatever its source', () => {
    for (const type of [
      'CURRENT_UNDERGRADS',
      'PAST_UNDERGRADS',
      'APPLICATION_FORM_EXISTS',
      'POSTED_OPENING',
      'CREDIT_FORMALIZATION_POSSIBLE',
      'FACULTY_SUPERVISES_STUDENT_PROJECTS',
    ]) {
      for (const source of [...PROTECTED_ACCESS_SIGNAL_SOURCES, 'visibility-repair-queue']) {
        expect(matchesAny({ type, source: { name: source } })).toBe(false);
      }
    }
  });

  it('skips rows that are already archived', () => {
    expect(matchesAny(reachOut('visibility-repair-queue', true))).toBe(false);
    expect(matchesAny({ type: 'MODALITY', archived: true })).toBe(false);
  });

  it('refuses a live target left after apply', () => {
    expect(() =>
      assertLegacyAccessSignalsFullyArchived({
        'visibility-repair-queue': 0,
        'retired-logistics': 2,
      }),
    ).toThrow(/retired-logistics=2/);
    expect(() =>
      assertLegacyAccessSignalsFullyArchived({ 'dept-faculty-roster': 0 }),
    ).not.toThrow();
  });
});

describe('parseArchiveLegacyAccessSignalsArgs', () => {
  it('defaults to a dry run', () => {
    expect(parseArchiveLegacyAccessSignalsArgs([])).toEqual({
      apply: false,
      confirmArchiveLegacyAccessSignals: false,
    });
  });

  it('reads apply, confirmation and both path options', () => {
    const args = parseArchiveLegacyAccessSignalsArgs([
      '--apply',
      '--confirm-archive-legacy-access-signals',
      '--output',
      '/tmp/archive-legacy-report.json',
      '--snapshot=/tmp/archive-legacy-snapshot.json',
    ]);
    expect(args.apply).toBe(true);
    expect(args.confirmArchiveLegacyAccessSignals).toBe(true);
    expect(args.output).toMatch(/archive-legacy-report\.json$/);
    expect(args.snapshot).toMatch(/archive-legacy-snapshot\.json$/);
  });

  it('rejects an unknown argument and a valued confirmation flag', () => {
    expect(() => parseArchiveLegacyAccessSignalsArgs(['--everything'])).toThrow(/Unknown/);
    expect(() =>
      parseArchiveLegacyAccessSignalsArgs(['--confirm-archive-legacy-access-signals=yes']),
    ).toThrow(/does not accept a value/);
  });

  it('requires the confirmation flag to apply', () => {
    expect(() =>
      assertArchiveLegacyAccessSignalsApplyAllowed({
        apply: true,
        confirmArchiveLegacyAccessSignals: false,
      }),
    ).toThrow(/--confirm-archive-legacy-access-signals is required/);
  });
});

type Row = LegacyAccessSignalRow & {
  _id: string;
  researchEntityId: string;
  archivedReason?: string;
};

function fakeDb(rows: Row[]) {
  const matches = (filter: Record<string, unknown>) => (row: Row) =>
    legacyAccessSignalPredicateMatches({ name: 'filter', filter }, row);
  const collection = {
    countDocuments: async (filter: Record<string, unknown>) => rows.filter(matches(filter)).length,
    distinct: async (_field: string, filter: Record<string, unknown>) => [
      ...new Set(rows.filter(matches(filter)).map((row) => row.researchEntityId)),
    ],
    updateMany: async (filter: Record<string, unknown>, update: { $set: Partial<Row> }) => {
      const hit = rows.filter(matches(filter));
      for (const row of hit) Object.assign(row, update.$set);
      return { matchedCount: hit.length, modifiedCount: hit.length };
    },
  };
  return { collection: () => collection } as never;
}

const seed = (): Row[] => [
  { _id: '1', researchEntityId: 'a', ...reachOut('visibility-repair-queue') },
  { _id: '2', researchEntityId: 'b', ...reachOut('visibility-repair-queue') },
  { _id: '3', researchEntityId: 'b', ...reachOut('dept-faculty-roster') },
  { _id: '4', researchEntityId: 'c', type: 'MODALITY', source: { name: 'x' } },
  { _id: '5', researchEntityId: 'd', ...reachOut('lab-microsite-undergrad-llm') },
  {
    _id: '6',
    researchEntityId: 'd',
    type: 'CURRENT_UNDERGRADS',
    archived: false,
    source: { name: 'lab-microsite-undergrad-llm' },
  },
];

describe('archiveLegacyAccessSignals', () => {
  it('counts every predicate and writes nothing in a dry run', async () => {
    const rows = seed();
    const result = await archiveLegacyAccessSignals({ apply: false, db: fakeDb(rows) });
    expect(result.mode).toBe('dry-run');
    const byName = Object.fromEntries(result.predicates.map((p) => [p.name, p]));
    expect(byName['visibility-repair-queue']).toMatchObject({
      presentBefore: 2,
      presentAfter: 2,
      entitiesAffected: 2,
      modified: 0,
    });
    expect(byName['retired-logistics'].presentBefore).toBe(1);
    expect(rows.every((row) => row.archived !== true)).toBe(true);
  });

  it('archives every target with attribution and leaves kept types live', async () => {
    const rows = seed();
    const result = await archiveLegacyAccessSignals({ apply: true, db: fakeDb(rows) });
    expect(result.predicates.every((p) => p.presentAfter === 0)).toBe(true);
    const archived = rows.filter((row) => row.archived === true);
    expect(archived.map((row) => row._id).sort()).toEqual(['1', '2', '3', '4', '5']);
    expect(
      archived.every((row) => row.archivedReason === ARCHIVE_LEGACY_ACCESS_SIGNALS_REASON),
    ).toBe(true);
    expect(rows.find((row) => row._id === '6')?.archived).toBe(false);
  });
});
