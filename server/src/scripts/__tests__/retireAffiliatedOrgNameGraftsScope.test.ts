import { describe, expect, it } from 'vitest';
import { parseArgs, restrictRowsToSlugs } from '../retireAffiliatedOrgNameGrafts';
import type { OrgNameGraftRow } from '../retireAffiliatedOrgNameGrafts';

const row = (entitySlug: string): OrgNameGraftRow =>
  ({ entitySlug, observationIds: ['a'], websiteObservationIds: [] }) as unknown as OrgNameGraftRow;

describe('retireAffiliatedOrgNameGrafts apply scope', () => {
  it('parses --slugs in both spellings and rejects an empty list', () => {
    expect(parseArgs(['--slugs=one,two']).slugs).toEqual(['one', 'two']);
    expect(parseArgs(['--slugs', ' one , two ']).slugs).toEqual(['one', 'two']);
    expect(() => parseArgs(['--slugs='])).toThrow('--slugs requires at least one entity slug');
  });

  it('scans corpus-wide but writes only the named rows', () => {
    const rows = [row('one'), row('two'), row('three')];
    expect(restrictRowsToSlugs(rows, ['two']).map((entry) => entry.entitySlug)).toEqual(['two']);
    // Without the flag the repair keeps its whole-corpus behaviour, so an operator who
    // wants the backlog drained still gets it in one run.
    expect(restrictRowsToSlugs(rows, undefined)).toHaveLength(3);
  });
});
