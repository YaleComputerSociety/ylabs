import { describe, expect, it } from 'vitest';

import { publicResearchDetailGroup } from '../researchGroupService';
import { toPublicResearchEntityDto } from '../researchEntityDto';
import { sanitizeResearchEntitySourceUrlsForMaterialization } from '../../scrapers/entityMaterializer';

/**
 * #2548 refused a fundraising page as a `websiteUrl` and left the `sourceUrls` half
 * to the #2550 repair, so the fixtures here deliberately carry a CLEAN `websiteUrl`.
 * With a donor page in both fields the `websiteUrl` guard would satisfy every
 * assertion and the `sourceUrls` gap would stay invisible, which is the mistake
 * #2548's own mutation check surfaced.
 */
const DONOR_PAGE =
  'https://ysph.yale.edu/about-school-of-public-health/charitable-opportunities/donors-make-a-difference/example-research-fund/';
const RESEARCH_HOME = 'https://example-research-lab.example.org/';
const PROFILE_PAGE = 'https://medicine.example.edu/profile/fixture-example/';

const documentCitingDonorPage = () => ({
  _id: 'entity-advancement-citation',
  slug: 'fixture-advancement-cited-lab',
  name: 'Example Research Lab',
  kind: 'lab',
  entityType: 'LAB',
  websiteUrl: RESEARCH_HOME,
  sourceUrls: [PROFILE_PAGE, DONOR_PAGE],
  fieldProvenance: {
    shortDescription: { sourceName: 'fixture-faculty', sourceUrl: DONOR_PAGE },
  },
});

describe('an institutional advancement page is never served as a citation (#2614)', () => {
  /**
   * Asserted on the DTO rather than on the narrowed intermediate: #2360 moved the
   * `sourceUrls` narrowing out of `publicResearchDetailGroup` into
   * `publicResearchEntitySourceUrls`, because narrowing it earlier hid a shared
   * academic host root from the display-name pass. The invariant is that no served
   * payload carries the donor page, so it belongs on the layer that now owns it.
   */
  it('strips the donor page from the served detail payload and keeps the real citation', () => {
    const narrowed = publicResearchDetailGroup(documentCitingDonorPage()) as Record<string, any>;
    const served = toPublicResearchEntityDto(narrowed) as Record<string, any>;

    expect(served.sourceUrls).toEqual([PROFILE_PAGE]);
    expect(served.websiteUrl).toBe(RESEARCH_HOME);
  });

  it('withholds the donor page from the served source-field contributions', () => {
    const narrowed = publicResearchDetailGroup(documentCitingDonorPage()) as Record<string, any>;
    const contributions = narrowed.sourceFieldContributions ?? [];

    expect(
      contributions.some((entry: Record<string, unknown>) => entry.sourceUrl === DONOR_PAGE),
    ).toBe(false);
  });

  it('keeps the donor page out of the DTO built from the narrowed document', () => {
    const narrowed = publicResearchDetailGroup(documentCitingDonorPage()) as Record<string, any>;
    const dto = toPublicResearchEntityDto(narrowed);

    expect(dto.sourceUrls).toEqual([PROFILE_PAGE]);
  });

  it('drops the donor page at materialization, so no reader of the stored field sees it', () => {
    expect(sanitizeResearchEntitySourceUrlsForMaterialization([PROFILE_PAGE, DONOR_PAGE])).toEqual([
      PROFILE_PAGE,
    ]);
  });

  it('leaves a row whose citations are all research pages untouched', () => {
    const narrowed = publicResearchDetailGroup({
      _id: 'entity-advancement-control',
      slug: 'fixture-donor-conception-lab',
      name: 'Donor Conception Studies Group',
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: RESEARCH_HOME,
      sourceUrls: [
        PROFILE_PAGE,
        'https://example.yale.edu/research/donor-conception-studies-group/',
      ],
    }) as Record<string, any>;

    expect(narrowed.sourceUrls).toEqual([
      PROFILE_PAGE,
      'https://example.yale.edu/research/donor-conception-studies-group/',
    ]);
  });
});
