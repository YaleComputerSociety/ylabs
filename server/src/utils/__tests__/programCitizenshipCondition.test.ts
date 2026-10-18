import { describe, expect, it } from 'vitest';
import { programCitizenshipCondition } from '../programCitizenshipCondition';

describe('programCitizenshipCondition (#5235)', () => {
  it('returns the sentence that conditions international students on their home country', () => {
    expect(
      programCitizenshipCondition([
        'The grants support summer research in East Asia. In general, applications from international students proposing research projects in their country of origin are ineligible.Students should already know the language.',
      ]),
    ).toBe(
      'In general, applications from international students proposing research projects in their country of origin are ineligible.',
    );
  });

  it('returns nothing for text with no such condition', () => {
    expect(
      programCitizenshipCondition(['International travel must follow Yale policy.']),
    ).toBeUndefined();
    expect(
      programCitizenshipCondition([undefined, 'Return to your home country safely.']),
    ).toBeUndefined();
  });
});
