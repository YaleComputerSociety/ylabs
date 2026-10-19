import { describe, expect, it } from 'vitest';

import { publicResearchDetailGroup } from '../researchGroupService';
import { toPublicResearchEntityDto } from '../researchEntityDto';
import {
  CROSSREF_GRANT_WORKS_URL,
  crossrefGrantUrl,
} from '../../scrapers/sources/crossrefGrantScraper';
import { NSF_API_URL } from '../../scrapers/sources/nsfAwardScraper';
import { DOE_PAMS_AWARD_SEARCH_URL } from '../../scrapers/sources/doeScienceAwardScraper';

const RESEARCH_HOME = 'https://example-research-lab.example.org/';
const GRANT_PAGE = crossrefGrantUrl('10.99999/fixture-grant-1');

const grantLedRow = (overrides: Record<string, unknown> = {}) => ({
  _id: 'entity-grant-endpoint-citation',
  slug: 'fixture-grant-endpoint-lab',
  name: 'Example Research Lab',
  kind: 'lab',
  entityType: 'LAB',
  websiteUrl: RESEARCH_HOME,
  sourceUrls: [RESEARCH_HOME, NSF_API_URL],
  recentGrants: [
    {
      id: 'FIXTURE-1',
      agency: 'Example Foundation',
      title: 'Fixture grant',
      role: 'pi',
      url: GRANT_PAGE,
    },
  ],
  fieldProvenance: {
    inferredPiUserId: { sourceUrl: CROSSREF_GRANT_WORKS_URL },
    recentGrants: { sourceUrl: CROSSREF_GRANT_WORKS_URL },
    websiteUrl: { sourceUrl: RESEARCH_HOME },
  },
  ...overrides,
});

const served = (row: Record<string, unknown>) =>
  toPublicResearchEntityDto(publicResearchDetailGroup(row)) as Record<string, any>;

const citedUrls = (dto: Record<string, any>): string[] => [
  ...(dto.sourceUrls ?? []),
  ...(dto.sourceFieldContributions ?? []).map((entry: { sourceUrl: string }) => entry.sourceUrl),
];

describe('a grant lane discovery endpoint is never served as a citation (#5261)', () => {
  it('credits the lead to the grant page the row serves instead of the endpoint', () => {
    const dto = served(grantLedRow());

    expect(dto.sourceFieldContributions).toContainEqual({
      sourceUrl: GRANT_PAGE,
      contributions: ['Who leads it'],
    });
    expect(citedUrls(dto)).not.toContain(CROSSREF_GRANT_WORKS_URL);
  });

  it('drops an endpoint stored in the citations', () => {
    expect(served(grantLedRow()).sourceUrls).toEqual([RESEARCH_HOME]);
  });

  it('drops the credit when the row serves no grant page of its own', () => {
    for (const recentGrants of [[], [{ role: 'pi', url: DOE_PAMS_AWARD_SEARCH_URL }]]) {
      const dto = served(
        grantLedRow({
          recentGrants,
          fieldProvenance: { inferredPiUserId: { sourceUrl: DOE_PAMS_AWARD_SEARCH_URL } },
        }),
      );
      expect(citedUrls(dto).filter((url) => url !== RESEARCH_HOME)).toEqual([]);
    }
  });

  it('never cites a grant that has ended, because the row no longer serves it', () => {
    const dto = served(
      grantLedRow({
        recentGrants: [{ role: 'pi', url: GRANT_PAGE, endDate: '2001-01-01T00:00:00.000Z' }],
      }),
    );
    expect(dto.recentGrants).toEqual([]);
    expect(citedUrls(dto)).not.toContain(GRANT_PAGE);
    expect(citedUrls(dto)).not.toContain(CROSSREF_GRANT_WORKS_URL);
  });

  it('leaves a lead credited to a readable page untouched', () => {
    const dto = served(
      grantLedRow({ fieldProvenance: { inferredPiUserId: { sourceUrl: RESEARCH_HOME } } }),
    );
    expect(dto.sourceFieldContributions).toEqual([
      { sourceUrl: RESEARCH_HOME, contributions: ['Who leads it'] },
    ]);
  });
});
