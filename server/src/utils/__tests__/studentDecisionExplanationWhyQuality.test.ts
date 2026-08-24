import { describe, expect, it } from 'vitest';
import {
  classifyWhyBullet,
  filterFabricatedWhyBullets,
  isSecondPersonWhyBullet,
  isUnanchoredInterestTopicWhyBullet,
  isVacuousAlignmentWhyBullet,
} from '../studentDecisionExplanationWhyQuality';

describe('isSecondPersonWhyBullet', () => {
  it('flags bullets that address the student in second person', () => {
    expect(isSecondPersonWhyBullet('Research aligns with your interests in theoretical topics.')).toBe(
      true,
    );
    expect(isSecondPersonWhyBullet('You can upload a resume and cover letter.')).toBe(true);
  });

  it('does not flag bullets with no second-person pronoun', () => {
    expect(isSecondPersonWhyBullet('Lab studies dopamine signaling in movement disorders.')).toBe(
      false,
    );
  });
});

describe('isVacuousAlignmentWhyBullet', () => {
  it('flags the generic "aligns with interests" template regardless of pronoun', () => {
    expect(isVacuousAlignmentWhyBullet('Research aligns with your interests.')).toBe(true);
    expect(isVacuousAlignmentWhyBullet('Research areas align with your interests.')).toBe(true);
    expect(isVacuousAlignmentWhyBullet('Research focus aligns with critical health issues.')).toBe(
      true,
    );
  });

  it('does not flag a concrete, non-template bullet', () => {
    expect(
      isVacuousAlignmentWhyBullet('Lab has three posted openings for wet-lab research assistants.'),
    ).toBe(false);
  });
});

describe('isUnanchoredInterestTopicWhyBullet', () => {
  it('flags an interest topic absent from the entity researchAreas and description (Nairn/Alzheimer example)', () => {
    const bullet = "Research focus aligns with interests in Alzheimer's disease.";
    const context = {
      researchAreas: ['Dopamine', 'Huntington Disease', 'Parkinson Disease', 'Schizophrenia'],
      fullDescription:
        'The lab studies dopamine signaling pathways implicated in Parkinson and Huntington disease models.',
    };
    expect(isUnanchoredInterestTopicWhyBullet(bullet, context)).toBe(true);
  });

  it('does not flag an interest topic present in researchAreas', () => {
    const bullet = 'Research aligns with your interests in theoretical physics.';
    const context = {
      researchAreas: ['Particle Physics', 'Condensed Matter Physics', 'Quantum Physics'],
      fullDescription: 'The group works on theoretical models in quantum field theory.',
    };
    expect(isUnanchoredInterestTopicWhyBullet(bullet, context)).toBe(false);
  });

  it('is inapplicable when the bullet names no interest topic', () => {
    expect(isUnanchoredInterestTopicWhyBullet('Research area aligns with your interests.', {})).toBe(
      false,
    );
  });
});

describe('classifyWhyBullet', () => {
  it('accumulates every matching issue for a bullet', () => {
    const issues = classifyWhyBullet('Research area aligns with your interests.', {
      researchAreas: ['Cell Biology', 'Gene Expression'],
      fullDescription: '',
    });
    expect(issues).toContain('second_person');
    expect(issues).toContain('vacuous_alignment');
  });

  it('returns no issues for a concrete, entity-grounded bullet', () => {
    const issues = classifyWhyBullet('Lab is actively recruiting undergraduates for wet-lab work.', {
      researchAreas: ['Cell Biology'],
      fullDescription: '',
    });
    expect(issues).toEqual([]);
  });
});

describe('filterFabricatedWhyBullets', () => {
  it('strips fabricated bullets while keeping concrete ones', () => {
    const why = [
      'No posted opportunities currently available.',
      'Exploratory outreach is plausible based on the profile.',
      "Research focus aligns with interests in Alzheimer's disease.",
    ];
    const context = {
      researchAreas: ['Dopamine', 'Huntington Disease', 'Parkinson Disease'],
      fullDescription: 'The lab studies dopamine signaling in movement disorders.',
    };
    const result = filterFabricatedWhyBullets(why, context);
    expect(result.keep).toEqual([
      'No posted opportunities currently available.',
      'Exploratory outreach is plausible based on the profile.',
    ]);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].issues).toContain('unanchored_interest_topic');
  });

  it('keeps every bullet when none are fabricated', () => {
    const why = ['Lab is actively recruiting undergraduates for wet-lab work.'];
    const result = filterFabricatedWhyBullets(why, {});
    expect(result.keep).toEqual(why);
    expect(result.removed).toEqual([]);
  });
});
