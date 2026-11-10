import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import routes from '../routes';
import { refreshDirectoryRemovalsBeforeServing } from '../middleware/directoryRemovalFreshness';
import { setDirectoryRemovalServingForTest } from '../services/directoryRemovalServing';
import { buildResearchEntitySearchIndexDocumentsWithMemberNames } from '../services/researchEntitySearchIndexService';
import { directoryRemovalDigest } from '../utils/directoryRemovalDigest';

const KEY = 'synthetic-directory-removal-key-0123456789';
const SLUG = 'synthetic-removal-co-led-lab';
const SOURCE_URL = 'https://syntheticlab.example.edu/';
const REMOVED_LEAD = 'Quillon Varrow';
const KEPT_LEAD = 'Brisa Tallent';
const REMOVED_STUDENT = 'Odile Marchetti';
const KEPT_STUDENT = 'Tobin Ashgrove';
const FULL_DESCRIPTION = `With ${REMOVED_LEAD} as co-lead, the lab studies how synthetic tissues repair after injury. ${REMOVED_STUDENT} built the imaging pipeline the lab uses for every experiment.`;

const entityId = new mongoose.Types.ObjectId();
const removedLeadId = new mongoose.Types.ObjectId();
const keptLeadId = new mongoose.Types.ObjectId();

async function seed(): Promise<void> {
  const db = mongoose.connection.db!;
  for (const name of [
    'research_entities',
    'role_assignments',
    'researchers',
    'signals',
    'directory_removals',
  ]) {
    await db.collection(name).deleteMany({});
  }
  const now = new Date();
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug: SLUG,
    name: 'Synthetic Tissue Repair Lab',
    kind: 'lab',
    entityType: 'LAB',
    schemaVersion: 1,
    archived: false,
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    shortDescription: 'Studies how synthetic tissues repair after injury.',
    fullDescription: FULL_DESCRIPTION,
    websiteUrl: SOURCE_URL,
    sourceUrls: [SOURCE_URL],
    rosterEnrichment: {
      state: 'current',
      observedAt: now,
      freshnessExpiresAt: new Date(now.getTime() + 30 * 24 * 3600_000),
      sourceUrl: `${SOURCE_URL}people`,
      undergraduates: [
        { name: REMOVED_STUDENT, status: 'past', endYear: 2024 },
        { name: KEPT_STUDENT, status: 'past', endYear: 2025 },
      ],
    },
  });
  await db.collection('researchers').insertMany([
    {
      _id: removedLeadId,
      schemaVersion: 1,
      displayName: REMOVED_LEAD,
      identifiers: { netid: 'zz9001' },
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    },
    {
      _id: keptLeadId,
      schemaVersion: 1,
      displayName: KEPT_LEAD,
      identifiers: { netid: 'zz9002' },
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    },
  ]);
  await db.collection('role_assignments').insertMany(
    [removedLeadId, keptLeadId].map((personId) => ({
      schemaVersion: 1,
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 1,
      reviewStatus: 'APPROVED',
      archived: false,
    })),
  );
}

async function recordRemovals(): Promise<void> {
  await mongoose.connection.db!.collection('directory_removals').insertMany([
    {
      digest: directoryRemovalDigest(KEY, 'netid', 'zz9001'),
      kind: 'netid',
      recordedAt: new Date(),
    },
    {
      digest: directoryRemovalDigest(KEY, 'name', REMOVED_STUDENT),
      kind: 'name',
      recordedAt: new Date(),
    },
  ]);
}

describe('a recorded directory removal reaches every served surface (#4160)', () => {
  let replSet: MongoMemoryReplSet;
  let server: Server;
  let baseUrl: string;
  const previousKey = process.env.DIRECTORY_REMOVAL_KEY;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    const app = express();
    app.use(express.json());
    app.use('/api', refreshDirectoryRemovalsBeforeServing);
    app.use('/api', routes);
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    process.env.DIRECTORY_REMOVAL_KEY = previousKey;
    setDirectoryRemovalServingForTest(undefined);
    await new Promise((resolve) => server?.close(resolve));
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    process.env.DIRECTORY_REMOVAL_KEY = KEY;
    setDirectoryRemovalServingForTest(undefined);
    await seed();
  });

  const detailBody = async () => {
    const response = await fetch(`${baseUrl}/api/research/${SLUG}`);
    expect(response.status).toBe(200);
    return response.text();
  };

  it('serves every name while the list is empty', async () => {
    const body = await detailBody();
    for (const name of [REMOVED_LEAD, KEPT_LEAD, REMOVED_STUDENT, KEPT_STUDENT]) {
      expect(body).toContain(name);
    }
  }, 30000);

  it('withholds a removed lead and a removed student from the detail response and keeps the row', async () => {
    await recordRemovals();
    const body = await detailBody();
    expect(body).not.toContain(REMOVED_LEAD);
    expect(body).not.toContain(REMOVED_STUDENT);
    expect(body).toContain(KEPT_LEAD);
    expect(body).toContain(KEPT_STUDENT);
    const detail = JSON.parse(body);
    expect(detail.researchEntity.fullDescription).toContain('a researcher');
    expect(detail.members.map((member: any) => member.displayName ?? member.name)).not.toContain(
      REMOVED_LEAD,
    );
  }, 30000);

  it('keeps removed names out of the search document', async () => {
    await recordRemovals();
    const row = await mongoose.connection
      .db!.collection('research_entities')
      .findOne({ slug: SLUG });
    const [document] = await buildResearchEntitySearchIndexDocumentsWithMemberNames([row]);
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain(REMOVED_LEAD);
    expect(serialized).not.toContain(REMOVED_STUDENT);
    expect(document.leadProfessorNames).toContain(KEPT_LEAD);
    expect(document.slug).toBe(SLUG);
  }, 30000);

  it('withholds every name in a deployed runtime that holds entries but no key', async () => {
    await recordRemovals();
    const previousNodeEnv = process.env.NODE_ENV;
    delete process.env.DIRECTORY_REMOVAL_KEY;
    process.env.NODE_ENV = 'production';
    try {
      const body = await detailBody();
      expect(body).not.toContain(REMOVED_LEAD);
      expect(body).not.toContain(KEPT_LEAD);
      expect(body).not.toContain(KEPT_STUDENT);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }, 30000);
});
