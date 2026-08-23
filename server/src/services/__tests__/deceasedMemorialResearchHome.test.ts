import { describe, expect, it } from 'vitest';

import { isDeceasedMemorialResearchHome } from '../deceasedMemorialResearchHome';

describe('isDeceasedMemorialResearchHome', () => {
  it('detects a lifespan glued into a source-page URL slug', () => {
    expect(
      isDeceasedMemorialResearchHome({
        sourceUrls: ['https://astronomy.yale.edu/people/pierre-demarque-1932-2025'],
      }),
    ).toBe(true);
  });

  it('detects a lifespan glued onto a lead professor name', () => {
    expect(
      isDeceasedMemorialResearchHome({
        leadProfessorNames: ['Pierre Demarque 1932-2025'],
      }),
    ).toBe(true);
  });

  it('detects a parenthetical birth-death pair in the description opening', () => {
    expect(
      isDeceasedMemorialResearchHome({
        fullDescription:
          'Pierre R. Demarque (1932 - 2025), Munson Professor Emeritus of Natural Philosophy and Astronomy.',
      }),
    ).toBe(true);
  });

  it('detects an en-dash lifespan and explicit memorial phrasing', () => {
    expect(isDeceasedMemorialResearchHome({ shortDescription: 'Jane Doe (1940–2018).' })).toBe(
      true,
    );
    expect(
      isDeceasedMemorialResearchHome({
        profileSynthesisDescription: 'A fund established in memory of the late Professor Smith.',
      }),
    ).toBe(true);
  });

  it('ignores an ordinary career date range in bio prose', () => {
    expect(
      isDeceasedMemorialResearchHome({
        fullDescription: 'She served as Professor of Government from 1993-2000 before moving on.',
      }),
    ).toBe(false);
  });

  it('ignores a lone founding or start year', () => {
    expect(
      isDeceasedMemorialResearchHome({
        fullDescription: 'The lab was established in 2015 and has grown steadily since.',
        sourceUrls: ['https://example.yale.edu/labs/example-lab'],
      }),
    ).toBe(false);
  });

  it('ignores an implausible or reversed year pair', () => {
    expect(
      isDeceasedMemorialResearchHome({ fullDescription: 'Records span (2025 - 1932).' }),
    ).toBe(false);
    expect(
      isDeceasedMemorialResearchHome({ leadProfessorNames: ['Team 2010-2099'] }),
    ).toBe(true);
    expect(isDeceasedMemorialResearchHome({ fullDescription: 'Cohort (1700 - 1750).' })).toBe(
      false,
    );
  });

  it('returns false for a healthy active research home', () => {
    expect(
      isDeceasedMemorialResearchHome({
        leadProfessorNames: ['Benjamin Polak'],
        sourceUrls: ['https://economics.yale.edu/people/benjamin-polak'],
        fullDescription: 'The lab studies decision theory, game theory, and economic history.',
      }),
    ).toBe(false);
  });

  it('returns false for empty or non-object input', () => {
    expect(isDeceasedMemorialResearchHome({})).toBe(false);
    expect(isDeceasedMemorialResearchHome(null as unknown as Record<string, any>)).toBe(false);
  });
});
