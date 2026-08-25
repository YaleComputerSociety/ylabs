import { describe, expect, it } from 'vitest';
import { computeResearchEntityBrowseRank, __testing } from '../researchEntityBrowseRank';

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
    expect(__testing.accessPoints(['NOT_CURRENTLY_AVAILABLE', 'CURRENT_UNDERGRADS'])).toBe(
      __testing.ACCESS_SIGNAL_POINTS.CURRENT_UNDERGRADS,
    );
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

  it('ranks a lab above an otherwise-identical umbrella center', () => {
    const base = { leadMembers: attachedLead(), accessSignalTypes: [] as string[] };
    const lab = computeResearchEntityBrowseRank({
      ...base,
      entity: { ...completeEntity(), entityType: 'LAB' },
    });
    const center = computeResearchEntityBrowseRank({
      ...base,
      entity: { ...completeEntity(), entityType: 'CENTER' },
      hostsAffiliatedResearchHomes: true,
    });
    expect(lab).toBeGreaterThan(center);
    expect(lab - center).toBe(-__testing.ENTITY_TYPE_RANK_ADJUSTMENT.CENTER!);
  });

  it('does not demote a leaf center that hosts no affiliated research homes', () => {
    const base = { leadMembers: attachedLead(), accessSignalTypes: [] as string[] };
    const lab = computeResearchEntityBrowseRank({
      ...base,
      entity: { ...completeEntity(), entityType: 'LAB' },
    });
    const leafCenter = computeResearchEntityBrowseRank({
      ...base,
      entity: { ...completeEntity(), entityType: 'CENTER' },
      hostsAffiliatedResearchHomes: false,
    });
    expect(leafCenter).toBe(lab);
  });

  it('demotes centers more than programs', () => {
    expect(__testing.ENTITY_TYPE_RANK_ADJUSTMENT.CENTER!).toBeLessThan(
      __testing.ENTITY_TYPE_RANK_ADJUSTMENT.PROGRAM!,
    );
  });

  it('does not demote direct research homes', () => {
    expect(__testing.entityTypeRankAdjustment({ entityType: 'LAB' }, true)).toBe(0);
    expect(__testing.entityTypeRankAdjustment({ entityType: 'FACULTY_PROJECT' }, true)).toBe(0);
    expect(__testing.entityTypeRankAdjustment({ entityType: 'GROUP' }, true)).toBe(0);
  });

  it('gates the umbrella demotion on hosting affiliated research homes', () => {
    expect(__testing.entityTypeRankAdjustment({ entityType: 'CENTER' }, true)).toBe(
      __testing.ENTITY_TYPE_RANK_ADJUSTMENT.CENTER,
    );
    expect(__testing.entityTypeRankAdjustment({ entityType: 'CENTER' }, false)).toBe(0);
    expect(__testing.entityTypeRankAdjustment({ entityType: 'INSTITUTE' }, false)).toBe(0);
    expect(__testing.entityTypeRankAdjustment({ entityType: 'INITIATIVE' }, false)).toBe(0);
  });

  it('applies the PROGRAM demotion unconditionally', () => {
    expect(__testing.entityTypeRankAdjustment({ entityType: 'PROGRAM' }, false)).toBe(
      __testing.ENTITY_TYPE_RANK_ADJUSTMENT.PROGRAM,
    );
    expect(__testing.entityTypeRankAdjustment({ entityType: 'PROGRAM' }, true)).toBe(
      __testing.ENTITY_TYPE_RANK_ADJUSTMENT.PROGRAM,
    );
  });

  it('derives the type adjustment from kind when entityType is absent', () => {
    expect(__testing.entityTypeRankAdjustment({ kind: 'center' }, true)).toBe(
      __testing.ENTITY_TYPE_RANK_ADJUSTMENT.CENTER,
    );
    expect(__testing.entityTypeRankAdjustment({ kind: 'center' }, false)).toBe(0);
    expect(__testing.entityTypeRankAdjustment({ kind: 'lab' }, true)).toBe(0);
  });

  describe('shape-fair access baseline for structurally unobservable shapes', () => {
    it('lifts a signal-less faculty-directory home off the REACH_OUT floor', () => {
      const facultyArea = computeResearchEntityBrowseRank({
        entity: { ...completeEntity(), entityType: 'FACULTY_RESEARCH_AREA' },
        leadMembers: attachedLead(),
        accessSignalTypes: [],
      });
      const weakLab = computeResearchEntityBrowseRank({
        entity: { ...completeEntity(), entityType: 'LAB' },
        leadMembers: attachedLead(),
        accessSignalTypes: ['REACH_OUT_PLAUSIBLE'],
      });
      expect(facultyArea).toBeGreaterThan(weakLab);
    });

    it('applies the neutral baseline to both unobservable shapes', () => {
      for (const entityType of __testing.ACCESS_UNOBSERVABLE_ENTITY_TYPES) {
        expect(__testing.accessContribution([], entityType)).toBe(
          __testing.NEUTRAL_ACCESS_BASELINE,
        );
        expect(__testing.accessContribution(['REACH_OUT_PLAUSIBLE'], entityType)).toBe(
          __testing.NEUTRAL_ACCESS_BASELINE,
        );
      }
    });

    it('still lets a genuinely strong observed signal outrank the baseline', () => {
      expect(__testing.accessContribution(['CURRENT_UNDERGRADS'], 'INDIVIDUAL_RESEARCH')).toBe(
        __testing.ACCESS_SIGNAL_POINTS.CURRENT_UNDERGRADS,
      );
      const strongLab = computeResearchEntityBrowseRank({
        entity: { ...completeEntity(), entityType: 'LAB' },
        leadMembers: attachedLead(),
        accessSignalTypes: ['CURRENT_UNDERGRADS'],
      });
      const neutralFaculty = computeResearchEntityBrowseRank({
        entity: { ...completeEntity(), entityType: 'FACULTY_RESEARCH_AREA' },
        leadMembers: attachedLead(),
        accessSignalTypes: [],
      });
      expect(strongLab).toBeGreaterThan(neutralFaculty);
    });

    it('honors an explicit not-available signal on an unobservable shape', () => {
      expect(
        __testing.accessContribution(['NOT_CURRENTLY_AVAILABLE'], 'FACULTY_RESEARCH_AREA'),
      ).toBe(__testing.ACCESS_SIGNAL_POINTS.NOT_CURRENTLY_AVAILABLE);
    });

    it('does not lift observable lab shapes off their raw access points', () => {
      expect(__testing.accessContribution([], 'LAB')).toBe(0);
      expect(__testing.accessContribution(['REACH_OUT_PLAUSIBLE'], 'LAB')).toBe(
        __testing.ACCESS_SIGNAL_POINTS.REACH_OUT_PLAUSIBLE,
      );
    });

    it('lets completeness order two signal-less faculty homes', () => {
      const complete = computeResearchEntityBrowseRank({
        entity: { ...completeEntity(), entityType: 'FACULTY_RESEARCH_AREA' },
        leadMembers: attachedLead(),
        accessSignalTypes: [],
      });
      const thin = computeResearchEntityBrowseRank({
        entity: { fullDescription: '', entityType: 'FACULTY_RESEARCH_AREA' },
        leadMembers: [],
        accessSignalTypes: [],
      });
      expect(complete).toBeGreaterThan(thin);
    });
  });

  it('keeps a strong umbrella center above a bare lab despite the demotion', () => {
    const strongCenter = computeResearchEntityBrowseRank({
      entity: { ...completeEntity(), entityType: 'CENTER' },
      leadMembers: attachedLead(),
      accessSignalTypes: ['CURRENT_UNDERGRADS'],
      hostsAffiliatedResearchHomes: true,
    });
    const bareLab = computeResearchEntityBrowseRank({
      entity: { fullDescription: '', entityType: 'LAB' },
      leadMembers: [],
      accessSignalTypes: [],
    });
    expect(strongCenter).toBeGreaterThan(bareLab);
  });
});
