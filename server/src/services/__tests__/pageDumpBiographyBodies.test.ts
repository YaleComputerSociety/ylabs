import { describe, expect, it } from 'vitest';

import { isCurriculumVitaeShapedBody } from '../../utils/careerBiographyDescription';
import { buildResearchEntityPublicDescriptionRepresentation } from '../researchEntityPublicDescription';

const STATEMENT =
  'Sam is a cultural sociologist whose scholarship focuses on the intersection of reef tourism, migration, and coastal identity.';

const row = (overrides: Record<string, any>): Record<string, any> => ({
  slug: 'fixture-page-dump-body',
  name: 'Sam Synthetic Faculty Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  researchAreas: ['Sociology of Tourism'],
  sourceUrls: ['https://example.edu/fixture-page-dump-body'],
  shortDescription: STATEMENT,
  ...overrides,
});

const PAGE_DUMP = [
  'Rev. Sam Synthetic, PhD Associate Director and Director of Research Lecturer Center for Coastal Policy From the CCP website: Sam Synthetic is the Associate Director of the Center for Coastal Policy at the Example School.',
  STATEMENT,
  'He is the author of Reef Gospel and the Coastal Dream (Example University Press, 2020).',
  'He was previously a Research Scholar at the Institute for Coastal Culture at Example University where he held numerous positions.',
  'His work has been featured in The Example Monthly, The Sample Post, and other media outlets.',
  'Synthetic has held appointments at Example University and Sample Seminary.',
  'He is an ordained Presbyterian minister who served congregations in three states.',
  'He is currently the interim pastor at an Example Village church.',
].join(' ');

describe('a profile page pasted with its title block, quote label and career record', () => {
  it('reads as a CV-shaped body', () => {
    expect(isCurriculumVitaeShapedBody(PAGE_DUMP)).toBe(true);
  });

  it('serves only its research statement, which also stays the card', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: row({ fullDescription: PAGE_DUMP }),
      leadMemberNames: ['Rev. Sam Synthetic'],
    });

    expect(representation.fullDescription).toBe(STATEMENT);
    expect(representation.invariant.pass).toBe(true);
    expect(representation.invariant.cardDescriptionUseful).toBe(true);
  });
});
