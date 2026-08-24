import { describe, expect, it } from 'vitest';
import { buildWhy1634Plans } from '../fix1634WhyBulletFabricationPurgeCore';

describe('buildWhy1634Plans', () => {
  it('plans a partial strip when some bullets are concrete and some are fabricated', () => {
    const plans = buildWhy1634Plans([
      {
        _id: 'entity-1',
        slug: 'synthetic-lab-one',
        studentDecisionExplanation: {
          why: [
            'No posted opportunities currently available.',
            'Exploratory outreach is plausible based on the profile.',
            "Research focus aligns with interests in Alzheimer's disease.",
          ],
        },
        researchAreas: ['Dopamine', 'Huntington Disease', 'Parkinson Disease'],
        fullDescription: 'The lab studies dopamine signaling in movement disorders.',
      },
    ]);

    expect(plans).toHaveLength(1);
    expect(plans[0].unsetWholeField).toBe(false);
    expect(plans[0].keptWhy).toEqual([
      'No posted opportunities currently available.',
      'Exploratory outreach is plausible based on the profile.',
    ]);
    expect(plans[0].removedBullets).toHaveLength(1);
  });

  it('plans a full-field unset when every bullet is fabricated', () => {
    const plans = buildWhy1634Plans([
      {
        _id: 'entity-2',
        slug: 'synthetic-lab-two',
        studentDecisionExplanation: {
          why: ['Research area aligns with your interests.'],
        },
        researchAreas: ['Cell Biology'],
        fullDescription: '',
      },
    ]);

    expect(plans).toHaveLength(1);
    expect(plans[0].unsetWholeField).toBe(true);
    expect(plans[0].keptWhy).toEqual([]);
  });

  it('skips entities with no fabricated bullets', () => {
    const plans = buildWhy1634Plans([
      {
        _id: 'entity-3',
        slug: 'synthetic-lab-three',
        studentDecisionExplanation: {
          why: ['Lab is actively recruiting undergraduates for wet-lab work.'],
        },
        researchAreas: ['Cell Biology'],
        fullDescription: '',
      },
    ]);

    expect(plans).toEqual([]);
  });

  it('skips entities with no why array at all', () => {
    const plans = buildWhy1634Plans([
      { _id: 'entity-4', slug: 'synthetic-lab-four', studentDecisionExplanation: {} },
      { _id: 'entity-5', slug: 'synthetic-lab-five' },
    ]);

    expect(plans).toEqual([]);
  });
});
