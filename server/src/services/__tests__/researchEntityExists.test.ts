import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = {
  slugs: new Set<string>(),
  objectIds: new Set<string>(),
  slugQueries: 0,
};

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    exists: async (query: { slug?: string; _id?: string }) => {
      if (typeof query.slug === 'string') {
        store.slugQueries += 1;
        return store.slugs.has(query.slug) ? { _id: 'found' } : null;
      }
      if (typeof query._id === 'string') {
        return store.objectIds.has(query._id) ? { _id: query._id } : null;
      }
      return null;
    },
  },
}));

vi.mock('../../models/account', () => ({ Account: { exists: async () => null } }));
vi.mock('../../models/fellowship', () => ({ Fellowship: { exists: async () => null } }));

const { researchEntityExists } = await import('../researchAnalytics');

const OBJECT_ID = '507f1f77bcf86cd799439010';

beforeEach(() => {
  store.slugs.clear();
  store.objectIds.clear();
  store.slugQueries = 0;
});

describe('researchEntityExists for a research entity', () => {
  it('accepts the slug, which is the only identifier the public DTO ever publishes', async () => {
    store.slugs.add('dept-physics-example-lab');

    expect(await researchEntityExists('research_entity', 'dept-physics-example-lab')).toBe(true);
  });

  it('still accepts an ObjectId, which server-side callers hold', async () => {
    store.objectIds.add(OBJECT_ID);

    expect(await researchEntityExists('research_entity', OBJECT_ID)).toBe(true);
  });

  it('rejects an identifier that matches neither a slug nor an ObjectId', async () => {
    expect(await researchEntityExists('research_entity', 'no-such-entity')).toBe(false);
    expect(await researchEntityExists('research_entity', OBJECT_ID)).toBe(false);
  });

  it('trims the identifier before looking it up', async () => {
    store.slugs.add('dept-physics-example-lab');

    expect(await researchEntityExists('research_entity', '  dept-physics-example-lab  ')).toBe(
      true,
    );
  });

  it('looks a slug up even when it is not a valid ObjectId, rather than refusing early', async () => {
    await researchEntityExists('research_entity', 'not-an-object-id');

    expect(store.slugQueries).toBe(1);
  });
});
