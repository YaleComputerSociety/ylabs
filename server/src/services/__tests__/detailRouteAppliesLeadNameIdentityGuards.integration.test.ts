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

import { getResearchGroupDetail } from '../researchGroupService';

const SLUG = 'nih-pi-marlow-quorrow';
const GRAFTED_ORGANIZATION_NAME = 'Center for Quantitative Outbreak Analysis (CQOA)';
const LEAD_DISPLAY_NAME = 'Marlow Quorrow';
const SOURCE_URL = 'https://medicine.example.edu/profile/marlow-quorrow/';
const READY_SHORT =
  'Studies outbreak transmission modelling across community hospital networks in Connecticut.';
const READY_FULL =
  'This research models outbreak transmission across community hospital networks, combining case-linkage reconstruction, staffing and transfer pattern analysis, and simulation of containment policies to reduce avoidable secondary infections.';

/**
 * A grant-minted row keyed to one person whose name, displayName and entityType were all
 * overwritten with the organization that person directs. The organization `entityType` is
 * the point: it switches off every type-gated person-scope guard, so only the
 * key-names-only-this-person arm can still see that this is one person's record (#2913),
 * and that arm needs the lead name the detail route resolves.
 */
describe('the detail route applies the lead-name identity guards it resolved (#3132)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await Promise.all([
      db.collection('research_entities').deleteMany({}),
      db.collection('role_assignments').deleteMany({}),
      db.collection('researchers').deleteMany({}),
    ]);
  });

  const seed = async (options: { withLead: boolean }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const entityId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: SLUG,
      name: GRAFTED_ORGANIZATION_NAME,
      displayName: GRAFTED_ORGANIZATION_NAME,
      kind: 'center',
      entityType: 'CENTER',
      archived: false,
      departments: ['Epidemiology'],
      researchAreas: ['Infectious disease modelling', 'Health services research'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      shortDescription: READY_SHORT,
      fullDescription: READY_FULL,
      websiteUrl: SOURCE_URL,
      sourceUrls: [SOURCE_URL],
      fieldProvenance: {
        shortDescription: { sourceName: 'fixture-faculty', sourceUrl: SOURCE_URL },
        fullDescription: { sourceName: 'fixture-faculty', sourceUrl: SOURCE_URL },
        name: { sourceName: 'fixture-faculty', sourceUrl: SOURCE_URL },
        displayName: { sourceName: 'fixture-faculty', sourceUrl: SOURCE_URL },
      },
    });
    if (!options.withLead) return;
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: LEAD_DISPLAY_NAME,
      firstName: 'Marlow',
      lastName: 'Quorrow',
      netid: 'fixturequorrow',
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'fixture-faculty', url: SOURCE_URL },
    });
  };

  it("substitutes the row's own research-record name and withholds the grafted displayName", async () => {
    await seed({ withLead: true });

    const detail = await getResearchGroupDetail(SLUG);

    expect(detail).not.toBeNull();
    const served = detail?.researchEntity as Record<string, unknown>;
    expect(served.name).toBe('Marlow Quorrow Faculty Research');
    expect(served.displayName).toBe('');
  });

  /**
   * `name` is the heading every serve path falls back to once `displayName` is refused,
   * so the refusal substitutes rather than clears. A blank heading is the failure this
   * pins: refusing a graft must not drop the only name the row has (#2385).
   */
  it('never leaves the row without a heading', async () => {
    await seed({ withLead: true });

    const detail = await getResearchGroupDetail(SLUG);
    const served = detail?.researchEntity as Record<string, unknown>;

    expect(String(served.displayName || served.name || '')).not.toBe('');
  });

  /**
   * The reachability half. With no lead role edge the route resolves no lead name, the
   * key-names-only-this-person arm cannot open, and the graft is served verbatim. That is
   * what made the arm inert on the detail page for every row: the route computed the
   * names and built its DTO without them.
   */
  it('leaves the graft alone when no lead resolves, so the arm is lead-dependent', async () => {
    await seed({ withLead: false });

    const detail = await getResearchGroupDetail(SLUG);
    const served = detail?.researchEntity as Record<string, unknown>;

    expect(served.name).toBe(GRAFTED_ORGANIZATION_NAME);
  });
});
