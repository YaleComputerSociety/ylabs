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
    expect(() => parseArgs(['--source=dept-faculty-roster'])).toThrow(
      /declares no field-retraction contract/,
    );
    expect(() => parseArgs(['--source', 'ysm-atoz-index'])).toThrow(
      /declares no field-retraction contract/,
    );
  });

  it('accepts a declared source', () => {
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
            },
            {
              entityId: 'b',
              entityKey: 'b',
              field: 'websiteUrl',
              observationIds: ['2'],
              clearsStoredValue: false,
            },
          ],
        },
      ]),
    ).toBe(2);
  });
});
