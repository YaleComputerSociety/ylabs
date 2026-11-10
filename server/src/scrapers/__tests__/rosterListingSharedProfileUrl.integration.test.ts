import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Researcher } from '../../models/researcher';
import type { ResolvedField } from '../confidenceResolver';
import { resolveRosterMemberIdentity } from '../entityMaterializer';

let memoryServer: MongoMemoryServer | undefined;

const SHARED_URL = 'https://fixture.yale.edu/people/shared-synthetic';

const field = (value: unknown): ResolvedField => ({
  value,
  confidence: 0.9,
  contributingSources: ['centers-institutes-index'],
  hasConflict: false,
});

const listing = (profileUrl: string): Record<string, ResolvedField> => ({
  profileUrl: field(profileUrl),
  role: field('core-faculty'),
});

const officialLink = (url: string) => ({
  kind: 'YALE_OFFICIAL' as const,
  purpose: 'PRIMARY_IDENTITY' as const,
  url,
  verifiedAt: new Date('2026-01-01T00:00:00Z'),
  healthStatus: 'HEALTHY' as const,
});

const holder = (displayName: string, url = SHARED_URL) =>
  Researcher.create({ displayName, profileLinks: [officialLink(url)] });

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri('roster_listing_shared_profile_url_test'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await memoryServer?.stop();
});

describe('a roster listing whose profile URL two researchers hold (#4500)', () => {
  beforeEach(async () => {
    await Researcher.deleteMany({});
  });

  it('joins the one holder the listed name agrees with', async () => {
    const listed = await holder('Avery Synthetic');
    await holder('Blair Synthetic');

    const identity = await resolveRosterMemberIdentity(listing(SHARED_URL), 'Avery Synthetic');

    expect(String(identity.researcher?._id)).toBe(String(listed._id));
  });

  it('resolves to nobody when the listed name agrees with neither holder', async () => {
    await holder('Avery Synthetic');
    await holder('Blair Synthetic');

    const identity = await resolveRosterMemberIdentity(listing(SHARED_URL), 'Casey Fixture');

    expect(identity.researcher).toBeNull();
  });

  it('resolves to nobody when the listed name agrees with both holders', async () => {
    await holder('Avery Synthetic');
    await holder('Avery Synthetic');

    const identity = await resolveRosterMemberIdentity(listing(SHARED_URL), 'Avery Synthetic');

    expect(identity.researcher).toBeNull();
  });

  it('joins a sole holder as before', async () => {
    const sole = await holder('Avery Synthetic');

    const identity = await resolveRosterMemberIdentity(listing(SHARED_URL), 'Avery Synthetic');

    expect(String(identity.researcher?._id)).toBe(String(sole._id));
  });
});
