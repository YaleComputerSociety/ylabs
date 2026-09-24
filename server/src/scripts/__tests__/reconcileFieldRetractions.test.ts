import { describe, expect, it } from 'vitest';
import { parseArgs, totalPlannedRetractions } from '../reconcileFieldRetractions';
import { fieldRetractionContracts } from '../../scrapers/fieldRetraction';

describe('observations:reconcile-field-retractions arguments', () => {
  it('is dry-run by default and defaults to every declared source', () => {
    const args = parseArgs([]);
    expect(args.apply).toBe(false);
    expect(args.confirm).toBe(false);
    expect(args.sources).toEqual(Object.keys(fieldRetractionContracts));
  });

  it('refuses a source that declares no retraction contract', () => {
    // `dept-faculty-roster` used to stand here and now declares one (#3135), so both
    // names are checked against the registry rather than assumed to stay undeclared.
    for (const source of ['ysm-atoz-index', 'official-profile-pi-backfill']) {
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
});
