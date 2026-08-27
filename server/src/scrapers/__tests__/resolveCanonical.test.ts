import { describe, expect, it } from 'vitest';
import {
  deriveCanonicalKeys,
  resolveCanonical,
  type CanonicalKey,
  type CandidateEntity,
  type ResolveCanonicalDeps,
} from '../resolveCanonical';
import { type CanonicalType } from '../../models/canonicalAlias';

function deps(overrides: Partial<ResolveCanonicalDeps> = {}): ResolveCanonicalDeps {
  return {
    resolveAlias: async () => null,
    findCandidatesByKey: async () => [],
    ...overrides,
  };
}

function candidatesByNs(
  table: Record<string, CandidateEntity[]>,
): ResolveCanonicalDeps['findCandidatesByKey'] {
  return async (_type: CanonicalType, key: CanonicalKey) => table[key.ns] ?? [];
}

describe('deriveCanonicalKeys', () => {
  it('marks netid/orcid unique and email strong only when person-specific', () => {
    const keys = deriveCanonicalKeys('user', [
      { field: 'netid', value: 'jdo9' },
      { field: 'orcid', value: '9999-8888-7777-6666' },
      { field: 'email', value: 'jane.doe@example.edu' },
      { field: 'fname', value: 'Jane' },
      { field: 'lname', value: 'Doe' },
    ]);
    const byNs = Object.fromEntries(keys.map((k) => [k.ns, k]));
    expect(byNs.netid.strength).toBe('unique');
    expect(byNs.orcid.strength).toBe('unique');
    expect(byNs.email?.strength).toBe('strong');
  });

  it('drops a non-person-specific (shared lab) email', () => {
    const keys = deriveCanonicalKeys('user', [
      { field: 'email', value: 'lab-info@example.edu' },
      { field: 'fname', value: 'Jane' },
      { field: 'lname', value: 'Doe' },
    ]);
    expect(keys.find((k) => k.ns === 'email')).toBeUndefined();
  });

  it('derives research-entity keys with correct strengths', () => {
    const keys = deriveCanonicalKeys('researchEntity', [
      { field: 'slug', value: 'ocean-lab' },
      { field: 'websiteUrl', value: 'https://oceanlab.example.edu/' },
      { field: 'name', value: 'Ocean Lab' },
    ]);
    const byNs = Object.fromEntries(keys.map((k) => [k.ns, k.strength]));
    expect(byNs.slug).toBe('unique');
    expect(byNs['website-url']).toBe('strong');
    expect(byNs['org-name']).toBe('weak');
  });
});

