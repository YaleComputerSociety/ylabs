import { describe, expect, it } from 'vitest';

import {
  descriptionOpensWithDeceasedLifespan,
  personNameCarriesLifespan,
  researchEntityHasDeceasedLead,
  stripTrailingPersonNameLifespan,
} from '../researchEntityDeceasedLead';

const YEAR = 2026;

describe('stripTrailingPersonNameLifespan', () => {
  it('removes a birth-death lifespan glued onto a person name (#982)', () => {
    expect(stripTrailingPersonNameLifespan('Pierre Demarque 1932-2025', YEAR)).toBe(
      'Pierre Demarque',
    );
    expect(stripTrailingPersonNameLifespan('Pierre Demarque (1932 - 2025)', YEAR)).toBe(
      'Pierre Demarque',
    );
    expect(stripTrailingPersonNameLifespan('Demarque 1932–2025', YEAR)).toBe('Demarque');
  });

  it('leaves ordinary names untouched', () => {
    expect(stripTrailingPersonNameLifespan('Pierre Demarque', YEAR)).toBe('Pierre Demarque');
    expect(stripTrailingPersonNameLifespan('Jane Doe', YEAR)).toBe('Jane Doe');
  });

  it('does not strip an implausibly short trailing range that is not a human lifespan', () => {
    expect(stripTrailingPersonNameLifespan('Cohort 2015-2020', YEAR)).toBe('Cohort 2015-2020');
  });

  it('does not strip a range whose end year is in the future', () => {
    expect(stripTrailingPersonNameLifespan('Program 1990-2099', YEAR)).toBe('Program 1990-2099');
  });

  it('never collapses a name entirely to empty', () => {
    expect(stripTrailingPersonNameLifespan('1932-2025', YEAR)).toBe('1932-2025');
  });

  it('handles non-string input', () => {
    expect(stripTrailingPersonNameLifespan(undefined, YEAR)).toBe('');
    expect(stripTrailingPersonNameLifespan(null, YEAR)).toBe('');
  });
});

describe('personNameCarriesLifespan', () => {
  it('flags a lifespan-carrying name and clears an ordinary one', () => {
    expect(personNameCarriesLifespan('Pierre Demarque 1932-2025', YEAR)).toBe(true);
    expect(personNameCarriesLifespan('Pierre Demarque', YEAR)).toBe(false);
  });
});

describe('descriptionOpensWithDeceasedLifespan', () => {
  it('detects a description that opens with a name + birth-death parenthetical (#982)', () => {
    expect(
      descriptionOpensWithDeceasedLifespan(
        'Pierre R. Demarque (1932 - 2025), Munson Professor Emeritus of Natural Philosophy and Astronomy, studied stellar evolution.',
        YEAR,
      ),
    ).toBe(true);
    expect(
      descriptionOpensWithDeceasedLifespan('Jane A. Doe, 1901-1980, founded the field.', YEAR),
    ).toBe(true);
  });

  it('does not fire on a mid-sentence career date range', () => {
    expect(
      descriptionOpensWithDeceasedLifespan(
        'David Simon served as assistant dean for undergraduate education 2023-2026 and studies mass atrocities.',
        YEAR,
      ),
    ).toBe(false);
    expect(
      descriptionOpensWithDeceasedLifespan(
        'Professor of Government from 1993-2000, she now leads the lab.',
        YEAR,
      ),
    ).toBe(false);
  });

  it('does not fire when the range is not a plausible human lifespan', () => {
    expect(
      descriptionOpensWithDeceasedLifespan(
        'Founded 2015-2020, the program supports students.',
        YEAR,
      ),
    ).toBe(false);
  });

  it('does not fire on an ordinary lab description', () => {
    expect(
      descriptionOpensWithDeceasedLifespan(
        'The Faboratory studies soft robotics and morphing structures.',
        YEAR,
      ),
    ).toBe(false);
  });
});

describe('researchEntityHasDeceasedLead', () => {
  it('flags the in-memoriam lab whose description opens with a lifespan (#982)', () => {
    expect(
      researchEntityHasDeceasedLead(
        {
          name: 'Demarque Lab',
          fullDescription:
            'Pierre R. Demarque (1932 - 2025), Munson Professor Emeritus of Natural Philosophy and Astronomy.',
        },
        YEAR,
      ),
    ).toBe(true);
  });

  it('flags an entity whose display name itself carries a lifespan', () => {
    expect(researchEntityHasDeceasedLead({ displayName: 'Pierre Demarque 1932-2025' }, YEAR)).toBe(
      true,
    );
  });

  it('does not flag an ordinary active lab', () => {
    expect(
      researchEntityHasDeceasedLead(
        {
          name: 'Kramer-Bottiglio Lab',
          fullDescription: 'The Faboratory develops shape-changing soft robots.',
          shortDescription: 'Soft robotics and morphing matter.',
        },
        YEAR,
      ),
    ).toBe(false);
  });

  it('returns false for nullish input', () => {
    expect(researchEntityHasDeceasedLead(null, YEAR)).toBe(false);
    expect(researchEntityHasDeceasedLead(undefined, YEAR)).toBe(false);
  });
});
