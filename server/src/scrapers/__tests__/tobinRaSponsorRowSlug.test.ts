import { beforeEach, describe, expect, it, vi } from 'vitest';

const holders = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock('../../models/researcher', () => ({
  Researcher: {
    find: vi.fn(() => ({
      select: () => ({
        limit: (count: number) => ({ lean: async () => holders.rows.slice(0, count) }),
      }),
    })),
  },
}));

vi.mock('../sources/undergradFellowshipRecipientScraper', async (importActual) => ({
  ...(await importActual<typeof import('../sources/undergradFellowshipRecipientScraper')>()),
  existingLeadRowSlugForOwner: vi.fn(async (owner: { _id: string }) => `row-of-${owner._id}`),
}));

import { defaultSponsorRowSlug } from '../sources/tobinRaProjectsScraper';

const SPONSOR_URL = 'https://economics.yale.edu/people/synthetic-sponsor';
const holder = (id: string) => ({
  _id: id,
  displayName: `Synthetic ${id}`,
  profile: {},
  identifiers: {},
});

describe('defaultSponsorRowSlug (#3551)', () => {
  beforeEach(() => {
    holders.rows = [];
  });

  it('resolves a profile URL held by exactly one live researcher to that researcher lead row', async () => {
    holders.rows = [holder('researcher-one')];

    await expect(defaultSponsorRowSlug(SPONSOR_URL)).resolves.toBe('row-of-researcher-one');
  });

  it('refuses a profile URL that several live researchers share, since it identifies nobody', async () => {
    holders.rows = [holder('researcher-one'), holder('researcher-two')];

    await expect(defaultSponsorRowSlug(SPONSOR_URL)).resolves.toBeNull();
  });

  it('resolves nothing when no live researcher holds the profile URL', async () => {
    await expect(defaultSponsorRowSlug(SPONSOR_URL)).resolves.toBeNull();
  });
});
