import { describe, expect, it } from 'vitest';

import { publicResearchDetailGroup } from '../researchGroupService';
import { toPublicResearchEntityDto } from '../researchEntityDto';
import { sanitizeResearchEntitySourceUrlsForMaterialization } from '../../scrapers/entityMaterializer';

/**
 * A map pin is not weak provenance, it is absent provenance wearing a link: it states
 * no fact, names no author, and cannot corroborate anything (#3184).
 *
 * The fixture deliberately carries a CLEAN `websiteUrl`. #3194 already refuses a
 * directions link in that field, so a fixture with one in both fields would satisfy
 * every assertion here through the `websiteUrl` guard and leave the `sourceUrls` gap
 * invisible, which is exactly how this defect survived that pull request: one
 * `student_ready` LAB still rendered a driving-directions link in its source list.
 */
const DIRECTIONS_LINK = 'https://www.google.com/maps?directionsMode=driving&daddr=1.5,-2.5';
const RESEARCH_HOME = 'https://example-research-lab.example.org/';
const PROFILE_PAGE = 'https://medicine.example.edu/profile/fixture-example/';
// Refused as a research home by #3194 and KEPT as a citation on purpose: a media
// mention really is evidence that a person works on something.
const NEWS_ARTICLE = 'https://medicine.example.edu/news-article/a-fixture-headline/';

const documentCitingDirections = () => ({
  _id: 'entity-map-citation',
  slug: 'fixture-map-cited-lab',
  name: 'Example Research Lab',
  kind: 'lab',
  entityType: 'LAB',
  websiteUrl: RESEARCH_HOME,
  sourceUrls: [PROFILE_PAGE, DIRECTIONS_LINK, NEWS_ARTICLE],
});

describe('a map pin is never served as a citation (#3184)', () => {
  it('strips the directions link from the served detail payload and keeps the real citations', () => {
    const narrowed = publicResearchDetailGroup(documentCitingDirections()) as Record<string, any>;
    const served = toPublicResearchEntityDto(narrowed) as Record<string, any>;

    expect(served.sourceUrls).toEqual([PROFILE_PAGE, NEWS_ARTICLE]);
    expect(served.websiteUrl).toBe(RESEARCH_HOME);
  });

  /**
   * The write-time copy declines more than the serve-time one, and deliberately so:
   * it already drops any content-page path, `NEWS_ARTICLE` among them, while the
   * served payload keeps that citation as provenance. Asserted with both layers side
   * by side rather than with one fixture each, because the asymmetry is the thing a
   * future author would otherwise "fix" in the wrong direction.
   */
  it('drops it at materialization, so no reader of the stored field sees it', () => {
    expect(
      sanitizeResearchEntitySourceUrlsForMaterialization([
        PROFILE_PAGE,
        DIRECTIONS_LINK,
        NEWS_ARTICLE,
      ]),
    ).toEqual([PROFILE_PAGE]);
  });

  it('leaves a row whose citations are all real pages untouched', () => {
    const narrowed = publicResearchDetailGroup({
      ...documentCitingDirections(),
      sourceUrls: [PROFILE_PAGE, NEWS_ARTICLE],
    }) as Record<string, any>;
    const served = toPublicResearchEntityDto(narrowed) as Record<string, any>;

    expect(served.sourceUrls).toEqual([PROFILE_PAGE, NEWS_ARTICLE]);
  });
});
