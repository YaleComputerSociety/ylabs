import { describe, expect, it } from 'vitest';
import {
  buildExploratoryPathwayDedupePlan,
  parseDedupeExploratoryPathwaysArgs,
} from '../dedupeExploratoryPathwaysCore';

describe('parseDedupeExploratoryPathwaysArgs', () => {
  it('defaults to dry-run with a bounded limit', () => {
    expect(parseDedupeExploratoryPathwaysArgs([])).toEqual({
      apply: false,
      limit: 100,
    });
  });

  it('parses apply, limit, and entity-id flags', () => {
    expect(
      parseDedupeExploratoryPathwaysArgs([
        '--',
        '--apply',
        '--limit=25',
        '--entity-id=64f000000000000000000001',
      ]),
    ).toEqual({
      apply: true,
      limit: 25,
      entityId: '64f000000000000000000001',
    });
  });
});

describe('buildExploratoryPathwayDedupePlan', () => {
  it('plans groups that contain a canonical row and at least one legacy row', () => {
    const plan = buildExploratoryPathwayDedupePlan([
      {
        _id: 'canonical-a',
        researchEntityId: 'entity-a',
        derivationKey: 'pathway:EXPLORATORY_CONTACT',
      },
      {
        _id: 'legacy-a',
        researchEntityId: 'entity-a',
        derivationKey: 'pathway:EXPLORATORY_CONTACT:CURRENT_UNDERGRADS',
      },
      {
        _id: 'canonical-b',
        researchEntityId: 'entity-b',
        derivationKey: 'pathway:EXPLORATORY_CONTACT',
      },
    ]);

    expect(plan.plannedGroups).toHaveLength(1);
    expect(plan.plannedGroups[0]).toMatchObject({
      researchEntityId: 'entity-a',
      canonicalPathwayId: 'canonical-a',
      legacyPathwayIds: ['legacy-a'],
    });
    expect(plan.plannedLegacyPathways).toBe(1);
    expect(plan.skippedGroups).toEqual([]);
  });

  it('promotes a legacy row when a duplicate group has no canonical row yet', () => {
    const plan = buildExploratoryPathwayDedupePlan([
      {
        _id: 'legacy-a',
        researchEntityId: 'entity-a',
        derivationKey: 'pathway:EXPLORATORY_CONTACT:PAST_UNDERGRADS',
      },
      {
        _id: 'legacy-b',
        researchEntityId: 'entity-a',
        derivationKey: 'pathway:EXPLORATORY_CONTACT:ACCEPTING_SIGNAL',
      },
    ]);

    expect(plan.plannedGroups).toEqual([
      {
        researchEntityId: 'entity-a',
        canonicalPathwayId: 'legacy-a',
        promoteCanonical: true,
        legacyPathwayIds: ['legacy-b'],
        legacyDerivationKeys: [
          'pathway:EXPLORATORY_CONTACT:PAST_UNDERGRADS',
          'pathway:EXPLORATORY_CONTACT:ACCEPTING_SIGNAL',
        ],
      },
    ]);
    expect(plan.plannedLegacyPathways).toBe(1);
    expect(plan.skippedGroups).toEqual([]);
  });

  it('plans official-profile fallback duplicates even when their derivation keys are not legacy keys', () => {
    const plan = buildExploratoryPathwayDedupePlan([
      {
        _id: 'canonical',
        researchEntityId: 'entity-a',
        derivationKey: 'pathway:EXPLORATORY_CONTACT',
      },
      {
        _id: 'profile-a',
        researchEntityId: 'entity-a',
        derivationKey: 'pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:user-a',
      },
      {
        _id: 'profile-b',
        researchEntityId: 'entity-a',
        derivationKey: 'pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:user-b',
      },
    ]);

    expect(plan.plannedGroups).toEqual([
      {
        researchEntityId: 'entity-a',
        canonicalPathwayId: 'canonical',
        legacyPathwayIds: ['profile-a', 'profile-b'],
        legacyDerivationKeys: [
          'pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:user-a',
          'pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:user-b',
        ],
      },
    ]);
  });
});
