import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import {
  loadOfficialLeadRowsForResearcher,
  resolveCanonicalResearchHomeForResearcher,
} from '../canonicalResearchHomeResolver';
import { materializeEntity } from '../entityMaterializer';

const PROFILE_HOST = 'https://medicine.yale.edu/profile';
const SHARED_LAB_SITE = 'https://medicine.example.edu/lab/shared-imaging/';

const seedResearcher = async (displayName: string, profileSlug: string) =>
  Researcher.create({
    displayName,
    profileLinks: [
      {
        kind: 'YALE_OFFICIAL',
        purpose: 'PRIMARY_IDENTITY',
        url: `${PROFILE_HOST}/${profileSlug}/`,
        verifiedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ],
    archived: false,
  });

const seedRow = async (input: {
  slug: string;
  name: string;
  entityType: string;
  websiteUrl?: string;
  sourceUrls?: string[];
}) =>
  ResearchEntity.create({
    slug: input.slug,
    name: input.name,
    entityType: input.entityType,
    websiteUrl: input.websiteUrl,
    sourceUrls: input.sourceUrls ?? [],
    studentVisibilityTier: 'student_ready',
    archived: false,
  });

const seedLeadEdge = async (
  personId: mongoose.Types.ObjectId,
  rowId: mongoose.Types.ObjectId,
  provenance?: { sourceName: string; sourceUrl: string },
) =>
  RoleAssignment.collection.insertOne({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: rowId },
    role: 'PI',
    state: 'CURRENT',
    archived: false,
    ...(provenance ? { rosterProvenance: provenance } : {}),
  });

const seedInferredPi = async (input: {
  entityKey: string;
  personId: mongoose.Types.ObjectId;
  sourceName: string;
  sourceUrl: string;
}) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey: input.entityKey,
    field: 'inferredPiUserId',
    value: input.personId.toString(),
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    confidence: 0.9,
    observedAt: new Date('2026-06-01T00:00:00Z'),
    superseded: false,
  });

const leadEdgeStates = async (rowId: mongoose.Types.ObjectId) => {
  const edges = await RoleAssignment.find({ 'target.id': rowId, role: 'PI' })
    .select('personId state')
    .lean<Array<{ personId: unknown; state?: string }>>();
  return new Map(
    edges.map((edge) => [String(edge.personId), edge.state === 'HISTORICAL' ? 'ended' : 'live']),
  );
};

