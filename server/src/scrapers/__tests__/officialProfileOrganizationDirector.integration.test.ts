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
    syncEntities: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity } from '../entityMaterializer';
import {
  organizationDirectorClaimFromProfile,
  organizationDirectorObservations,
  selectOrganizationDirectorProfileTargets,
} from '../sources/officialProfilePiBackfillScraper';

const SOURCE_NAME = 'official-profile-pi-backfill';
const PROFILE_URL = 'https://medicine.yale.edu/profile/rowan-fixturedirector/';
const PROGRAM_URL = 'https://medicine.yale.edu/psychiatry/research/fixture-mood/';
const ORGANIZATION_SLUG = 'fixturedirector-lab-rf12';

const PROFILE_HTML = `
  <html><head>
    <title>Rowan Fixturedirector | Yale School of Medicine</title>
    <link rel="canonical" href="${PROFILE_URL}" />
  </head>
  <body><main>
    <h1>Rowan Fixturedirector</h1>
    <p>Professor of Psychiatry; Director, Fixture Mood Research Program</p>
    <a href="${PROGRAM_URL}">Visit Website</a>
  </main></body></html>`;

describe('a lead-less organization gains the director its director profile names (#5085)', () => {
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
    for (const name of ['observations', 'researchers', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedOrganization = (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: ORGANIZATION_SLUG,
      name: 'Fixture Mood Research Program',
      entityType: 'INITIATIVE',
      kind: 'initiative',
      websiteUrl: PROGRAM_URL,
      sourceUrls: [PROFILE_URL, PROGRAM_URL],
      archived: false,
      ...overrides,
    });

  const seedDirector = () =>
    Researcher.create({
      displayName: 'Rowan Fixturedirector',
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: PROFILE_URL,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
      ],
      status: 'UNKNOWN',
      archived: false,
    });

  it('selects the organization and writes a DIRECTOR edge to the person the profile belongs to', async () => {
    const organization = await seedOrganization();
    const director = await seedDirector();

    const [target] = await selectOrganizationDirectorProfileTargets(10);
    expect(String(target?._id)).toBe(String(organization._id));

    const claim = organizationDirectorClaimFromProfile(PROFILE_HTML, PROFILE_URL, target);
    expect(claim).not.toBeNull();
    const sourceId = new mongoose.Types.ObjectId();
    for (const observation of organizationDirectorObservations(target, claim!)) {
      await Observation.create({
        ...observation,
        sourceId,
        sourceName: SOURCE_NAME,
        confidence: 0.9,
        observedAt: new Date('2026-10-17T00:00:00Z'),
        superseded: false,
      });
    }

    const result = await materializeEntity('researchGroupMember', {
      entityKey: `${ORGANIZATION_SLUG}:rowan-fixturedirector`,
    });

    expect(result.skipped).toBeUndefined();
    const edges = await RoleAssignment.find({ 'target.id': organization._id }).lean();
    expect(edges).toEqual([
      expect.objectContaining({
        role: 'DIRECTOR',
        archived: false,
        rosterProvenance: expect.objectContaining({ sourceName: SOURCE_NAME }),
      }),
    ]);
    expect(String(edges[0].personId)).toBe(String(director._id));

    const [reread] = await selectOrganizationDirectorProfileTargets(10);
    expect(String(reread?._id)).toBe(String(organization._id));
    expect(reread?.heldDirectorNames).toEqual([director.displayName]);
  });

  it('does not select a person-named row that only carries an organizational type', async () => {
    await seedOrganization({ name: 'Fixturedirector Lab' });

    expect(await selectOrganizationDirectorProfileTargets(10)).toEqual([]);
  });
});
