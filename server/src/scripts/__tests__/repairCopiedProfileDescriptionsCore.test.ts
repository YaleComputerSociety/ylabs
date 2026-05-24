import { describe, expect, it } from 'vitest';
import {
  buildCopiedProfileDescriptionRepairPlan,
  chooseReplacementDescriptionValue,
} from '../repairCopiedProfileDescriptionsCore';

describe('repairCopiedProfileDescriptionsCore', () => {
  it('plans stale copied PI-bio research-entity description observations for repair', () => {
    const piBio =
      'My research interests focus on synthetic social cognition processes that help teams coordinate decisions in changing environments.';

    const plan = buildCopiedProfileDescriptionRepairPlan({
      entities: [
        {
          id: 'entity-1',
          slug: 'dept-psych-synthetic-pi',
          name: 'Synthetic PI Lab',
          description: piBio,
          shortDescription: 'My research interests focus on synthetic social cognition processes',
          fullDescription: piBio,
        },
      ],
      members: [
        {
          researchEntityId: 'entity-1',
          userId: 'user-1',
          role: 'pi',
          isCurrentMember: true,
        },
      ],
      users: [{ id: 'user-1', netid: 'example-pi', name: 'Synthetic PI', bio: piBio }],
      observations: [
        {
          id: 'obs-stale-description',
          entityKey: 'dept-psych-synthetic-pi',
          field: 'description',
          value: piBio,
          sourceName: 'dept-faculty-roster',
          confidence: 0.7,
          observedAt: new Date('2026-05-15T00:00:00Z'),
        },
        {
          id: 'obs-lab-description',
          entityKey: 'dept-psych-synthetic-pi',
          field: 'description',
          value: 'The Example Relationship Science Lab studies close relationships.',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.55,
          observedAt: new Date('2026-05-17T00:00:00Z'),
        },
      ],
    });

    expect(plan.repairs).toEqual([
      {
        researchEntityId: 'entity-1',
        slug: 'dept-psych-synthetic-pi',
        name: 'Synthetic PI Lab',
        piNetids: ['example-pi'],
        staleObservationIds: ['obs-stale-description'],
        staleFields: ['description'],
        copiedCurrentFields: ['description', 'shortDescription', 'fullDescription'],
        replacementFields: {
          description: {
            value: 'The Example Relationship Science Lab studies close relationships.',
            confidence: 0.55,
            sourceName: 'lab-microsite-description-llm',
          },
          shortDescription: null,
          fullDescription: null,
        },
      },
    ]);
  });

  it('prefers the strongest non-copied observation as the replacement', () => {
    const replacement = chooseReplacementDescriptionValue([
      {
        id: 'older',
        field: 'description',
        value: 'Older lab description.',
        sourceName: 'lab-microsite-description-llm',
        confidence: 0.5,
        observedAt: new Date('2026-05-16T00:00:00Z'),
      },
      {
        id: 'newer-weaker',
        field: 'description',
        value: 'Newer weak description.',
        sourceName: 'openalex',
        confidence: 0.3,
        observedAt: new Date('2026-05-17T00:00:00Z'),
      },
    ]);

    expect(replacement).toEqual({
      value: 'Older lab description.',
      confidence: 0.5,
      sourceName: 'lab-microsite-description-llm',
    });
  });
});
