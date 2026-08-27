import { describe, expect, it } from 'vitest';
import {
  dedupePlannedAliases,
  planCanonicalAliasesFromRedirects,
  planCanonicalAliasesFromResearcherTombstones,
  planCanonicalAliasesFromUserTombstones,
} from '../backfillCanonicalAliasesCore';

describe('planCanonicalAliasesFromRedirects', () => {
  it('maps slug and merged id to research-entity aliases and skips self/missing canonical', () => {
    const planned = planCanonicalAliasesFromRedirects([
      { mergedSlug: 'old-lab-slug', mergedEntityId: 'aaa', canonicalEntityId: 'canon' },
      { mergedSlug: null, mergedEntityId: 'canon', canonicalEntityId: 'canon' },
      { mergedSlug: 'no-canonical', mergedEntityId: 'bbb', canonicalEntityId: null },
    ]);
    expect(planned).toEqual([
      { type: 'researchEntity', canonicalType: 'researchEntity', canonicalId: 'canon', reason: 'backfill_research_entity_redirect', aliasNs: 'slug', aliasValue: 'old-lab-slug' },
      { type: 'researchEntity', canonicalType: 'researchEntity', canonicalId: 'canon', reason: 'backfill_research_entity_redirect', aliasNs: 'id', aliasValue: 'aaa' },
    ]);
  });
});

describe('planCanonicalAliasesFromUserTombstones', () => {
  it('maps id, netid, lowercased email, and orcid; skips self-merge', () => {
    const planned = planCanonicalAliasesFromUserTombstones([
      { _id: 'shell1', dedupedIntoUserId: 'canonUser', netid: 'abc123', email: 'Test.Person@example.test', orcid: '9999-8888-7777-6666' },
      { _id: 'self', dedupedIntoUserId: 'self' },
    ]);
    expect(planned).toEqual([
      { type: 'user', canonicalType: 'user', canonicalId: 'canonUser', reason: 'backfill_user_identity_dedupe', aliasNs: 'id', aliasValue: 'shell1' },
      { type: 'user', canonicalType: 'user', canonicalId: 'canonUser', reason: 'backfill_user_identity_dedupe', aliasNs: 'netid', aliasValue: 'abc123' },
      { type: 'user', canonicalType: 'user', canonicalId: 'canonUser', reason: 'backfill_user_identity_dedupe', aliasNs: 'email', aliasValue: 'test.person@example.test' },
      { type: 'user', canonicalType: 'user', canonicalId: 'canonUser', reason: 'backfill_user_identity_dedupe', aliasNs: 'orcid', aliasValue: '9999-8888-7777-6666' },
    ]);
  });
});

describe('planCanonicalAliasesFromResearcherTombstones', () => {
  it('maps id and orcid', () => {
    const planned = planCanonicalAliasesFromResearcherTombstones([
      { _id: 'rShell', dedupedIntoResearcherId: 'rCanon', orcid: '1111-2222-3333-4444' },
    ]);
    expect(planned.map((a) => `${a.aliasNs}:${a.aliasValue}`)).toEqual([
      'id:rShell',
      'orcid:1111-2222-3333-4444',
    ]);
  });
});

describe('dedupePlannedAliases', () => {
  it('collapses duplicate (type, ns, value) keys keeping the first', () => {
    const deduped = dedupePlannedAliases([
      { type: 'user', aliasNs: 'netid', aliasValue: 'abc123', canonicalType: 'user', canonicalId: 'x', reason: 'a' },
      { type: 'user', aliasNs: 'netid', aliasValue: 'abc123', canonicalType: 'user', canonicalId: 'y', reason: 'b' },
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].canonicalId).toBe('x');
  });
});
