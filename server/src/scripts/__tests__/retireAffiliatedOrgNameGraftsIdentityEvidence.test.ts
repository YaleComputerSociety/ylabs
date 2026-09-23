import { describe, expect, it } from 'vitest';

import {
  entityKeyPersonTokens,
  personIdentityTokens,
  researchHomeIdentitySource,
} from '../../utils/researchHomeNameIdentityAuthority';
import { summarizeIdentityEvidence, type OrgNameGraftRow } from '../retireAffiliatedOrgNameGrafts';

const graftRow = (overrides: Partial<OrgNameGraftRow> = {}): OrgNameGraftRow =>
  ({
    entitySlug: 'fixture-entity',
    servedName: 'Fixture Name',
    entityType: 'LAB',
    studentVisibilityTier: 'operator_review',
    graftedName: 'The Fixture Center',
    sourceName: 'ysm-faculty-directory',
    sourceUrl: 'https://example.invalid/profile/fixture',
    verdict: 'AFFILIATED_ORGANIZATION',
    observationIds: [],
    documentStillServesGraft: false,
    documentGraftedFields: [],
    replacementNameAfterRollback: '',
    needsRescrapeToRename: true,
    replacementIsStillAnOrganization: false,
    identitySource: 'resolved_lead',
    graftedWebsiteUrl: '',
    websiteObservationIds: [],
    websiteSurvivorExists: false,
    websiteNeedsDirectorshipReview: '',
    ...overrides,
  }) as OrgNameGraftRow;

describe('researchHomeIdentitySource names the evidence an eponym check will use', () => {
  it('reports a resolved lead as the real predicate', () => {
    expect(
      researchHomeIdentitySource({
        personName: 'Ada Placeholder',
        slug: 'yale-sleep-neurobiology-lab',
      }),
    ).toBe('resolved_lead');
  });

  /**
   * The downgrade this names: a slug describes the research rather than the person,
   * so these tokens are a strictly weaker stand-in for a lead's name (#2384).
   */
  it('reports slug tokens when no lead resolved, even though tokens exist', () => {
    expect(entityKeyPersonTokens('yale-sleep-neurobiology-lab')).not.toHaveLength(0);
    expect(personIdentityTokens('')).toHaveLength(0);
    expect(
      researchHomeIdentitySource({ personName: '', slug: 'yale-sleep-neurobiology-lab' }),
    ).toBe('entity_key_tokens');
  });

  /**
   * Not a weaker signal but no signal: with zero identity tokens
   * `eponymMatchesIdentity` cannot match, so every eponym reads as somebody
   * else's and a correctly self-named record is refused on no evidence.
   */
  it('reports no identity evidence when the slug carries only source words', () => {
    expect(entityKeyPersonTokens('ysm-faculty-research')).toHaveLength(0);
    expect(researchHomeIdentitySource({ personName: '', slug: 'ysm-faculty-research' })).toBe(
      'none',
    );
    expect(researchHomeIdentitySource({ personName: undefined, slug: undefined })).toBe('none');
  });

  it('treats a lead whose name yields no tokens as no lead at all', () => {
    expect(researchHomeIdentitySource({ personName: '   ', slug: 'ysm-faculty-research' })).toBe(
      'none',
    );
  });
});

describe('the graft repair reports how much of its output rests on a resolved lead', () => {
  it('splits refusals and their verdicts by identity evidence', () => {
    const summary = summarizeIdentityEvidence([
      graftRow({ identitySource: 'resolved_lead', verdict: 'AFFILIATED_ORGANIZATION' }),
      graftRow({ identitySource: 'resolved_lead', verdict: 'ANOTHER_PERSONS_LAB' }),
      graftRow({ identitySource: 'entity_key_tokens', verdict: 'ANOTHER_PERSONS_LAB' }),
      graftRow({ identitySource: 'entity_key_tokens', verdict: 'ANOTHER_PERSONS_LAB' }),
      graftRow({ identitySource: 'none', verdict: 'AFFILIATED_ORGANIZATION' }),
    ]);

    expect(summary.byIdentitySource).toEqual({
      resolved_lead: 2,
      entity_key_tokens: 2,
      none: 1,
    });
    expect(summary.verdictsByIdentitySource).toEqual({
      resolved_lead: { AFFILIATED_ORGANIZATION: 1, ANOTHER_PERSONS_LAB: 1 },
      entity_key_tokens: { ANOTHER_PERSONS_LAB: 2 },
      none: { AFFILIATED_ORGANIZATION: 1 },
    });
    expect(summary.refusalsOnAResolvedLead).toBe(2);
    expect(summary.refusalsOnEntityKeyTokensOnly).toBe(2);
    expect(summary.refusalsOnNoIdentityEvidence).toBe(1);
  });

  it('reports zeros rather than absent keys, so a degraded bucket cannot read as unmeasured', () => {
    const summary = summarizeIdentityEvidence([graftRow()]);

    expect(summary.byIdentitySource.entity_key_tokens).toBe(0);
    expect(summary.byIdentitySource.none).toBe(0);
  });
});
