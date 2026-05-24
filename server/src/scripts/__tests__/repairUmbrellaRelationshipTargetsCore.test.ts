import { describe, expect, it } from 'vitest';
import {
  buildUmbrellaRelationshipTargetRepairPlan,
  type UmbrellaRelationshipTargetRepairCandidate,
} from '../repairUmbrellaRelationshipTargetsCore';

describe('buildUmbrellaRelationshipTargetRepairPlan', () => {
  it('relinks generated faculty research-area targets to canonical PI-led labs', () => {
    const candidates: UmbrellaRelationshipTargetRepairCandidate[] = [
      {
        relationshipId: 'rel-avery-shell',
        sourceResearchEntityId: 'example-institute',
        targetResearchEntityId: 'faculty-avery',
        relationshipType: 'MEMBER_RESEARCH_AREA',
        targetSlug: 'faculty-research-area-avery-quinn',
        targetName: 'Avery Quinn Research',
        canonicalTargetId: 'dept-avery',
        canonicalTargetSlug: 'dept-cs-avery-quinn',
      },
    ];

    expect(buildUmbrellaRelationshipTargetRepairPlan(candidates)).toEqual({
      relink: [
        {
          relationshipId: 'rel-avery-shell',
          canonicalTargetId: 'dept-avery',
          canonicalTargetSlug: 'dept-cs-avery-quinn',
        },
      ],
      archiveDuplicates: [],
      attachProfileBackedIndividuals: [],
      skipped: [],
    });
  });

  it('archives generated-target relationships when the canonical relationship already exists', () => {
    const candidates: UmbrellaRelationshipTargetRepairCandidate[] = [
      {
        relationshipId: 'rel-avery-shell',
        sourceResearchEntityId: 'example-institute',
        targetResearchEntityId: 'faculty-avery',
        relationshipType: 'MEMBER_RESEARCH_AREA',
        targetSlug: 'faculty-research-area-avery-quinn',
        targetName: 'Avery Quinn Research',
        canonicalTargetId: 'dept-avery',
        canonicalTargetSlug: 'dept-cs-avery-quinn',
      },
      {
        relationshipId: 'rel-avery-canonical',
        sourceResearchEntityId: 'example-institute',
        targetResearchEntityId: 'dept-avery',
        relationshipType: 'MEMBER_RESEARCH_AREA',
        targetSlug: 'dept-cs-avery-quinn',
        targetName: 'Avery Quinn Lab',
      },
    ];

    expect(buildUmbrellaRelationshipTargetRepairPlan(candidates)).toEqual({
      relink: [],
      archiveDuplicates: [
        {
          relationshipId: 'rel-avery-shell',
          canonicalRelationshipId: 'rel-avery-canonical',
          canonicalTargetSlug: 'dept-cs-avery-quinn',
        },
      ],
      attachProfileBackedIndividuals: [],
      skipped: [],
    });
  });

  it('skips generated targets without a unique canonical target', () => {
    const candidates: UmbrellaRelationshipTargetRepairCandidate[] = [
      {
        relationshipId: 'rel-jordan-powers-shell',
        sourceResearchEntityId: 'example-center',
        targetResearchEntityId: 'faculty-jordan-powers',
        relationshipType: 'MEMBER_RESEARCH_AREA',
        targetSlug: 'faculty-research-area-jordan-powers',
        targetName: 'Jordan Powers Research',
        skippedReason: 'ambiguous-pi-lab',
      },
    ];

    expect(buildUmbrellaRelationshipTargetRepairPlan(candidates)).toEqual({
      relink: [],
      archiveDuplicates: [],
      attachProfileBackedIndividuals: [],
      skipped: [
        {
          relationshipId: 'rel-jordan-powers-shell',
          targetSlug: 'faculty-research-area-jordan-powers',
          reason: 'ambiguous-pi-lab',
        },
      ],
    });
  });

  it('plans profile-backed member attachment when a generated target has an exact user but no lab', () => {
    const candidates: UmbrellaRelationshipTargetRepairCandidate[] = [
      {
        relationshipId: 'rel-morgan-shell',
        sourceResearchEntityId: 'example-institute',
        targetResearchEntityId: 'faculty-morgan',
        relationshipType: 'MEMBER_RESEARCH_AREA',
        targetSlug: 'faculty-research-area-morgan-lee',
        targetName: 'Morgan Lee Research',
        sourceUrl: 'https://example.yale.edu/humans/faculty',
        confidence: 0.8,
        profileUserId: 'user-morgan',
        profileUserNetid: 'ml123',
      },
    ];

    expect(buildUmbrellaRelationshipTargetRepairPlan(candidates)).toEqual({
      relink: [],
      archiveDuplicates: [],
      attachProfileBackedIndividuals: [
        {
          relationshipId: 'rel-morgan-shell',
          targetResearchEntityId: 'faculty-morgan',
          targetSlug: 'faculty-research-area-morgan-lee',
          targetName: 'Morgan Lee Research',
          sourceUrl: 'https://example.yale.edu/humans/faculty',
          confidence: 0.8,
          userId: 'user-morgan',
          userNetid: 'ml123',
        },
      ],
      skipped: [],
    });
  });
});
