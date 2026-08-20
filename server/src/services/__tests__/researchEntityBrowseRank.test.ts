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

  it('ranks a lab above an otherwise-identical center', () => {
    const base = { leadMembers: attachedLead(), accessSignalTypes: [] as string[] };
    const lab = computeResearchEntityBrowseRank({
      ...base,
      entity: { ...completeEntity(), entityType: 'LAB' },
    });
    const center = computeResearchEntityBrowseRank({
      ...base,
      entity: { ...completeEntity(), entityType: 'CENTER' },
    });
    expect(lab).toBeGreaterThan(center);
    expect(lab - center).toBe(-__testing.ENTITY_TYPE_RANK_ADJUSTMENT.CENTER!);
  });

  it('demotes centers more than programs', () => {
    expect(__testing.ENTITY_TYPE_RANK_ADJUSTMENT.CENTER!).toBeLessThan(
      __testing.ENTITY_TYPE_RANK_ADJUSTMENT.PROGRAM!,
    );
  });

  it('does not demote direct research homes', () => {
    expect(__testing.entityTypeRankAdjustment({ entityType: 'LAB' })).toBe(0);
    expect(__testing.entityTypeRankAdjustment({ entityType: 'FACULTY_PROJECT' })).toBe(0);
    expect(__testing.entityTypeRankAdjustment({ entityType: 'FELLOWSHIP_PROGRAM' })).toBe(0);
  });

  it('derives the type adjustment from kind when entityType is absent', () => {
    expect(__testing.entityTypeRankAdjustment({ kind: 'center' })).toBe(
      __testing.ENTITY_TYPE_RANK_ADJUSTMENT.CENTER,
    );
    expect(__testing.entityTypeRankAdjustment({ kind: 'lab' })).toBe(0);
  });

  it('keeps a strong center above a bare lab despite the demotion', () => {
    const strongCenter = computeResearchEntityBrowseRank({
      entity: { ...completeEntity(), entityType: 'CENTER' },
      leadMembers: attachedLead(),
      accessSignalTypes: ['CURRENT_UNDERGRADS'],
    });
    const bareLab = computeResearchEntityBrowseRank({
      entity: { fullDescription: '', entityType: 'LAB' },
      leadMembers: [],
      accessSignalTypes: [],
    });
    expect(strongCenter).toBeGreaterThan(bareLab);
  });
});
