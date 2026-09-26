/**
 * The served half of #2360. A person-scoped row can end up carrying the name of a
 * shared academic host organization it cites: "Computer Systems Lab at Yale" names a
 * 13-faculty cross-department laboratory, and read off one member's faculty-directory
 * page it clears every name-axis rule the corpus has.
 *
 * These cases pin the two student-facing surfaces rather than the engine. The detail
 * route is the JSON an entity page renders, and the Meilisearch document is what a
 * search hit renders from; the alias a client prefers over `name` has to be withheld
 * on both, and a row whose own `name` is the host organization's has to be held off
 * student surfaces entirely because there is nothing to substitute. The citation is
 * the evidence, not the resolved website: #2359 already refuses the host root to a
 * person-scoped row, so by serve time the graft is visible only in `sourceUrls`.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { ResearchEntity } from '../../models/researchEntity';
import { getResearchGroupDetail } from '../researchGroupService';
import { buildResearchEntitySearchIndexDocument } from '../researchEntitySearchIndexService';
import { runStudentVisibilityGate } from '../studentVisibilityGateService';

const HOST_ORGANIZATION_NAME = 'Computer Systems Lab at Yale';
const HOST_ROOT = 'https://csl.yale.edu/';
const TENANT_PAGE = 'https://csl.yale.edu/~marrowbane/';

const ALIAS_GRAFT_SLUG = 'ysm-faculty-quilla-marrowbane';
const ALIAS_GRAFT_OWN_NAME = 'Quilla Marrowbane Faculty Research';
const NAME_GRAFT_SLUG = 'ysm-faculty-wren-halloway';
const MEMBER_OWN_LAB_SLUG = 'ysm-faculty-jordan-rivers';
const MEMBER_OWN_LAB_NAME = 'Analog and RF Circuits Lab at Yale';

const READY_SHORT =
  'Studies how distributed storage systems keep working while individual machines fail.';
const READY_FULL =
  'The group studies how distributed storage systems keep working while individual machines fail, combining fault-injection experiments on production-scale clusters, formal models of replica placement, and measurement of tail latency under partial failure to design storage layers that degrade predictably.';

type PersistedRow = {
  _id?: unknown;
  name?: string;
  displayName?: string;
  studentVisibilityTier?: string;
  studentVisibilityReasons?: string[];
};

const persisted = (slug: string) =>
  ResearchEntity.findOne({ slug }).lean<PersistedRow>() as Promise<PersistedRow>;

describe('a shared academic host organization name never reaches a student (#2360)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  const seedLead = async (entityId: mongoose.Types.ObjectId, lastName: string) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: `Robin ${lastName}`,
      firstName: 'Robin',
      lastName,
      netid: `fixture${lastName.toLowerCase()}`,
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'ysm-faculty', url: `https://medicine.yale.edu/profile/${lastName}/` },
    });
  };

  const seedServedRow = async (input: {
    slug: string;
    name: string;
    displayName: string;
    lastName: string;
    websiteUrl: string;
    citedHostUrl: string;
  }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const entityId = new mongoose.Types.ObjectId();
    const profileUrl = `https://medicine.yale.edu/profile/${input.lastName}/`;
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: input.slug,
      name: input.name,
      displayName: input.displayName,
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Computer Science'],
      researchAreas: ['Distributed systems', 'Computer architecture'],
      // Already published: the graft is served until the gate re-runs, which is the
      // state the student-facing assertions below are about.
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      shortDescription: READY_SHORT,
      fullDescription: READY_FULL,
      websiteUrl: input.websiteUrl,
      sourceUrls: [profileUrl, input.citedHostUrl],
      fieldProvenance: {
        shortDescription: { sourceName: 'ysm-faculty', sourceUrl: profileUrl },
        fullDescription: { sourceName: 'ysm-faculty', sourceUrl: profileUrl },
        displayName: { sourceName: 'ysm-faculty', sourceUrl: profileUrl },
      },
    });
    await seedLead(entityId, input.lastName);
    return entityId;
  };

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'visibility_release_queue_items',
      'signals',
      'observations',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await seedServedRow({
      slug: ALIAS_GRAFT_SLUG,
      name: ALIAS_GRAFT_OWN_NAME,
      displayName: HOST_ORGANIZATION_NAME,
      lastName: 'Marrowbane',
      // The resolver already refused the host root to this person-scoped row (#2359),
      // so the only surviving evidence is the citation.
      websiteUrl: `https://medicine.yale.edu/profile/Marrowbane/`,
      citedHostUrl: HOST_ROOT,
    });
    await seedServedRow({
      slug: NAME_GRAFT_SLUG,
      name: HOST_ORGANIZATION_NAME,
      displayName: HOST_ORGANIZATION_NAME,
      lastName: 'Halloway',
      websiteUrl: `https://medicine.yale.edu/profile/Halloway/`,
      citedHostUrl: HOST_ROOT,
    });
    await seedServedRow({
      slug: MEMBER_OWN_LAB_SLUG,
      name: MEMBER_OWN_LAB_NAME,
      displayName: MEMBER_OWN_LAB_NAME,
      lastName: 'Rivers',
      websiteUrl: TENANT_PAGE,
      citedHostUrl: TENANT_PAGE,
    });
  });

  it('withholds the host organization alias from the detail route and titles the card with the row own name', async () => {
    const detail = await getResearchGroupDetail(ALIAS_GRAFT_SLUG);
    const served = detail?.researchEntity as Record<string, any> | undefined;
    expect(served).toBeTruthy();
    expect(served?.displayName).not.toBe(HOST_ORGANIZATION_NAME);
    // Clients prefer displayName and fall back to name, so this is the heading a
    // student actually reads on the entity page.
    expect(served?.displayName || served?.name).toBe(ALIAS_GRAFT_OWN_NAME);
  }, 30000);

  it('drops the host organization alias from the search index document a hit renders from', async () => {
    const row = await persisted(ALIAS_GRAFT_SLUG);
    const indexed = buildResearchEntitySearchIndexDocument(row);
    expect(indexed?.name).toBe(ALIAS_GRAFT_OWN_NAME);
    expect(indexed?.displayName).toBeUndefined();
  });

  it('holds a row whose own name is the host organization name off every student surface', async () => {
    expect(await getResearchGroupDetail(NAME_GRAFT_SLUG)).not.toBeNull();

    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const gated = await persisted(NAME_GRAFT_SLUG);
    expect(gated.studentVisibilityTier).toBe('operator_review');
    // Held rather than blanked: nothing on the row derives a research-record name
    // from a host organization's, so there is no substitution to make.
    expect(gated.studentVisibilityReasons).toContain('unusable_name');
    expect(await getResearchGroupDetail(NAME_GRAFT_SLUG)).toBeNull();
  }, 30000);

  it('keeps serving a member own lab living on the same shared host', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const gated = await persisted(MEMBER_OWN_LAB_SLUG);
    expect(gated.studentVisibilityTier).toBe('student_ready');
    expect(gated.studentVisibilityReasons).not.toContain('unusable_name');

    const detail = await getResearchGroupDetail(MEMBER_OWN_LAB_SLUG);
    const served = detail?.researchEntity as Record<string, any> | undefined;
    expect(served?.displayName).toBe(MEMBER_OWN_LAB_NAME);

    const indexed = buildResearchEntitySearchIndexDocument(await persisted(MEMBER_OWN_LAB_SLUG));
    expect(indexed?.displayName).toBe(MEMBER_OWN_LAB_NAME);
  }, 30000);
});
