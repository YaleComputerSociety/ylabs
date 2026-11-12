import { describe, expect, it } from 'vitest';
import {
  parseArgs,
  plannedUserRederives,
  scopedUserRederiver,
  summarizePreFixAbsenceClaimExclusions,
  totalPlannedRetractions,
  userRederiveOnlyFields,
  type ScopedUserRederiveRow,
} from '../reconcileFieldRetractions';
import {
  fieldRetractionContracts,
  type UserFieldRetractionResult,
} from '../../scrapers/fieldRetraction';

describe('observations:reconcile-field-retractions arguments', () => {
  it('is dry-run by default and defaults to every declared source', () => {
    const args = parseArgs([]);
    expect(args.apply).toBe(false);
    expect(args.confirm).toBe(false);
    expect(args.sources).toEqual(Object.keys(fieldRetractionContracts));
  });

  it('refuses a source that declares no retraction contract', () => {
    // `dept-faculty-roster` (#3135) and `official-profile-pi-backfill` (#4544) used to stand
    // here and now declare one, so the name is checked against the registry rather than
    // assumed to stay undeclared.
    for (const source of ['ysm-atoz-index']) {
      expect(fieldRetractionContracts).not.toHaveProperty(source);
      expect(() => parseArgs([`--source=${source}`])).toThrow(
        /declares no field-retraction contract/,
      );
    }
  });

  it('accepts a declared source', () => {
    expect(parseArgs(['--source=dept-faculty-roster']).sources).toEqual(['dept-faculty-roster']);
    expect(parseArgs(['--source=ysm-faculty-directory']).sources).toEqual([
      'ysm-faculty-directory',
    ]);
    expect(parseArgs(['--source=official-profile-pi-backfill']).sources).toEqual([
      'official-profile-pi-backfill',
    ]);
  });

  it('rejects an unusable apply ceiling', () => {
    expect(() => parseArgs(['--max-apply=0'])).toThrow(/safe positive integer/);
    expect(() => parseArgs(['--max-apply', 'many'])).toThrow(/safe positive integer/);
    expect(parseArgs(['--max-apply=25']).maxApply).toBe(25);
  });

  it('counts planned retractions across sources for the apply ceiling', () => {
    expect(
      totalPlannedRetractions([
        {
          outcome: 'planned',
          dryRun: true,
          counts: {} as any,
          frozenFields: [],
          regatedEntities: 0,
          retractions: [
            {
              entityId: 'a',
              entityKey: 'a',
              field: 'websiteUrl',
              observationIds: ['1'],
              clearsStoredValue: true,
              retractedValues: ['https://example.org/a'],
              maxEntitiesSharingAValue: 1,
            },
            {
              entityId: 'b',
              entityKey: 'b',
              field: 'websiteUrl',
              observationIds: ['2'],
              clearsStoredValue: false,
              retractedValues: ['https://example.org/b'],
              maxEntitiesSharingAValue: 1,
            },
          ],
        },
      ]),
    ).toBe(2);
  });

  it('reports the pre-fix claims each source and field excluded', () => {
    expect(
      summarizePreFixAbsenceClaimExclusions([
        {
          outcome: 'planned',
          sourceName: 'fixture-source-a',
          dryRun: true,
          counts: {
            preFixAbsenceClaims: {
              websiteUrl: { excludedClaims: 7, heldObservations: 3, heldEntities: 2 },
            },
          } as any,
          frozenFields: [],
          regatedEntities: 0,
          retractions: [],
        },
        {
          outcome: 'planned',
          sourceName: 'fixture-source-b',
          dryRun: true,
          counts: { preFixAbsenceClaims: {} } as any,
          frozenFields: [],
          regatedEntities: 0,
          retractions: [],
        },
      ]),
    ).toEqual([
      {
        sourceName: 'fixture-source-a',
        field: 'websiteUrl',
        excludedClaims: 7,
        heldObservations: 3,
        heldEntities: 2,
      },
    ]);
  });
});

describe('observations:reconcile-field-retractions user re-derive scope (#5711, #5991)', () => {
  const retraction = (entityKey: string, field: string) => ({
    entityKey,
    sourceUrl: 'https://fixture6001.example.edu/people/a',
    field,
    observationIds: [`obs-${entityKey}-${field}`],
  });
  const result = (retractions: ReturnType<typeof retraction>[]) =>
    ({ sourceName: 'dept-faculty-roster', retractions }) as unknown as UserFieldRetractionResult;

  it('scopes each retracted field to its own user materializer paths', () => {
    expect(userRederiveOnlyFields(['email'])).toEqual(['identifiers.email']);
    expect(userRederiveOnlyFields(['orcid'])).toEqual(['identifiers.orcid']);
    expect(userRederiveOnlyFields(['orcid', 'email', 'email'])).toEqual([
      'identifiers.email',
      'identifiers.orcid',
    ]);
  });

  it('refuses a field it cannot scope rather than re-deriving unscoped', () => {
    expect(() => userRederiveOnlyFields(['netid'])).toThrow(/no user materializer scope/);
    expect(() => userRederiveOnlyFields([])).toThrow(/needs a retracted field/);
    expect(() => plannedUserRederives([result([retraction('k1', 'netid')])])).toThrow(
      /refusing an unscoped re-derive/,
    );
  });

  it('plans one scoped re-derive per subject with only the retracted paths', () => {
    expect(
      plannedUserRederives([
        result([retraction('k1', 'email'), retraction('k2', 'orcid'), retraction('k2', 'email')]),
      ]),
    ).toEqual([
      {
        sourceName: 'dept-faculty-roster',
        entityKey: 'k1',
        retractedFields: ['email'],
        onlyFields: ['identifiers.email'],
        plannedPaths: ['identifiers.email', 'identifiers.emailSupport'],
      },
      {
        sourceName: 'dept-faculty-roster',
        entityKey: 'k2',
        retractedFields: ['email', 'orcid'],
        onlyFields: ['identifiers.email', 'identifiers.orcid'],
        plannedPaths: [
          'identifiers.email',
          'identifiers.emailSupport',
          'identifiers.orcid',
          'profileLinks.ORCID',
        ],
      },
    ]);
  });

  it('passes the scope to the materializer and records what it wrote', async () => {
    const rows: ScopedUserRederiveRow[] = [];
    const calls: Array<[string, readonly string[]]> = [];
    const rederive = scopedUserRederiver(async (entityKey, onlyFields) => {
      calls.push([entityKey, onlyFields]);
      return { fieldsWritten: 2, plannedPaths: ['identifiers.orcid', 'profileLinks.ORCID'] };
    }, rows);
    await rederive({ entityKey: 'k2' }, ['orcid']);
    expect(calls).toEqual([['k2', ['identifiers.orcid']]]);
    expect(rows).toEqual([
      {
        entityKey: 'k2',
        onlyFields: ['identifiers.orcid'],
        fieldsWritten: 2,
        plannedPaths: ['identifiers.orcid', 'profileLinks.ORCID'],
        droppedPaths: [],
      },
    ]);
    await expect(rederive({ entityKey: 'k3' }, ['netid'])).rejects.toThrow(/no user materializer/);
    expect(calls).toHaveLength(1);
  });
});
