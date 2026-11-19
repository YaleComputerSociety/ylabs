import { describe, expect, it } from 'vitest';
import { toPublicResearchEntityDto, toPublicResearchEntitySummaryDto } from '../researchEntityDto';
import { buildResearchEntitySearchIndexDocument } from '../researchEntitySearchIndexService';
import { shouldIgnoreObservationForEntityMaterialization } from '../../scrapers/entityMaterializer';
import {
  RESEARCH_PAGE_TEXT_FIELD,
  RESEARCH_PAGE_TEXT_SOURCE,
} from '../../scrapers/utils/researchPageText';

const PAGE_TEXT_MARKER = 'stored-page-text-marker-that-must-never-be-served';

const rowCarryingPageText = {
  _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  slug: 'tidepool-lab-fixture',
  name: 'Tidepool Lab Fixture',
  kind: 'lab',
  entityType: 'LAB',
  researchAreas: ['Kelp forests'],
  [RESEARCH_PAGE_TEXT_FIELD]: [
    { url: 'https://tidepool-lab.example.org/', text: PAGE_TEXT_MARKER },
  ],
};

describe('research page text is never served (#5396)', () => {
  it('is never projected onto a research entity row', () => {
    expect(
      shouldIgnoreObservationForEntityMaterialization('researchEntity', {
        field: RESEARCH_PAGE_TEXT_FIELD,
        value: [{ url: 'https://tidepool-lab.example.org/', text: PAGE_TEXT_MARKER }],
        sourceName: RESEARCH_PAGE_TEXT_SOURCE,
      }),
    ).toBe(true);
  });

  it('is absent from the public DTOs even if a row carried it', () => {
    expect(JSON.stringify(toPublicResearchEntityDto(rowCarryingPageText))).not.toContain(
      PAGE_TEXT_MARKER,
    );
    expect(JSON.stringify(toPublicResearchEntitySummaryDto(rowCarryingPageText))).not.toContain(
      PAGE_TEXT_MARKER,
    );
  });

  it('is absent from the search index document even if a row carried it', () => {
    const document = buildResearchEntitySearchIndexDocument(rowCarryingPageText);
    expect(document).not.toBeNull();
    expect(document).not.toHaveProperty(RESEARCH_PAGE_TEXT_FIELD);
    expect(JSON.stringify(document)).not.toContain(PAGE_TEXT_MARKER);
  });
});
