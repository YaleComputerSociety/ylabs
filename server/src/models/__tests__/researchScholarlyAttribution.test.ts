import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  ResearchScholarlyAttribution,
  scholarlyAttributionRelationshipBases,
} from '../researchScholarlyAttribution';

describe('ResearchScholarlyAttribution', () => {
  it('requires at least one target user or research entity', async () => {
    const attribution = new ResearchScholarlyAttribution({
      scholarlyLinkId: new mongoose.Types.ObjectId(),
      relationshipBasis: 'identity_authorship',
      evidenceLabel: 'Authored by a verified Yale faculty identity',
      derivationKey: 'identity:user:link',
    });

    await expect(attribution.validate()).rejects.toThrow(
      'ResearchScholarlyAttribution requires targetUserId or targetResearchEntityId',
    );
  });

  it('accepts user-targeted and entity-targeted relationship evidence', async () => {
    const scholarlyLinkId = new mongoose.Types.ObjectId();

    await expect(
      new ResearchScholarlyAttribution({
        scholarlyLinkId,
        targetUserId: new mongoose.Types.ObjectId(),
        relationshipBasis: 'identity_authorship',
        evidenceLabel: 'Authored by a verified Yale faculty identity',
        derivationKey: 'identity:user:link',
      }).validate(),
    ).resolves.toBeUndefined();

    await expect(
      new ResearchScholarlyAttribution({
        scholarlyLinkId,
        targetResearchEntityId: new mongoose.Types.ObjectId(),
        relationshipBasis: 'explicit_entity_link',
        evidenceLabel: 'Linked to this research profile',
        derivationKey: 'entity:profile:link',
      }).validate(),
    ).resolves.toBeUndefined();
  });

  it('limits relationship bases to explicit scholarly attribution meanings', () => {
    expect(scholarlyAttributionRelationshipBases).toEqual([
      'identity_authorship',
      'explicit_entity_link',
      'official_profile_publication',
      'manual',
    ]);
  });
});
