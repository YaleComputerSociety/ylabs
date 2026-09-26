import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  isRefusedObservationField,
  REFUSED_RESEARCH_ENTITY_OBSERVATION_FIELDS,
} from '../../scrapers/observationFieldSanitizer';
import {
  assertKindFullyRetired,
  buildRetiredKindRecord,
  RETIRE_KIND_ROLLBACK_REASON,
} from '../retireResearchEntityKindObservationsCore';

describe('the ingest fence refuses a retired research-entity field', () => {
  it('refuses kind on a research entity', () => {
    expect(isRefusedObservationField('researchEntity', 'kind')).toBe(true);
    expect(REFUSED_RESEARCH_ENTITY_OBSERVATION_FIELDS.has('kind')).toBe(true);
  });

  // The fence is scoped to the entity type whose resolver discards the field. A user or
  // fellowship `kind` has a different resolution and must not be caught by it.
  it('leaves entityType, and every other entity type, alone', () => {
    expect(isRefusedObservationField('researchEntity', 'entityType')).toBe(false);
    expect(isRefusedObservationField('researchEntity', 'name')).toBe(false);
    expect(isRefusedObservationField('user', 'kind')).toBe(false);
    expect(isRefusedObservationField('fellowship', 'kind')).toBe(false);
  });
});

describe('buildRetiredKindRecord', () => {
  const observations = [
    {
      entityKey: 'b-lab',
      value: 'lab',
      sourceName: 'nih-reporter',
      observedAt: new Date('2026-08-28T00:00:00Z'),
    },
    {
      entityKey: 'a-lab',
      value: 'individual',
      sourceName: 'nsf-award-search',
      observedAt: new Date('2026-07-25T00:00:00Z'),
    },
  ];

  // For a key with no entity row this record is the only remaining trace, so it is
  // built from the observations themselves and never from the entity.
  it('records what each lane asserted, and whether the key had any other type claim', () => {
    const record = buildRetiredKindRecord({
      observations,
      keysWithEntityTypeAssertion: new Set(['b-lab']),
      keysWithEntityRow: new Set(['b-lab']),
    });
    expect(record).toEqual([
      {
        entityKey: 'a-lab',
        value: 'individual',
        sourceName: 'nsf-award-search',
        observedAt: '2026-07-25T00:00:00.000Z',
        hadEntityTypeAssertion: false,
        entityRowExists: false,
      },
      {
        entityKey: 'b-lab',
        value: 'lab',
        sourceName: 'nih-reporter',
        observedAt: '2026-08-28T00:00:00.000Z',
        hadEntityTypeAssertion: true,
        entityRowExists: true,
      },
    ]);
  });

  it('drops an observation with no key, which nothing could trace back', () => {
    expect(
      buildRetiredKindRecord({
        observations: [{ value: 'lab' }],
        keysWithEntityTypeAssertion: new Set(),
        keysWithEntityRow: new Set(),
      }),
    ).toEqual([]);
  });
});

describe('assertKindFullyRetired', () => {
  it('accepts a run that left no live row and took no served type', () => {
    expect(() =>
      assertKindFullyRetired({ liveAfter: 0, servedRowsMissingAStoredType: 0 }),
    ).not.toThrow();
  });

  it('refuses a partial retirement', () => {
    expect(() => assertKindFullyRetired({ liveAfter: 3, servedRowsMissingAStoredType: 0 })).toThrow(
      /not retired/,
    );
  });

  // Retirement is housekeeping only while every row keeps its stored type; a served row
  // left type-less would be harm rather than cleanup.
  it('refuses a retirement that would leave a served row without a stored type', () => {
    expect(() => assertKindFullyRetired({ liveAfter: 0, servedRowsMissingAStoredType: 1 })).toThrow(
      /no stored entityType/,
    );
  });
});

describe('the rollback reason names the issues, so the retirement is traceable', () => {
  it('cites the census and the guard', () => {
    expect(RETIRE_KIND_ROLLBACK_REASON).toMatch(/#3362/);
    expect(RETIRE_KIND_ROLLBACK_REASON).toMatch(/#3378/);
  });
});

describe('the record is written before any write, not after', () => {
  // The first shape applied the supersede and wrote the record afterwards, so a rejected
  // `--record` path threw AFTER the data operation and the record was lost. Only
  // superseding rather than deleting kept the assertions recoverable (#3362).
  it('resolves the record path before opening a connection, and plans without writing', () => {
    const script = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../retireResearchEntityKindObservations.ts',
      ),
      'utf8',
    );
    const pathResolvedAt = script.indexOf('resolveSafeJsonReportOutputPath(argv[recordIndex + 1])');
    const connectionAt = script.indexOf('await initializeConnections()');
    const recordWrittenAt = script.indexOf('fs.writeFileSync(output');
    const supersedeAt = script.indexOf('await supersedeResearchEntityKindObservations(plan)');

    expect(pathResolvedAt).toBeGreaterThan(-1);
    expect(pathResolvedAt).toBeLessThan(connectionAt);
    expect(recordWrittenAt).toBeLessThan(supersedeAt);
    // The planner must not be able to write, so it never calls updateMany itself.
    expect(
      script.slice(
        script.indexOf('export async function planResearchEntityKindRetirement'),
        script.indexOf('export async function supersedeResearchEntityKindObservations'),
      ),
    ).not.toMatch(/updateMany/);
  });
});
