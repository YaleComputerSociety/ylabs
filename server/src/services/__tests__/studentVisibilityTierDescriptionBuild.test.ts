import { describe, expect, it, vi } from 'vitest';

vi.mock('../researchEntityPublicDescription', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../researchEntityPublicDescription')>();
  return {
    ...actual,
    buildResearchEntityPublicDescriptionRepresentation: vi.fn(
      actual.buildResearchEntityPublicDescriptionRepresentation,
    ),
  };
});

import { buildResearchEntityPublicDescriptionRepresentation } from '../researchEntityPublicDescription';
import { buildResearchEntityQualitySummary } from '../researchEntityQuality';
import { computeResearchEntityStudentVisibility } from '../studentVisibilityTier';

const entity = {
  name: 'Coastal Sediment Transport Laboratory',
  kind: 'lab',
  entityType: 'LAB',
  fullDescription:
    'The laboratory measures how tides and storms move sediment along coastlines, combining field surveys with numerical models of estuary dynamics.',
  shortDescription: 'Measures how tides and storms move sediment along coastlines.',
  researchAreas: ['Coastal Geomorphology'],
  sourceUrls: ['https://example.edu/coastal-sediment'],
};

describe('computeResearchEntityStudentVisibility', () => {
  it('builds the public description representation once per verdict', () => {
    const build = vi.mocked(buildResearchEntityPublicDescriptionRepresentation);
    build.mockClear();

    computeResearchEntityStudentVisibility({ entity, leadMembers: [] });

    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe('buildResearchEntityQualitySummary', () => {
  it('reads the representation it is handed rather than building another', () => {
    const build = vi.mocked(buildResearchEntityPublicDescriptionRepresentation);
    const publicDescription = build({ entity, leadMembers: [] });
    build.mockClear();

    const handed = buildResearchEntityQualitySummary({
      entity,
      leadMembers: [],
      publicDescription,
    });

    expect(build).not.toHaveBeenCalled();
    expect(handed).toEqual(buildResearchEntityQualitySummary({ entity, leadMembers: [] }));
  });
});
