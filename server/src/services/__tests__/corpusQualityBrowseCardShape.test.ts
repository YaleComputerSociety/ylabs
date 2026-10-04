import { describe, expect, it } from 'vitest';

import { browseCardIsCutMidSentence, browseCardSummary } from '../../utils/browseCardSummary';
import { servedRowFacts } from '../corpusQualityReport';
import { addResearchEntitySearchAliases } from '../researchEntityDto';

const servedRow = (shortDescription: string) => ({
  _id: 'fixture-id',
  slug: 'dept-fictional-studies-robin-roster',
  name: 'Robin Roster Faculty Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  studentVisibilityTier: 'student_ready',
  departments: ['Fictional Studies'],
  fullDescription:
    'Studies medieval manuscript transmission and scribal practice across fictional archives, with attention to marginalia.',
  shortDescription,
  researchAreas: ['Medieval Manuscripts'],
});

describe('servedRowFacts browse card shape', () => {
  it('flags a single card sentence too long for the card as cut mid-sentence', () => {
    const facts = servedRowFacts(
      servedRow(
        'Studies medieval manuscript transmission, scribal practice, marginal annotation, binding structures, ownership inscriptions, and the movement of fictional archives between monastic, princely, and university collections over five centuries of change.',
      ),
      ['Robin Roster'],
    );

    expect(facts.browseCardCutMidSentence).toBe(true);
    expect(facts.browseCardSixWordsOrFewer).toBe(false);
  });

  it('leaves a card that fits whole unflagged', () => {
    const facts = servedRowFacts(
      servedRow(
        'Studies medieval manuscript transmission and scribal practice in fictional archives.',
      ),
      ['Robin Roster'],
    );

    expect(facts.browseCardCutMidSentence).toBe(false);
    expect(facts.browseCardSixWordsOrFewer).toBe(false);
  });

  it('measures the card the browse list serves, not a short the serve path withholds', () => {
    const row = {
      ...servedRow(
        'The Fictional Center for Ocean Robotics builds underwater vehicles for marine science expeditions.',
      ),
      fullDescription:
        'Studies medieval manuscript transmission, scribal practice, marginal annotation, binding structures, ownership inscriptions, and the movement of fictional archives between monastic, princely, and university collections over five centuries of change. The work also examines how readers annotated books.',
      slug: 'fixture-row',
      sourceUrls: ['https://example.edu/a'],
    };
    const leadMemberNames = ['Robin Roster'];
    const [listed] = addResearchEntitySearchAliases(
      { hits: [row] },
      { leadMemberNamesByEntityId: new Map([[row._id, leadMemberNames]]) },
    ).researchEntities;
    const servedCard = browseCardSummary(listed.cardDescription?.text || '');

    const facts = servedRowFacts(row, leadMemberNames);

    expect(browseCardIsCutMidSentence(servedCard)).toBe(true);
    expect(facts.browseCardCutMidSentence).toBe(true);
  });
});
