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
  it('ranks a complete entity above a bare one', () => {
    const complete = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: attachedLead(),
    });
    const bare = computeResearchEntityBrowseRank({
      entity: { fullDescription: '' },
      leadMembers: [],
    });
    expect(complete).toBeGreaterThan(bare);
  });

  it('does not let access signals influence the score', () => {
    const withoutSignals = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: attachedLead(),
    });
    const withSignals = computeResearchEntityBrowseRank({
      entity: { ...completeEntity(), hasUndergradHostingEvidence: true },
      leadMembers: attachedLead(),
    });
    expect(withSignals).toBe(withoutSignals);
  });

  it('penalizes a missing source URL relative to one present', () => {
    const withUrl = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: attachedLead(),
    });
    const withoutUrl = computeResearchEntityBrowseRank({
      entity: { ...completeEntity(), websiteUrl: undefined, sourceUrls: [] },
      leadMembers: attachedLead(),
    });
    expect(withUrl).toBeGreaterThan(withoutUrl);
  });

  it('rewards an attached lead over a missing one', () => {
    const withLead = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: attachedLead(),
    });
    const withoutLead = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: [],
    });
    expect(withLead).toBeGreaterThan(withoutLead);
  });

  it('ranks a lab above an otherwise-identical umbrella center', () => {
    const base = { leadMembers: attachedLead() };
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
    const base = { leadMembers: attachedLead() };
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

  it('lets completeness order two faculty-directory homes', () => {
    const complete = computeResearchEntityBrowseRank({
      entity: { ...completeEntity(), entityType: 'FACULTY_RESEARCH_AREA' },
      leadMembers: attachedLead(),
    });
    const thin = computeResearchEntityBrowseRank({
      entity: { fullDescription: '', entityType: 'FACULTY_RESEARCH_AREA' },
      leadMembers: [],
    });
    expect(complete).toBeGreaterThan(thin);
  });

  it('keeps a complete umbrella center above a bare lab despite the demotion', () => {
    const completeCenter = computeResearchEntityBrowseRank({
      entity: { ...completeEntity(), entityType: 'CENTER' },
      leadMembers: attachedLead(),
      hostsAffiliatedResearchHomes: true,
    });
    const bareLab = computeResearchEntityBrowseRank({
      entity: { fullDescription: '', entityType: 'LAB' },
      leadMembers: [],
    });
    expect(completeCenter).toBeGreaterThan(bareLab);
  });
});
