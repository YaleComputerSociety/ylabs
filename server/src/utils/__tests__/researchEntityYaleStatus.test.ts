import { describe, expect, it } from 'vitest';
import { deriveResearchEntityYaleStatus } from '../researchEntityYaleStatus';

describe('deriveResearchEntityYaleStatus', () => {
  it('flags a professor-emeritus source URL path', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Claude Rawson',
      sourceUrls: ['https://english.yale.edu/people/professors-emeritus/claude-rawson'],
    });

    expect(signal).toEqual({
      yaleStatusCache: 'departed',
      activeAtYaleCache: false,
      reason: 'emeritus',
    });
  });

  it('flags an emeritus title mentioned at the start of the description', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Jane Doe Lab',
      sourceUrls: ['https://chem.yale.edu/people/jane-doe'],
      fullDescription: 'Jane Doe, Professor Emerita of Chemistry, studies reaction kinetics.',
    });

    expect(signal?.reason).toBe('emeritus');
  });

  it('flags an in-memoriam source URL path', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Pierre Demarque',
      sourceUrls: ['https://astronomy.yale.edu/in-memoriam/pierre-demarque'],
    });

    expect(signal?.reason).toBe('deceased');
  });

  it('flags an obituary source URL path', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Jane Doe',
      sourceUrls: ['https://law.yale.edu/obituaries/jane-doe'],
    });

    expect(signal?.reason).toBe('deceased');
  });

  it('flags a lifespan embedded mid-name behind a research-home suffix', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Pierre Demarque 1932-2025 Faculty Research',
      sourceUrls: ['https://astronomy.yale.edu/people/faculty'],
      fullDescription: 'Studies exoplanets, stellar populations, and asteroseismology.',
    });

    expect(signal?.reason).toBe('deceased');
  });

  it('flags a lifespan glued into the display name', () => {
    const signal = deriveResearchEntityYaleStatus({
      displayName: 'Pierre Demarque 1932-2025',
      sourceUrls: ['https://astronomy.yale.edu/people/pierre-demarque-1932-2025'],
    });

    expect(signal?.reason).toBe('deceased');
  });

  it('flags a description opening with a deceased lifespan parenthetical', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Pierre Demarque',
      fullDescription:
        'Pierre R. Demarque (1932 - 2025), Munson Professor Emeritus of Natural Philosophy and Astronomy, studied stellar evolution.',
    });

    expect(signal?.reason).toBe('deceased');
  });

  it('flags "passed away" and "in memoriam" text markers at the description opening', () => {
    expect(
      deriveResearchEntityYaleStatus({
        name: 'Jane Doe',
        fullDescription: 'Jane Doe passed away in 2024 after a long career at Yale.',
      })?.reason,
    ).toBe('deceased');

    expect(
      deriveResearchEntityYaleStatus({
        name: 'Jane Doe',
        fullDescription: 'In memoriam: Jane Doe was a beloved member of the department.',
      })?.reason,
    ).toBe('deceased');
  });

  it('returns null for an ordinary active faculty entity', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Jane Doe Lab',
      sourceUrls: ['https://chem.yale.edu/people/jane-doe'],
      fullDescription:
        'The Doe Lab studies reaction kinetics and catalysis, with active undergraduate research opportunities.',
    });

    expect(signal).toBeNull();
  });

  it('does not flag an ordinary career date range as a lifespan', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Jane Doe Lab',
      fullDescription: 'Jane Doe served as chair of the department from 1993-2000.',
    });

    expect(signal).toBeNull();
  });

  it('does not flag active Yale faculty holding bare-named emeritus status elsewhere', () => {
    const yalePhilosopherAtHarvard = deriveResearchEntityYaleStatus({
      name: 'Jane Doe - Research',
      sourceUrls: ['https://philosophy.yale.edu/faculty'],
      fullDescription:
        'Jane Doe is a Professor of Philosophy at Yale University and Professor Emeritus at Harvard. Her research examines moral reasoning.',
    });
    expect(yalePhilosopherAtHarvard).toBeNull();

    const emeritusFirstAtMit = deriveResearchEntityYaleStatus({
      name: 'John Roe - Research',
      sourceUrls: ['https://engineering.yale.edu/faculty'],
      fullDescription:
        'John Roe is a Professor at Yale University and Emeritus Professor at MIT, studying control systems.',
    });
    expect(emeritusFirstAtMit).toBeNull();
  });

  it('still flags emeritus attributed to Yale itself', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Alex Poe - Research',
      sourceUrls: ['https://philosophy.yale.edu/faculty'],
      fullDescription: 'Alex Poe is Professor Emeritus at Yale, studying logic.',
    });

    expect(signal?.reason).toBe('emeritus');
  });

  it('returns null for a null or undefined entity', () => {
    expect(deriveResearchEntityYaleStatus(null)).toBeNull();
    expect(deriveResearchEntityYaleStatus(undefined)).toBeNull();
  });
});
