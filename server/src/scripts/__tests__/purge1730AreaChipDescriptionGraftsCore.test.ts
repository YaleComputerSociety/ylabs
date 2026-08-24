import { describe, expect, it } from 'vitest';
import {
  planAreaChipDescriptionGraftCleanup,
  planAreaGraftRemoval,
  summarizeAreaChipDescriptionGraftPlans,
  type AreaChipDescriptionGraftDirective,
} from '../purge1730AreaChipDescriptionGraftsCore';

describe('planAreaGraftRemoval', () => {
  it('drops only the named areas, case/whitespace-insensitively', () => {
    const result = planAreaGraftRemoval(
      ['Sodium Channels', '  Glaucoma and retinal disorders  ', 'Neurons'],
      ['glaucoma and retinal disorders'],
    );
    expect(result.cleaned).toEqual(['Sodium Channels', 'Neurons']);
    expect(result.removed).toEqual(['  Glaucoma and retinal disorders  ']);
    expect(result.changed).toBe(true);
  });

  it('is a no-op when none of the named areas are present', () => {
    const result = planAreaGraftRemoval(['Sodium Channels'], ['Glaucoma and retinal disorders']);
    expect(result.cleaned).toEqual(['Sodium Channels']);
    expect(result.changed).toBe(false);
  });
});

describe('planAreaChipDescriptionGraftCleanup', () => {
  const directive: AreaChipDescriptionGraftDirective = {
    entityId: '6a058dd4ba66f3c14bd860d1',
    slug: 'dib-hajj-lab',
    removeAreas: ['Glaucoma and retinal disorders', 'Ocular Surface and Contact Lens'],
    replaceFullDescriptionIfEquals: {
      from: 'Wrong-domain full description.',
      to: 'Corrected, source-grounded full description.',
    },
    replaceShortDescriptionIfEquals: {
      from: 'Wrong-domain short description.',
      to: 'Corrected short description.',
    },
  };

  it('removes the grafted areas and replaces both descriptions when they still match', () => {
    const plan = planAreaChipDescriptionGraftCleanup(
      {
        researchAreas: ['Glaucoma and retinal disorders', 'Ocular Surface and Contact Lens', 'Sodium Channels'],
        fullDescription: 'Wrong-domain full description.',
        shortDescription: 'Wrong-domain short description.',
      },
      directive,
    );
    expect(plan.areasAfter).toEqual(['Sodium Channels']);
    expect(plan.removedAreas).toEqual(['Glaucoma and retinal disorders', 'Ocular Surface and Contact Lens']);
    expect(plan.missingRemoveAreas).toEqual([]);
    expect(plan.fullDescriptionReplaced).toBe(true);
    expect(plan.fullDescriptionAfter).toBe('Corrected, source-grounded full description.');
    expect(plan.shortDescriptionReplaced).toBe(true);
    expect(plan.shortDescriptionAfter).toBe('Corrected short description.');
    expect(plan.changed).toBe(true);
  });

  it('leaves a description untouched when it has already drifted from the expected wrong value', () => {
    const plan = planAreaChipDescriptionGraftCleanup(
      {
        researchAreas: ['Glaucoma and retinal disorders', 'Sodium Channels'],
        fullDescription: 'Some independently-corrected description.',
        shortDescription: 'Wrong-domain short description.',
      },
      directive,
    );
    expect(plan.fullDescriptionReplaced).toBe(false);
    expect(plan.fullDescriptionAfter).toBe('Some independently-corrected description.');
    expect(plan.shortDescriptionReplaced).toBe(true);
    expect(plan.changed).toBe(true);
  });

  it('reports missing remove-areas as drift when the entity no longer carries them', () => {
    const plan = planAreaChipDescriptionGraftCleanup(
      {
        researchAreas: ['Sodium Channels'],
        fullDescription: 'Wrong-domain full description.',
        shortDescription: 'Wrong-domain short description.',
      },
      directive,
    );
    expect(plan.missingRemoveAreas).toEqual([
      'Glaucoma and retinal disorders',
      'Ocular Surface and Contact Lens',
    ]);
    expect(plan.removedAreas).toEqual([]);
  });

  it('is entirely a no-op (changed: false) when nothing on the directive still matches', () => {
    const plan = planAreaChipDescriptionGraftCleanup(
      {
        researchAreas: ['Sodium Channels'],
        fullDescription: 'Already fixed.',
        shortDescription: 'Already fixed too.',
      },
      directive,
    );
    expect(plan.changed).toBe(false);
  });
});

describe('summarizeAreaChipDescriptionGraftPlans', () => {
  it('aggregates counts and flags drift slugs', () => {
    const directive: AreaChipDescriptionGraftDirective = {
      entityId: 'e1',
      slug: 'drifted-entity',
      removeAreas: ['Missing Area'],
    };
    const plan = planAreaChipDescriptionGraftCleanup(
      { researchAreas: ['Kept Area'], fullDescription: '', shortDescription: '' },
      directive,
    );
    const summary = summarizeAreaChipDescriptionGraftPlans([plan]);
    expect(summary.considered).toBe(1);
    expect(summary.changed).toBe(0);
    expect(summary.driftSlugs).toEqual(['drifted-entity']);
  });
});
