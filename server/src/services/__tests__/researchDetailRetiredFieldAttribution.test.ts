import { describe, expect, it } from 'vitest';

import { publicResearchDetailGroup } from '../researchGroupService';
import { toPublicResearchEntityDto } from '../researchEntityDto';

const PROFILE_URL = 'https://medicine.example.edu/profile/fixture-attribution/';
const LAB_URL = 'https://example.edu/lab/fixture-attribution/';

/**
 * A row whose stored provenance records the retired `studentDecisionExplanation`
 * alongside fields that still serve. The engine keeps projecting the retired
 * field because its observations are still live, so the provenance entry is the
 * normal state of the corpus rather than a corruption to repair.
 */
const storedRow = () => ({
  _id: 'entity-retired-attribution',
  slug: 'fixture-attribution-lab',
  name: 'Fixture Attribution Lab',
  kind: 'lab',
  entityType: 'LAB',
  studentVisibilityTier: 'student_ready',
  shortDescription: 'Studies estuarine sediment transport along the Connecticut shoreline.',
  fullDescription:
    'The lab measures estuarine sediment transport along the Connecticut shoreline, combining moored instrumentation, sediment coring, and hydrodynamic modelling across seasons.',
  sourceUrls: [LAB_URL, PROFILE_URL],
  websiteUrl: LAB_URL,
  sourceLinkHealth: [
    { url: LAB_URL, healthStatus: 'LIVE', httpStatusCode: 200 },
    { url: PROFILE_URL, healthStatus: 'LIVE', httpStatusCode: 200 },
  ],
  fieldProvenance: {
    fullDescription: { sourceName: 'fixture-lab-site', sourceUrl: LAB_URL },
    studentDecisionExplanation: { sourceName: 'fixture-profile', sourceUrl: PROFILE_URL },
  },
});

const servedContributions = (row: Record<string, unknown>) =>
  (
    toPublicResearchEntityDto(publicResearchDetailGroup(row)) as {
      sourceFieldContributions?: Array<{ sourceUrl: string; contributions: string[] }>;
    }
  ).sourceFieldContributions || [];

describe('served source attribution for a retired field (#2688)', () => {
  it('credits only the url backing content a student can read', () => {
    expect(servedContributions(storedRow())).toEqual([
      { sourceUrl: LAB_URL, contributions: ['Research summary'] },
    ]);
  });

  it('names no contribution at all when every provenance key is retired', () => {
    const row = storedRow();
    row.fieldProvenance = {
      studentDecisionExplanation: { sourceName: 'fixture-profile', sourceUrl: PROFILE_URL },
    } as typeof row.fieldProvenance;

    expect(servedContributions(row)).toEqual([]);
  });
});
