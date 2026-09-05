import { describe, expect, it } from 'vitest';
import {
  PERMANENTLY_CLOSED_SUPPRESSION_REASON,
  deriveResearchEntityYaleStatus,
  hasEvidencelessInactiveYaleStatus,
  hasRecordedClosureEvidence,
} from '../researchEntityYaleStatus';

describe('deriveResearchEntityYaleStatus', () => {
  it('does not flag a professor-emeritus source URL path as departed', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Claude Rawson',
      sourceUrls: ['https://english.yale.edu/people/professors-emeritus/claude-rawson'],
    });

    expect(signal).toBeNull();
  });

  it('does not flag an emeritus title mentioned at the start of the description as departed', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Jane Doe Lab',
      sourceUrls: ['https://chem.yale.edu/people/jane-doe'],
      fullDescription: 'Jane Doe, Professor Emerita of Chemistry, studies reaction kinetics.',
    });

    expect(signal).toBeNull();
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

  it('does not flag a bare emeritus title attributed to Yale as departed', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Alex Poe - Research',
      sourceUrls: ['https://philosophy.yale.edu/faculty'],
      fullDescription: 'Alex Poe is Professor Emeritus at Yale, studying logic.',
    });

    expect(signal).toBeNull();
  });

  it('still flags a deceased lead even when an emeritus title is present', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Pierre Demarque',
      fullDescription:
        'Pierre R. Demarque (1932 - 2025), Professor Emeritus of Astronomy, studied stellar evolution.',
    });

    expect(signal?.reason).toBe('deceased');
  });

  it('returns null for a null or undefined entity', () => {
    expect(deriveResearchEntityYaleStatus(null)).toBeNull();
    expect(deriveResearchEntityYaleStatus(undefined)).toBeNull();
  });
});

describe('recorded closure as a durable departure (#1923)', () => {
  const closureReason =
    'permanently_closed: research home no longer active; PI departed/relocated (reported 2026-08-31, recorded per #2284)';

  it('derives a departed signal from a recorded closure marker', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Avram Holmes - Research',
      sourceUrls: ['https://orcid.org/0000-0001-6583-803X'],
      studentVisibilitySuppressionReason: closureReason,
    });

    expect(signal).toEqual({
      yaleStatusCache: 'departed',
      activeAtYaleCache: false,
      reason: 'departed',
    });
  });

  it('re-derives on every pass, so the departure survives re-materialization', () => {
    const entity = {
      name: 'Debra Fischer Faculty Research',
      sourceUrls: ['https://astronomy.yale.edu/people/faculty'],
      fullDescription: 'Studies exoplanet detection and radial-velocity instrumentation.',
      studentVisibilitySuppressionReason: closureReason,
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
      yaleStatusReasonCache: 'departed',
    };

    // The reset branch is only reached when the derivation yields nothing, so a
    // re-derivable signal is what makes the marker durable.
    expect(deriveResearchEntityYaleStatus(entity)).not.toBeNull();
  });

  it('keeps deceased ahead of departed when both markers are present', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Pierre Demarque (1932 - 2025)',
      studentVisibilitySuppressionReason: closureReason,
    });

    expect(signal?.reason).toBe('deceased');
  });

  it('fails open: no marker means no departure signal', () => {
    expect(
      deriveResearchEntityYaleStatus({
        name: 'Jane Roe Lab',
        sourceUrls: ['https://mcdb.yale.edu/people/jane-roe'],
        studentVisibilitySuppressionReason: '',
      }),
    ).toBeNull();
    expect(
      deriveResearchEntityYaleStatus({
        name: 'Jane Roe Lab',
        sourceUrls: ['https://mcdb.yale.edu/people/jane-roe'],
      }),
    ).toBeNull();
  });

  it('does not treat an unrelated suppression reason as a closure', () => {
    expect(
      deriveResearchEntityYaleStatus({
        name: 'Yale Core Facility',
        studentVisibilitySuppressionReason: 'research_infrastructure_only',
      }),
    ).toBeNull();
  });

  it('recognises the marker alongside another recorded reason', () => {
    const signal = deriveResearchEntityYaleStatus({
      name: 'Rudnick Lab',
      studentVisibilitySuppressionReason: `research_infrastructure_only, ${closureReason}`,
    });

    expect(signal?.reason).toBe('departed');
  });

  it('leaves a closure-marked row alone instead of resetting it', () => {
    const entity = {
      name: 'Avram Holmes - Research',
      studentVisibilitySuppressionReason: closureReason,
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
      yaleStatusReasonCache: 'departed',
    };

    expect(deriveResearchEntityYaleStatus(entity)).not.toBeNull();
    expect(hasEvidencelessInactiveYaleStatus(entity)).toBe(false);
  });

  it('still resets an inactive cache that has no evidence of any kind behind it', () => {
    expect(
      hasEvidencelessInactiveYaleStatus({
        name: 'Jane Roe Lab',
        activeAtYaleCache: false,
        yaleStatusReasonCache: '',
        studentVisibilitySuppressionReason: '',
      }),
    ).toBe(true);
  });
});

describe('hasRecordedClosureEvidence', () => {
  it('matches the marker constant and tolerates a missing field', () => {
    expect(
      hasRecordedClosureEvidence({
        studentVisibilitySuppressionReason: PERMANENTLY_CLOSED_SUPPRESSION_REASON,
      }),
    ).toBe(true);
    expect(hasRecordedClosureEvidence({})).toBe(false);
    expect(hasRecordedClosureEvidence(null)).toBe(false);
    expect(hasRecordedClosureEvidence(undefined)).toBe(false);
  });

  it('is the same symbol the tier service uses, so the two cannot drift', async () => {
    const tierService = await import('../../services/studentVisibilityTier');
    expect(tierService.hasRecordedClosureEvidence).toBe(hasRecordedClosureEvidence);
    expect(tierService.PERMANENTLY_CLOSED_SUPPRESSION_REASON).toBe(
      PERMANENTLY_CLOSED_SUPPRESSION_REASON,
    );
  });
});
