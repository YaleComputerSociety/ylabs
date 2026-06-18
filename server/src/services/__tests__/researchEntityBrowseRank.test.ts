import { describe, expect, it } from 'vitest';
import {
  computeResearchEntityBrowseRank,
  __testing,
} from '../researchEntityBrowseRank';

// A "complete" entity: source-backed full description + official URL.
const completeEntity = () => ({
  fullDescription:
    'The Smith Lab studies the molecular basis of neurodegeneration using a combination of ' +
    'imaging, genetics, and computational modeling across several long-running projects.',
  shortDescription: 'Neurodegeneration imaging and genetics lab.',
  websiteUrl: 'https://example.yale.edu/smith-lab',
  sourceUrls: ['https://example.yale.edu/smith-lab'],
});

const attachedLead = () => [{ userId: 'u1', name: 'Dr. Smith' }];

describe('computeResearchEntityBrowseRank', () => {
  it('ranks a complete entity with strong access above a bare one', () => {
    const strong = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: attachedLead(),
      accessSignalTypes: ['CURRENT_UNDERGRADS'],
    });
    const bare = computeResearchEntityBrowseRank({
      entity: { fullDescription: '' },
      leadMembers: [],
      accessSignalTypes: [],
    });
    expect(strong).toBeGreaterThan(bare);
  });

  it('weights strong access signals above the weak REACH_OUT_PLAUSIBLE fallback', () => {
    const base = { entity: completeEntity(), leadMembers: attachedLead() };
    const strong = computeResearchEntityBrowseRank({
      ...base,
      accessSignalTypes: ['CURRENT_UNDERGRADS'],
    });
    const weak = computeResearchEntityBrowseRank({
      ...base,
      accessSignalTypes: ['REACH_OUT_PLAUSIBLE'],
    });
    expect(strong).toBeGreaterThan(weak);
    expect(strong - weak).toBe(
      __testing.ACCESS_SIGNAL_POINTS.CURRENT_UNDERGRADS -
        __testing.ACCESS_SIGNAL_POINTS.REACH_OUT_PLAUSIBLE,
    );
  });

  it('takes the single strongest signal rather than stacking', () => {
    const both = __testing.accessPoints(['REACH_OUT_PLAUSIBLE', 'CURRENT_UNDERGRADS']);
    expect(both).toBe(__testing.ACCESS_SIGNAL_POINTS.CURRENT_UNDERGRADS);
  });

  it('lets a NOT_CURRENTLY_AVAILABLE signal pull the access term negative', () => {
    expect(__testing.accessPoints(['NOT_CURRENTLY_AVAILABLE'])).toBeLessThan(0);
  });

  it('does not let a positive signal mask a co-present unavailable signal incorrectly', () => {
    // Strongest positive wins when present.
    expect(
      __testing.accessPoints(['NOT_CURRENTLY_AVAILABLE', 'CURRENT_UNDERGRADS']),
    ).toBe(__testing.ACCESS_SIGNAL_POINTS.CURRENT_UNDERGRADS);
  });

  it('penalizes a missing source URL relative to one present', () => {
    const withUrl = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: attachedLead(),
      accessSignalTypes: [],
    });
    const withoutUrl = computeResearchEntityBrowseRank({
      entity: { ...completeEntity(), websiteUrl: undefined, sourceUrls: [] },
      leadMembers: attachedLead(),
      accessSignalTypes: [],
    });
    expect(withUrl).toBeGreaterThan(withoutUrl);
  });

  it('rewards an attached lead over a missing one', () => {
    const withLead = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: attachedLead(),
      accessSignalTypes: [],
    });
    const withoutLead = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: [],
      accessSignalTypes: [],
    });
    expect(withLead).toBeGreaterThan(withoutLead);
  });
});