describe('resolveCanonical', () => {
  const uniqueNetid: CanonicalKey = { ns: 'netid', value: 'jdo9', strength: 'unique' };

  it('resolves to an existing canonical via the alias ledger', async () => {
    const result = await resolveCanonical(
      { type: 'user', keys: [uniqueNetid] },
      deps({ resolveAlias: async () => 'canonical-1' }),
    );
    expect(result).toEqual({
      status: 'existing',
      canonicalId: 'canonical-1',
      matchedKey: uniqueNetid,
    });
  });

  it('resolves to a single live unique-key candidate', async () => {
    const result = await resolveCanonical(
      { type: 'user', keys: [uniqueNetid] },
      deps({ findCandidatesByKey: candidatesByNs({ netid: [{ id: 'u1' }] }) }),
    );
    expect(result.status).toBe('existing');
    if (result.status === 'existing') expect(result.canonicalId).toBe('u1');
  });

  it('returns ambiguous when a unique key matches more than one live candidate', async () => {
    const result = await resolveCanonical(
      { type: 'user', keys: [uniqueNetid] },
      deps({ findCandidatesByKey: candidatesByNs({ netid: [{ id: 'u1' }, { id: 'u2' }] }) }),
    );
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') expect(result.candidates).toEqual(['u1', 'u2']);
  });

  it('resolves a strong website key when lead names do not conflict', async () => {
    const key: CanonicalKey = {
      ns: 'website-url',
      value: 'oceanlab.example.edu',
      strength: 'strong',
    };
    const result = await resolveCanonical(
      { type: 'researchEntity', keys: [key], self: { id: 'new', name: 'Jane Doe Lab' } },
      deps({
        findCandidatesByKey: candidatesByNs({
          'website-url': [{ id: 'e1', name: 'Jane Doe Lab' }],
        }),
      }),
    );
    expect(result.status).toBe('existing');
  });

  it('returns ambiguous on a strong key when lead first names conflict', async () => {
    const key: CanonicalKey = {
      ns: 'website-url',
      value: 'shared.example.edu',
      strength: 'strong',
    };
    const result = await resolveCanonical(
      { type: 'researchEntity', keys: [key], self: { id: 'new', name: 'Jane Doe' } },
      deps({
        findCandidatesByKey: candidatesByNs({ 'website-url': [{ id: 'e1', name: 'John Doe' }] }),
      }),
    );
    expect(result.status).toBe('ambiguous');
  });

  it('vetoes a shared email between different people (ambiguous)', async () => {
    const key: CanonicalKey = { ns: 'email', value: 'shared@example.edu', strength: 'strong' };
    const differentPerson = deps({
      findCandidatesByKey: candidatesByNs({ email: [{ id: 'u1', fname: 'John', lname: 'Doe' }] }),
    });
    const input = {
      type: 'user' as CanonicalType,
      keys: [key],
      self: { id: 'new', fname: 'Jane', lname: 'Doe' },
    };
    const first = await resolveCanonical(input, differentPerson);
    const second = await resolveCanonical(input, differentPerson);
    expect(first.status).toBe('ambiguous');
    expect(second).toEqual(first);
  });

  it('resolves a shared email for the same-name person', async () => {
    const key: CanonicalKey = { ns: 'email', value: 'shared@example.edu', strength: 'strong' };
    const result = await resolveCanonical(
      { type: 'user', keys: [key], self: { id: 'new', fname: 'Jane', lname: 'Doe' } },
      deps({
        findCandidatesByKey: candidatesByNs({ email: [{ id: 'u1', fname: 'Jane', lname: 'Doe' }] }),
      }),
    );
    expect(result.status).toBe('existing');
  });

  it('mints when nothing matches, reserving only non-weak keys', async () => {
    const keys: CanonicalKey[] = [
      { ns: 'slug', value: 'ocean-lab', strength: 'unique' },
      { ns: 'org-name', value: 'ocean lab', strength: 'weak' },
    ];
    const result = await resolveCanonical({ type: 'researchEntity', keys }, deps());
    expect(result.status).toBe('mint');
    if (result.status === 'mint') {
      expect(result.reservedKeys.map((k) => k.ns)).toEqual(['slug']);
    }
  });

  it('defers to mint when resolving would demote student visibility', async () => {
    const result = await resolveCanonical(
      {
        type: 'researchEntity',
        keys: [{ ns: 'slug', value: 's', strength: 'unique' }],
        self: { id: 'new', tier: 'student_ready' },
      },
      deps({ findCandidatesByKey: candidatesByNs({ slug: [{ id: 'e1', tier: 'suppressed' }] }) }),
    );
    expect(result.status).toBe('mint');
  });

  it('tries remaining keys instead of minting when a stronger key would demote', async () => {
    const keys: CanonicalKey[] = [
      { ns: 'slug', value: 's', strength: 'unique' },
      { ns: 'website-url', value: 'lab.example.edu', strength: 'strong' },
    ];
    const result = await resolveCanonical(
      { type: 'researchEntity', keys, self: { id: 'new', tier: 'student_ready' } },
      deps({
        findCandidatesByKey: candidatesByNs({
          slug: [{ id: 'suppressed-1', tier: 'suppressed' }],
          'website-url': [{ id: 'e2', tier: 'student_ready' }],
        }),
      }),
    );
    expect(result.status).toBe('existing');
    if (result.status === 'existing') expect(result.canonicalId).toBe('e2');
  });

  it('does not collapse two distinct fellowships that share a normalized title', async () => {
    const title: CanonicalKey = {
      ns: 'title',
      value: 'graduate research fellowship',
      strength: 'weak',
    };
    const result = await resolveCanonical(
      {
        type: 'fellowship',
        keys: [title],
        self: { id: 'new', name: 'graduate research fellowship' },
      },
      deps({
        findCandidatesByKey: candidatesByNs({
          title: [{ id: 'f1', name: 'graduate research fellowship' }],
        }),
      }),
    );
    expect(result.status).toBe('mint');
  });

  it('does not merge on a weak org-name key without lead-name corroboration', async () => {
    const key: CanonicalKey = { ns: 'org-name', value: 'ocean lab', strength: 'weak' };
    const result = await resolveCanonical(
      { type: 'researchEntity', keys: [key], self: { id: 'new' } },
      deps({
        findCandidatesByKey: candidatesByNs({ 'org-name': [{ id: 'e1', name: 'Ocean Lab' }] }),
      }),
    );
    expect(result.status).toBe('mint');
  });

  it('merges on a weak org-name key when lead person names corroborate', async () => {
    const key: CanonicalKey = { ns: 'org-name', value: 'jane doe lab', strength: 'weak' };
    const result = await resolveCanonical(
      { type: 'researchEntity', keys: [key], self: { id: 'new', name: 'Jane Doe Lab' } },
      deps({
        findCandidatesByKey: candidatesByNs({ 'org-name': [{ id: 'e1', name: 'Jane Doe Lab' }] }),
      }),
    );
    expect(result.status).toBe('existing');
    if (result.status === 'existing') expect(result.canonicalId).toBe('e1');
  });
});
