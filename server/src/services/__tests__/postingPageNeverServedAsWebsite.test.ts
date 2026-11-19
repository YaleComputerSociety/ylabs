import { describe, expect, it } from 'vitest';

import { publicResearchDetailGroup } from '../researchGroupService';
import { toPublicResearchEntityDto } from '../researchEntityDto';

const POSTING_PAGE = 'https://medicine.yale.edu/lab/quill/jobs/quillfellowship/';
const LAB_ROOT = 'https://medicine.yale.edu/lab/quill/';

const storedRow = (websiteUrl: string) => ({
  _id: 'entity-posting-website',
  slug: 'fixture-posting-website-row',
  name: 'Rafferty Duchamp Faculty Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  websiteUrl,
  sourceUrls: [LAB_ROOT],
});

describe('a stored job or fellowship posting is never served as a research website', () => {
  it('withholds the posting page while the stored row waits for its resolve', () => {
    const served = toPublicResearchEntityDto(
      publicResearchDetailGroup(storedRow(POSTING_PAGE)),
    ) as Record<string, unknown>;

    expect(served.websiteUrl).toBeUndefined();
  });

  it('serves an ordinary research website on the same host', () => {
    const served = toPublicResearchEntityDto(
      publicResearchDetailGroup(storedRow(LAB_ROOT)),
    ) as Record<string, unknown>;

    expect(served.websiteUrl).toBe(LAB_ROOT);
  });
});

describe('a stored course page is never served as a research website', () => {
  it('withholds the course page while the stored row waits for its resolve', () => {
    const served = toPublicResearchEntityDto(
      publicResearchDetailGroup(storedRow('https://fixturedept.yale.edu/courses/fixture-anatomy')),
    ) as Record<string, unknown>;

    expect(served.websiteUrl).toBeUndefined();
  });
});
