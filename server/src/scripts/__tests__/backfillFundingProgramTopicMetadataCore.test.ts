import { afterEach, describe, expect, it } from 'vitest';
import {
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  resetOrgUnitCanonicalizerCache,
  setOrgUnitCanonicalizerForTesting,
} from '../../scrapers/orgUnitCanonicalization';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
  resetResearchAreaCanonicalizerCache,
  setResearchAreaCanonicalizerForTesting,
} from '../../scrapers/researchAreaCanonicalization';
import {
  planFundingProgramTopicBackfillRow,
  summarizeFundingProgramTopicBackfill,
} from '../backfillFundingProgramTopicMetadataCore';

const orgRows = [{ slug: 'classics', name: 'Classics', kind: 'DEPARTMENT' as const }];
const areaRows = [{ name: 'Middle Eastern Studies' }];

function useCanonicalizers(): void {
  setOrgUnitCanonicalizerForTesting(createOrgUnitCanonicalizer(buildOrgUnitResolverIndex(orgRows)));
  setResearchAreaCanonicalizerForTesting(
    createResearchAreaCanonicalizer(buildResearchAreaResolverIndex(areaRows)),
  );
}

afterEach(() => {
  setOrgUnitCanonicalizerForTesting(null);
  setResearchAreaCanonicalizerForTesting(null);
  resetOrgUnitCanonicalizerCache();
  resetResearchAreaCanonicalizerCache();
});

describe('planFundingProgramTopicBackfillRow', () => {
  it('derives and canonicalizes a research area from a named council fund', async () => {
    useCanonicalizers();
    const row = await planFundingProgramTopicBackfillRow({
      id: 'a',
      name: 'CMES Libby Rouse Fund for Peace Fellowships',
      fullDescription: 'The Council on Middle East Studies invites applications.',
    });
    expect(row.changed).toBe(true);
    expect(row.update.researchAreas).toEqual(['Middle Eastern Studies']);
    expect(row.update.departments).toBeUndefined();
  });

  it('derives and canonicalizes a department from a named department fund', async () => {
    useCanonicalizers();
    const row = await planFundingProgramTopicBackfillRow({
      id: 'b',
      name: 'Department of Classics Undergraduate Summer Research Awards',
      fullDescription: 'The Department of Classics will make available awards.',
    });
    expect(row.changed).toBe(true);
    expect(row.update.departments).toEqual(['Classics']);
  });

  it('reports no change for a genuinely cross-disciplinary fund', async () => {
    useCanonicalizers();
    const row = await planFundingProgramTopicBackfillRow({
      id: 'c',
      name: 'Branford College Richter Summer Fellowship',
      fullDescription: 'Funds independent study and research by Branford College students.',
    });
    expect(row.changed).toBe(false);
    expect(row.update).toEqual({});
  });

  it('never overwrites an entity with an existing non-empty departments or researchAreas value', async () => {
    useCanonicalizers();
    const row = await planFundingProgramTopicBackfillRow({
      id: 'd',
      name: 'CMES Libby Rouse Fund for Peace Fellowships',
      fullDescription: 'The Council on Middle East Studies invites applications.',
      researchAreas: ['Existing Area'],
    });
    expect(row.changed).toBe(false);
    expect(row.update).toEqual({});
  });
});

describe('summarizeFundingProgramTopicBackfill', () => {
  it('tallies changed, unmapped, department, and area counts', () => {
    const summary = summarizeFundingProgramTopicBackfill([
      { id: 'a', update: { researchAreas: ['Middle Eastern Studies'] }, changed: true },
      { id: 'b', update: { departments: ['Classics'] }, changed: true },
      { id: 'c', update: {}, changed: false },
    ]);
    expect(summary).toEqual({
      scanned: 3,
      changed: 2,
      departmentsAdded: 1,
      researchAreasAdded: 1,
      unmapped: 1,
    });
  });
});
