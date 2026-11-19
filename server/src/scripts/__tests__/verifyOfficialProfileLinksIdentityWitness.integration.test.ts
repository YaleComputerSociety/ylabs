import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Researcher } from '../../models/researcher';
import type { SourceLinkHealth } from '../../services/sourceLinkHealth';
import type { OfficialProfilePageIdentity } from '../../services/officialProfileLinkIdentity';
import { runVerifyOfficialProfileLinks } from '../verifyOfficialProfileLinks';

const DEAD_URL = 'https://example-dept.yale.edu/people/c-synthetic';
const NAME_URL = 'https://example-dept.yale.edu/profile/casey-synthetic';
const PERSON_EMAIL = 'casey.synthetic5605@yale.edu';

const instantSleep = async (): Promise<void> => {};

const officialLink = (url: string) => ({
  kind: 'YALE_OFFICIAL' as const,
  purpose: 'PRIMARY_IDENTITY' as const,
  url,
  verifiedAt: new Date('2026-01-01T00:00:00Z'),
  healthStatus: 'UNKNOWN' as const,
});

const probe = async (url: string): Promise<SourceLinkHealth> =>
  url === NAME_URL
    ? { healthStatus: 'HEALTHY', httpStatusCode: 200 }
    : { healthStatus: 'UNAVAILABLE', httpStatusCode: 404 };

describe('the verify lane adopts a name-derived official link only on an identity witness (#5605)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    await Researcher.deleteMany({});
  });

  const seedPerson = () =>
    Researcher.create({
      displayName: 'Casey Synthetic',
      identifiers: { netid: 'zzc5605', email: PERSON_EMAIL },
      profileLinks: [officialLink(DEAD_URL)],
    });

  const run = (
    apply: boolean,
    readPageIdentity: (url: string) => Promise<OfficialProfilePageIdentity | undefined>,
  ) =>
    runVerifyOfficialProfileLinks({
      apply,
      host: 'example-dept.yale.edu',
      hostConcurrency: 1,
      probe,
      readPageIdentity,
      directory: new Map(),
      sleep: instantSleep,
      retries: 0,
    });

  const personRow = async (researcherId: unknown, apply: boolean, reader = vi.fn()) =>
    (await run(apply, reader)).rows.find((row) => row.researcherId === String(researcherId));

  const storedUrl = async (id: unknown) =>
    (
      (await Researcher.findById(id).lean()) as {
        profileLinks?: Array<{ kind: string; url: string }>;
      } | null
    )?.profileLinks?.find((link) => link.kind === 'YALE_OFFICIAL')?.url;

  it('refuses a page another live researcher with a different netid already carries, on every run', async () => {
    const person = await seedPerson();
    await Researcher.create({
      displayName: 'Casey Synthetic',
      identifiers: { netid: 'zzd5605' },
      profileLinks: [officialLink(NAME_URL)],
    });
    const reader = vi.fn(async () => ({ email: PERSON_EMAIL }));

    const first = await personRow(person._id, false, reader);
    const second = await personRow(person._id, false, reader);
    expect(first).toMatchObject({
      verdict: 'dead',
      refusedCandidates: [{ url: NAME_URL, reason: 'held-by-another-netid' }],
    });
    expect(second).toEqual(first);

    await personRow(person._id, true, reader);
    expect(await storedUrl(person._id)).toBe(DEAD_URL);
  });

  it('lets a twin with no netid share the page once the page names the person', async () => {
    const person = await seedPerson();
    await Researcher.create({
      displayName: 'Casey Synthetic',
      profileLinks: [officialLink(NAME_URL)],
    });

    const row = await personRow(
      person._id,
      true,
      vi.fn(async () => ({ email: PERSON_EMAIL })),
    );
    expect(row).toMatchObject({ verdict: 'repaired', replacementUrl: NAME_URL });
    expect(row?.refusedCandidates).toBeUndefined();
    expect(await storedUrl(person._id)).toBe(NAME_URL);
  });

  it('refuses a live name-derived page whose own identity does not name the person, on every run', async () => {
    const person = await seedPerson();
    const reader = vi.fn(async () => ({ email: 'another.synthetic5605@yale.edu' }));

    const first = await personRow(person._id, false, reader);
    const second = await personRow(person._id, false, reader);
    expect(first).toMatchObject({
      verdict: 'dead',
      refusedCandidates: [{ url: NAME_URL, reason: 'page-identity-not-witnessed' }],
    });
    expect(second).toEqual(first);

    await personRow(person._id, true, reader);
    expect(await storedUrl(person._id)).toBe(DEAD_URL);
  });

  it('refuses a name-derived page when the researcher has nothing for the page to match', async () => {
    const person = await Researcher.create({
      displayName: 'Casey Synthetic',
      profileLinks: [officialLink(DEAD_URL)],
    });

    const row = await personRow(
      person._id,
      false,
      vi.fn(async () => ({ email: PERSON_EMAIL })),
    );
    expect(row).toMatchObject({
      verdict: 'dead',
      refusedCandidates: [{ url: NAME_URL, reason: 'page-identity-not-witnessed' }],
    });
  });
});