describe('a faculty research row is a lead target only for its own person (#5979)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
  });

  describe('grant targeting', () => {
    it("does not send a co-lead's grant to a colleague's faculty research row", async () => {
      const owner = await seedResearcher('Ada Quill', 'ada-quill');
      const colead = await seedResearcher('Bo Nimbus', 'bo-nimbus');
      const ownersRow = await seedRow({
        slug: 'ysm-faculty-ada-quill',
        name: 'Ada Quill Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: SHARED_LAB_SITE,
        sourceUrls: [`${PROFILE_HOST}/ada-quill/`],
      });
      await seedLeadEdge(owner._id, ownersRow._id);
      await seedLeadEdge(colead._id, ownersRow._id);

      await expect(resolveCanonicalResearchHomeForResearcher(String(colead._id))).resolves.toEqual({
        status: 'safe-shell',
      });
      await expect(loadOfficialLeadRowsForResearcher(String(colead._id))).resolves.toEqual([]);
    });

    it("sends the co-lead's grant to their own row rather than refusing it as ambiguous", async () => {
      const owner = await seedResearcher('Ada Quill', 'ada-quill');
      const colead = await seedResearcher('Bo Nimbus', 'bo-nimbus');
      const ownersRow = await seedRow({
        slug: 'ysm-faculty-ada-quill',
        name: 'Ada Quill Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: SHARED_LAB_SITE,
        sourceUrls: [`${PROFILE_HOST}/ada-quill/`],
      });
      const coleadsRow = await seedRow({
        slug: 'ysm-faculty-bo-nimbus',
        name: 'Bo Nimbus Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: [`${PROFILE_HOST}/bo-nimbus/`],
      });
      await seedLeadEdge(owner._id, ownersRow._id);
      await seedLeadEdge(colead._id, ownersRow._id);
      await seedLeadEdge(colead._id, coleadsRow._id);

      await expect(resolveCanonicalResearchHomeForResearcher(String(colead._id))).resolves.toEqual({
        status: 'canonical',
        slug: 'ysm-faculty-bo-nimbus',
      });
    });

    it("still sends a researcher's grant to their own faculty research row", async () => {
      const owner = await seedResearcher('Ada Quill', 'ada-quill');
      const byProfile = await seedRow({
        slug: 'ysm-faculty-ada-quill',
        name: 'Molecular Imaging',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: [`${PROFILE_HOST}/ada-quill/`],
      });
      await seedLeadEdge(owner._id, byProfile._id);

      await expect(resolveCanonicalResearchHomeForResearcher(String(owner._id))).resolves.toEqual({
        status: 'canonical',
        slug: 'ysm-faculty-ada-quill',
      });
      await expect(loadOfficialLeadRowsForResearcher(String(owner._id))).resolves.toEqual([
        { slug: 'ysm-faculty-ada-quill', leadPersonIds: [String(owner._id)] },
      ]);
    });

    it('recognizes an own row by a key naming the person or their lab, with no profile link', async () => {
      const namedByKey = await seedResearcher('Cy Tarn', 'cy-tarn-unlinked');
      const keyRow = await seedRow({
        slug: 'dept-architecture-cy-tarn',
        name: 'Urban Media Studio',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: 'https://studio.example.edu/',
      });
      await seedLeadEdge(namedByKey._id, keyRow._id);
      const namedByLabKey = await seedResearcher('Di Orrel', 'di-orrel-unlinked');
      const labKeyRow = await seedRow({
        slug: 'orrel-lab-do42',
        name: 'Orrel Lab',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: 'https://orrel.example.edu/',
      });
      await seedLeadEdge(namedByLabKey._id, labKeyRow._id);

      await expect(
        resolveCanonicalResearchHomeForResearcher(String(namedByKey._id)),
      ).resolves.toEqual({ status: 'canonical', slug: 'dept-architecture-cy-tarn' });
      await expect(
        resolveCanonicalResearchHomeForResearcher(String(namedByLabKey._id)),
      ).resolves.toEqual({ status: 'canonical', slug: 'orrel-lab-do42' });
    });

    it('keeps a genuinely co-led lab a grant target for both of its leads', async () => {
      const first = await seedResearcher('Ada Quill', 'ada-quill');
      const second = await seedResearcher('Bo Nimbus', 'bo-nimbus');
      const lab = await seedRow({
        slug: 'shared-imaging-lab',
        name: 'Shared Imaging Lab',
        entityType: 'LAB',
        websiteUrl: SHARED_LAB_SITE,
      });
      await seedLeadEdge(first._id, lab._id);
      await seedLeadEdge(second._id, lab._id);

      for (const person of [first, second]) {
        await expect(
          resolveCanonicalResearchHomeForResearcher(String(person._id)),
        ).resolves.toEqual({ status: 'canonical', slug: 'shared-imaging-lab' });
      }
      const coLed = await loadOfficialLeadRowsForResearcher(String(second._id));
      expect(coLed.map((row) => row.slug)).toEqual(['shared-imaging-lab']);
      expect([...coLed[0].leadPersonIds].sort()).toEqual(
        [String(first._id), String(second._id)].sort(),
      );
    });
  });

  describe('lead edges whose evidence is retired', () => {
    const LAB_KEY = 'shared-imaging-lab';
    const GRANT_SOURCE = 'nih-reporter';

    const seedCoLedLab = async () => {
      const first = await seedResearcher('Ada Quill', 'ada-quill');
      const second = await seedResearcher('Bo Nimbus', 'bo-nimbus');
      const lab = await seedRow({
        slug: LAB_KEY,
        name: 'Shared Imaging Lab',
        entityType: 'LAB',
        websiteUrl: SHARED_LAB_SITE,
        sourceUrls: [SHARED_LAB_SITE],
      });
      const firstRead = await seedInferredPi({
        entityKey: LAB_KEY,
        personId: first._id,
        sourceName: GRANT_SOURCE,
        sourceUrl: 'https://reporter.example.gov/project-details/1001',
      });
      await seedInferredPi({
        entityKey: LAB_KEY,
        personId: second._id,
        sourceName: GRANT_SOURCE,
        sourceUrl: 'https://reporter.example.gov/project-details/1002',
      });
      await materializeEntity('researchEntity', { entityKey: LAB_KEY }, {});
      return { first, second, lab, firstRead };
    };

    it('stops serving an edge once every read it cites is rolled back', async () => {
      const { first, second, lab, firstRead } = await seedCoLedLab();
      expect(await leadEdgeStates(lab._id)).toEqual(
        new Map([
          [String(first._id), 'live'],
          [String(second._id), 'live'],
        ]),
      );

      await Observation.updateOne(
        { _id: firstRead._id },
        { $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason: 'synthetic' } } },
      );
      await materializeEntity('researchEntity', { entityKey: LAB_KEY }, {});

      expect(await leadEdgeStates(lab._id)).toEqual(
        new Map([
          [String(first._id), 'ended'],
          [String(second._id), 'live'],
        ]),
      );
      expect(await Observation.countDocuments({})).toBe(2);
    });

    it('keeps both leads of a co-led lab while their reads are live', async () => {
      const { first, second, lab } = await seedCoLedLab();
      await materializeEntity('researchEntity', { entityKey: LAB_KEY }, {});

      expect(await leadEdgeStates(lab._id)).toEqual(
        new Map([
          [String(first._id), 'live'],
          [String(second._id), 'live'],
        ]),
      );
    });

    it('keeps an edge that a newer live read of the same person still states', async () => {
      const { first, lab, firstRead } = await seedCoLedLab();
      await Observation.updateOne({ _id: firstRead._id }, { $set: { superseded: true } });
      await seedInferredPi({
        entityKey: LAB_KEY,
        personId: first._id,
        sourceName: GRANT_SOURCE,
        sourceUrl: 'https://reporter.example.gov/project-details/1003',
      });
      await materializeEntity('researchEntity', { entityKey: LAB_KEY }, {});

      expect((await leadEdgeStates(lab._id)).get(String(first._id))).toBe('live');
    });

    it('leaves an edge whose citation was never read on the row', async () => {
      const { lab } = await seedCoLedLab();
      const listed = await seedResearcher('Cy Tarn', 'cy-tarn');
      await seedLeadEdge(listed._id, lab._id, {
        sourceName: 'synthetic-roster',
        sourceUrl: 'https://medicine.example.edu/lab/shared-imaging/people/',
      });
      await materializeEntity('researchEntity', { entityKey: LAB_KEY }, {});

      expect((await leadEdgeStates(lab._id)).get(String(listed._id))).toBe('live');
    });
  });
});
