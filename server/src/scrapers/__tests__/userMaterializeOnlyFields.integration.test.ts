import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity, materializeFromRun } from '../entityMaterializer';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';

const NETID = 'zz5816a';
const KEY = `netid:${NETID}`;
const EMAIL_NETID = 'zz5816b';
const EMAIL_KEY = `netid:${EMAIL_NETID}`;
const PAGE_EMAIL = 'avery.synthetic5816@yale.edu';
const OWN_PAGE = 'https://medicine.yale.edu/profile/avery-synthetic5816/';
const MINT_KEY = 'dept:fixture5816:avery-synthetic';
const NAMING_SLUG = 'fixture-5816-lab';

describe('a user materialize scoped to named fields writes only that scope (#5816)', () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'observations',
      'researchers',
      'accounts',
      'research_entities',
      'role_assignments',
      'scrape_runs',
    ]) {
      await db.collection(name).deleteMany({});
    }
    resetDirectoryNetidsByAddressCache();
    resetInvalidatedScrapeRunCache();
    resetOverSharedPersonWebsiteKeysCache();
  });

  const observation = (fields: Record<string, unknown>) =>
    Observation.create({
      entityType: 'user',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://fixture5816.example.edu/faculty/',
      confidence: 0.9,
      observedAt: new Date('2026-11-01T00:00:00Z'),
      superseded: false,
      ...fields,
    });

  const seedProfileEvidence = async (entityKey: string) => {
    for (const [field, value] of [
      ['fname', 'Avery'],
      ['lname', 'Synthetic'],
      ['title', 'Professor of Fixture Studies'],
      ['primaryDepartment', 'Fixture Studies'],
      ['imageUrl', 'https://fixture5816.example.edu/photos/avery.jpg'],
      ['websiteUrl', 'https://avery-synthetic5816.example.edu/'],
    ] as const) {
      await observation({ entityKey, field, value });
    }
  };

  const seedResearcher = (extra: Record<string, unknown> = {}) =>
    Researcher.create({
      displayName: 'A. Synthetic',
      identifiers: { netid: NETID },
      profile: {},
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
      ...extra,
    });

  const stored = async (id: unknown) => Researcher.findById(id).lean<any>();

  const withoutPaths = (document: any, paths: readonly string[]) => {
    const copy = structuredClone(document);
    delete copy.updatedAt;
    for (const path of paths) {
      const segments = path.split('.');
      let parent = copy;
      for (const segment of segments.slice(0, -1)) parent = parent?.[segment];
      if (parent) delete parent[segments.at(-1) as string];
      const [root] = segments;
      if (segments.length > 1 && Object.keys(copy[root] ?? {}).length === 0) delete copy[root];
    }
    return copy;
  };

  const resolve = (entityKey: string, onlyFields?: string[], dryRun = false) =>
    materializeEntity(
      'user',
      { entityKey },
      { dryRun, ...(onlyFields ? { userWriteOnlyFields: onlyFields } : {}) },
    );

  it('drops and reports every planned path outside the scope on a dry run', async () => {
    const researcher = await seedResearcher();
    await seedProfileEvidence(KEY);
    const before = await stored(researcher._id);

    const result = await resolve(KEY, ['primaryDepartment'], true);

    expect(result.plannedPaths).toEqual([
      'profile.primaryDepartment',
      'profileFieldWriters.primaryDepartment',
    ]);
    expect(result.droppedPaths).toEqual(expect.arrayContaining(['displayName', 'profile.title']));
    expect(result.fieldsWritten).toBe(2);
    expect(await stored(researcher._id)).toEqual(before);
  });

  it('writes the scope on apply, leaves every other field byte-identical, and settles', async () => {
    const researcher = await seedResearcher();
    await seedProfileEvidence(KEY);
    const before = await stored(researcher._id);

    const applied = await resolve(KEY, ['primaryDepartment']);
    const after = await stored(researcher._id);

    expect(applied.plannedPaths).toEqual([
      'profile.primaryDepartment',
      'profileFieldWriters.primaryDepartment',
    ]);
    expect(after.profile.primaryDepartment).toBe('Fixture Studies');
    expect(after.profileFieldWriters.primaryDepartment.userKey).toBe(KEY);
    expect(withoutPaths(after, applied.plannedPaths ?? [])).toEqual(
      withoutPaths(before, applied.plannedPaths ?? []),
    );
    expect(after.profile.title).toBeUndefined();
    expect(after.displayName).toBe('A. Synthetic');

    const second = await resolve(KEY, ['primaryDepartment']);
    expect(second.plannedPaths).toEqual([]);
    expect(second.fieldsWritten).toBe(0);
  });

  it('plans exactly the display values and their writer records for a display-field scope', async () => {
    const researcher = await seedResearcher();
    await seedProfileEvidence(KEY);
    const scope = ['displayName', 'primaryDepartment', 'imageUrl', 'websiteUrl'];
    const expected = [
      'displayName',
      'profile.imageUrl',
      'profile.primaryDepartment',
      'profile.websiteUrl',
      'profileFieldWriters.displayName',
      'profileFieldWriters.imageUrl',
      'profileFieldWriters.primaryDepartment',
      'profileFieldWriters.websiteUrl',
    ];
    const before = await stored(researcher._id);

    const planned = await resolve(KEY, scope, true);
    expect(planned.plannedPaths).toEqual(expected);
    expect(planned.droppedPaths).toEqual(['profile.title']);

    const applied = await resolve(KEY, scope);
    expect(applied.plannedPaths).toEqual(expected);
    const after = await stored(researcher._id);
    expect(withoutPaths(after, expected)).toEqual(withoutPaths(before, expected));
    expect(after.profile.title).toBeUndefined();
    expect(after.profileFieldWriters.title).toBeUndefined();

    const second = await resolve(KEY, scope);
    expect(second.plannedPaths).toEqual([]);
    expect(second.fieldsWritten).toBe(0);
  });

  it('re-records only writer entries under profileFieldWriters and keeps every value', async () => {
    const researcher = await seedResearcher({
      profileFieldWriters: { title: { userKey: KEY, joinRank: 4, confidence: 0.01 } },
    });
    await seedProfileEvidence(KEY);
    const before = await stored(researcher._id);

    const unscopedPlan = await resolve(KEY, undefined, true);
    expect(unscopedPlan.plannedPaths).toEqual(expect.arrayContaining(['profile']));

    const planned = await resolve(KEY, ['profileFieldWriters'], true);
    expect(planned.plannedPaths?.length).toBeGreaterThan(0);
    expect(planned.plannedPaths?.every((path) => path.startsWith('profileFieldWriters.'))).toBe(
      true,
    );
    expect(planned.plannedPaths).toContain('profileFieldWriters.title');
    expect(planned.droppedPaths).toEqual(expect.arrayContaining(['profile.title', 'displayName']));

    await resolve(KEY, ['profileFieldWriters']);
    const after = await stored(researcher._id);
    expect(after.profileFieldWriters.title).toBeUndefined();
    expect(after.profile).toEqual(before.profile);
    expect(after.displayName).toBe(before.displayName);
    expect(after.identifiers).toEqual(before.identifiers);
    expect(after.profileLinks).toEqual(before.profileLinks);
    expect(withoutPaths(after, ['profileFieldWriters'])).toEqual(
      withoutPaths(before, ['profileFieldWriters']),
    );

    const second = await resolve(KEY, ['profileFieldWriters']);
    expect(second.plannedPaths).toEqual([]);
    expect(second.fieldsWritten).toBe(0);
  });

  it('still derives the email inside an email scope and drops the profile around it', async () => {
    const researcher = await Researcher.create({
      displayName: 'Avery Synthetic',
      identifiers: { netid: EMAIL_NETID },
      profile: {},
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: OWN_PAGE,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
      ],
      status: 'UNKNOWN',
      archived: false,
    });
    await observation({
      entityKey: EMAIL_KEY,
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: OWN_PAGE,
      field: 'email',
      value: PAGE_EMAIL,
    });
    await observation({
      entityKey: EMAIL_KEY,
      sourceUrl: OWN_PAGE,
      field: 'title',
      value: 'Professor of Fixture Studies',
    });
    const before = await stored(researcher._id);

    const planned = await resolve(EMAIL_KEY, ['email'], true);
    expect(planned.plannedPaths).toEqual(['identifiers.email', 'identifiers.emailSupport']);
    expect(planned.droppedPaths).toEqual(expect.arrayContaining(['profile.title']));

    await resolve(EMAIL_KEY, ['identifiers.email']);
    const after = await stored(researcher._id);
    expect(after.identifiers.email).toBe(PAGE_EMAIL);
    expect(after.identifiers.emailSupport).toEqual({
      supported: true,
      sources: ['official-profile-pi-backfill'],
      computedForEmail: PAGE_EMAIL,
    });
    expect(withoutPaths(after, ['identifiers.email', 'identifiers.emailSupport'])).toEqual(
      withoutPaths(before, ['identifiers.email', 'identifiers.emailSupport']),
    );

    const second = await resolve(EMAIL_KEY, ['identifiers.email']);
    expect(second.plannedPaths).toEqual([]);
  });

  it('writes the email support marker only inside a scope that names the email pair (#5627)', async () => {
    const researcher = await seedResearcher({
      identifiers: { netid: NETID, email: PAGE_EMAIL },
    });
    await seedProfileEvidence(KEY);
    await observation({ entityKey: KEY, field: 'email', value: PAGE_EMAIL });

    const outsideScope = await resolve(KEY, ['title']);
    expect(outsideScope.droppedPaths).toEqual(expect.arrayContaining(['identifiers.emailSupport']));
    expect((await stored(researcher._id)).identifiers.emailSupport).toBeUndefined();

    const before = await stored(researcher._id);
    const inScope = await resolve(KEY, ['identifiers.email', 'identifiers.emailSupport']);
    expect(inScope.plannedPaths).toEqual(['identifiers.emailSupport']);
    const after = await stored(researcher._id);
    expect(after.identifiers.emailSupport).toEqual({
      supported: true,
      sources: ['dept-faculty-roster'],
      computedForEmail: PAGE_EMAIL,
    });
    expect(withoutPaths(after, ['identifiers.emailSupport'])).toEqual(
      withoutPaths(before, ['identifiers.emailSupport']),
    );
    expect((await resolve(KEY, ['email'])).plannedPaths).toEqual([]);
  });

  it('mints no researcher and writes no edge on a field-scoped run materialize', async () => {
    const scrapeRunId = new mongoose.Types.ObjectId();
    await ResearchEntity.create({
      slug: NAMING_SLUG,
      name: 'Fixture 5816 Lab',
      entityType: 'LAB',
      kind: 'lab',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: NAMING_SLUG,
      field: 'inferredPiUserKey',
      value: MINT_KEY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://fixture5816.example.edu/faculty/',
      confidence: 0.7,
      observedAt: new Date('2026-11-01T00:00:00Z'),
      superseded: false,
      scrapeRunId,
    });
    for (const [field, value] of [
      ['fname', 'Avery'],
      ['lname', 'Synthetic'],
      ['title', 'Professor of Fixture Studies'],
    ] as const) {
      await observation({ entityKey: MINT_KEY, field, value, scrapeRunId });
    }
    const entityBefore = await ResearchEntity.findOne({ slug: NAMING_SLUG }).lean();

    const result = await materializeFromRun(String(scrapeRunId), {
      userWriteOnlyFields: ['displayName', 'title'],
    });

    expect(await Researcher.countDocuments({})).toBe(0);
    expect(await RoleAssignment.countDocuments({})).toBe(0);
    expect(await ResearchEntity.findOne({ slug: NAMING_SLUG }).lean()).toEqual(entityBefore);
    expect(result.userFieldScope).toMatchObject({
      keys: 1,
      keysWriting: 0,
      plannedPathSet: [],
      rowsOutsideUserSkipped: { researchEntity: 1 },
      runReconciliationsSkipped: true,
      skipped: { 'field-scoped-run-mints-no-researcher': 1 },
    });
    expect(result.userFieldScope?.rows).toEqual([
      expect.objectContaining({
        entityKey: MINT_KEY,
        skipped: 'field-scoped-run-mints-no-researcher',
        plannedPaths: [],
      }),
    ]);

    const unscoped = await materializeEntity('user', { entityKey: MINT_KEY }, {});
    expect(unscoped.created).toBe(true);
    expect(await Researcher.countDocuments({})).toBe(1);
  });

  it('changes nothing about an unscoped resolve', async () => {
    const researcher = await seedResearcher();
    await seedProfileEvidence(KEY);

    const result = await resolve(KEY);

    expect(result.droppedPaths).toBeUndefined();
    const after = await stored(researcher._id);
    expect(after.profile.title).toBe('Professor of Fixture Studies');
    expect(after.profile.primaryDepartment).toBe('Fixture Studies');
  });
});
