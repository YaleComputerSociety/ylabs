import { describe, expect, it } from 'vitest';
import {
  buildPersonalHomepageResearchEntityRepairPlan,
  rewriteGeneratedLabDescription,
  transformGeneratedLabName,
  type PersonalHomepageResearchEntity,
} from '../repairPersonalHomepageResearchEntitiesCore';

const entity = (
  overrides: Partial<PersonalHomepageResearchEntity> = {},
): PersonalHomepageResearchEntity => ({
  id: 'entity-personal-homepage',
  slug: 'fixture-personal-homepage',
  name: 'Fixture Professor Lab',
  kind: 'lab',
  entityType: 'LAB',
  websiteUrl: 'https://profiles.example.edu/homes/fixture-professor/',
  sourceUrls: ['https://profiles.example.edu/homes/fixture-professor/'],
  shortDescription: 'The Fixture Professor Lab studies distributed algorithms.',
  fullDescription:
    "Fixture Professor Lab specializes in distributed algorithms. The lab's work includes population protocols.",
  description: 'The Fixture Professor Lab focuses on distributed algorithms.',
  ...overrides,
});

describe('personal homepage research entity repair core', () => {
  it('plans a safe faculty-research repair for a CS personal homepage false lab', () => {
    const plan = buildPersonalHomepageResearchEntityRepairPlan({
      entities: [entity()],
      observations: [
        {
          id: 'obs-kind',
          entityId: 'entity-personal-homepage',
          entityKey: 'fixture-personal-homepage',
          field: 'kind',
          sourceName: 'dept-faculty-roster',
          value: 'lab',
        },
        {
          id: 'obs-name',
          entityId: 'entity-personal-homepage',
          entityKey: 'fixture-personal-homepage',
          field: 'name',
          sourceName: 'dept-faculty-roster',
          value: 'Fixture Professor Lab',
        },
      ],
      pathways: [
        {
          id: 'pathway-1',
          researchEntityId: 'entity-personal-homepage',
          bestNextStep:
            'Review the PI profile and lab site first, then decide whether targeted exploratory outreach is appropriate.',
          explanation:
            'An official Yale faculty profile is available even though no structured join page or posted opening was found.',
        },
      ],
      contactRoutes: [],
      accessSignals: [],
    });

    expect(plan.repairs).toHaveLength(1);
    expect(plan.reviewNeeded).toEqual([]);
    expect(plan.repairs[0]).toMatchObject({
      researchEntityId: 'entity-personal-homepage',
      slug: 'fixture-personal-homepage',
      oldName: 'Fixture Professor Lab',
      newName: 'Fixture Professor — Research',
      staleObservationIds: ['obs-kind', 'obs-name'],
      entitySet: expect.objectContaining({
        name: 'Fixture Professor — Research',
        kind: 'individual',
        entityType: 'INDIVIDUAL_RESEARCH',
        shortDescription: 'Fixture Professor studies distributed algorithms.',
        fullDescription:
          "Fixture Professor specializes in distributed algorithms. Fixture Professor's work includes population protocols.",
        description: 'Fixture Professor focuses on distributed algorithms.',
      }),
    });
    expect(plan.repairs[0].artifactTextUpdates).toEqual([
      expect.objectContaining({
        artifactType: 'EntryPathway',
        id: 'pathway-1',
        set: expect.objectContaining({
          bestNextStep:
            'Review the PI profile and research site first, then decide whether targeted exploratory outreach is appropriate.',
        }),
      }),
    ]);
  });

  it('skips explicit lab-looking URLs even when the entity is currently a lab', () => {
    const plan = buildPersonalHomepageResearchEntityRepairPlan({
      entities: [
        entity({
          id: 'entity-lab',
          slug: 'fixture-explicit-lab-url',
          name: 'Explicit Fixture Lab',
          websiteUrl: 'https://fixturelab.example.org/',
          sourceUrls: ['https://fixturelab.example.org/'],
        }),
      ],
      observations: [],
      pathways: [],
      contactRoutes: [],
      accessSignals: [],
    });

    expect(plan.repairs).toEqual([]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        researchEntityId: 'entity-lab',
        slug: 'fixture-explicit-lab-url',
        reason: 'not-personal-homepage-url',
      }),
    ]);
  });

  it('sends non-exact lab names to review instead of guessing a new name', () => {
    const plan = buildPersonalHomepageResearchEntityRepairPlan({
      entities: [
        entity({
          name: 'Distributed Computing Group',
          shortDescription: '',
          fullDescription: '',
        }),
      ],
      observations: [],
      pathways: [],
      contactRoutes: [],
      accessSignals: [],
    });

    expect(plan.repairs).toEqual([]);
    expect(plan.reviewNeeded).toEqual([
      expect.objectContaining({
        researchEntityId: 'entity-personal-homepage',
        slug: 'fixture-personal-homepage',
        reason: 'non-generated-lab-name',
        name: 'Distributed Computing Group',
        websiteUrl: 'https://profiles.example.edu/homes/fixture-professor/',
      }),
    ]);
  });

  it('does not rewrite descriptions when the old generated lab name is absent', () => {
    expect(
      rewriteGeneratedLabDescription(
        'This profile discusses algorithms and distributed computing.',
        'Fixture Professor Lab',
        'Fixture Professor — Research',
      ),
    ).toBe('This profile discusses algorithms and distributed computing.');
  });

  it('transforms exact generated lab names only', () => {
    expect(transformGeneratedLabName('Fixture Professor Lab')).toBe('Fixture Professor — Research');
    expect(transformGeneratedLabName('Distributed Computing Group')).toBeNull();
  });
});
