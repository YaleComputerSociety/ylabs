import { describe, expect, it } from 'vitest';
import { entityHasHostedUndergraduates } from '../hostedUndergraduates';
import { entityWelcomesUndergraduates } from '../researchEntityDto';

const hostedList = {
  source: 'wu-tsai-undergraduate-fellows',
  kind: 'advised',
  count: 2,
  latestYear: 2025,
  sourceUrl: 'https://institute.example.edu/undergraduate-fellows',
};
const welcomesList = {
  source: 'psychology-research-opportunities',
  kind: 'open',
  sourceUrl: 'https://psychology.example.edu/research-opportunities',
};
const mentorsList = {
  source: 'cs-senior-projects',
  kind: 'advised',
  count: 3,
  latestYear: 2026,
  sourceUrl: 'https://cs.example.edu/senior-projects',
};
const reviewed = new Set([
  'wu-tsai-undergraduate-fellows',
  'psychology-research-opportunities',
  'cs-senior-projects',
]);

describe('hosted and welcomes read the official undergraduate lists their signal owns (#5362)', () => {
  it('counts a reviewed hosted list entry as hosting evidence', () => {
    expect(entityHasHostedUndergraduates({ undergradListEvidence: [hostedList] }, reviewed)).toBe(
      true,
    );
  });

  it('ignores a hosted list the owner has not reviewed', () => {
    expect(entityHasHostedUndergraduates({ undergradListEvidence: [hostedList] }, new Set())).toBe(
      false,
    );
  });

  it('never counts a mentors or welcomes list as hosting', () => {
    expect(
      entityHasHostedUndergraduates(
        { undergradListEvidence: [mentorsList, welcomesList] },
        reviewed,
      ),
    ).toBe(false);
  });

  it('counts a reviewed welcomes list entry as welcoming undergraduates', () => {
    expect(entityWelcomesUndergraduates({ undergradListEvidence: [welcomesList] }, reviewed)).toBe(
      true,
    );
  });

  it('never counts a hosted or mentors list as welcoming', () => {
    expect(
      entityWelcomesUndergraduates({ undergradListEvidence: [hostedList, mentorsList] }, reviewed),
    ).toBe(false);
  });

  it('withholds a welcomes list entry when the row withholds its way in', () => {
    expect(
      entityWelcomesUndergraduates(
        { undergradListEvidence: [welcomesList], wayInWithheld: true },
        reviewed,
      ),
    ).toBe(false);
  });
});
