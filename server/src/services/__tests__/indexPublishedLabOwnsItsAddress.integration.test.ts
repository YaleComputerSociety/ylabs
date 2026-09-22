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
import { runStudentVisibilityGate } from '../studentVisibilityGateService';

const INDEX_PUBLISHED_SLUG = 'ysm-marlow-vesicle-lab';
const PROFILE_BORROWER_SLUG = 'ysm-faculty-sunil-ashford';

const LAB_ADDRESS = 'https://medicine.yale.edu/lab/marlow/';
const LAB_ADDRESS_DEFAULT_DOCUMENT = 'https://medicine.yale.edu/lab/marlow/index.aspx';

const INDEX_PUBLISHED_SHORT =
  'Studies how synaptic vesicles recycle and reload between rounds of neurotransmitter release.';
const INDEX_PUBLISHED_FULL =
  'The lab studies synaptic vesicle recycling in central neurons, combining live imaging of labelled vesicle pools, electrophysiology of paired recordings, and genetic perturbation of endocytic adaptors to map how a terminal reloads between rounds of neurotransmitter release.';
const BORROWER_SHORT =
  'Studies membrane trafficking and secretory pathway regulation in cultured epithelial cells.';
const BORROWER_FULL =
  'Research covers membrane trafficking and secretory pathway regulation in cultured epithelial cells, using quantitative fluorescence microscopy, proximity labelling of cargo receptors, and reconstitution assays to describe how vesicle coats select their cargo.';

type PersistedVisibility = {
  slug?: string;
  name?: string;
  websiteUrl?: string;
  studentVisibilityTier?: string;
  studentVisibilityReasons?: string[];
};

const persisted = (slug: string) =>
  ResearchEntity.findOne({ slug }).lean<PersistedVisibility>() as Promise<PersistedVisibility>;

describe('a lab whose address Yale’s research-home index publishes owns that address (#2786)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  const seedPi = async (entityId: mongoose.Types.ObjectId, lastName: string) => {
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

  const seedServedLab = async (input: {
    slug: string;
    name: string;
    lastName: string;
    websiteUrl: string;
    websiteUrlSourceName: string;
    shortDescription: string;
    fullDescription: string;
  }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const entityId = new mongoose.Types.ObjectId();
    const descriptionSourceUrl = `https://medicine.yale.edu/profile/${input.lastName}/`;
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: input.slug,
      name: input.name,
      displayName: input.name,
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Cell Biology'],
      researchAreas: ['Membrane trafficking', 'Neuroscience'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      shortDescription: input.shortDescription,
      fullDescription: input.fullDescription,
      websiteUrl: input.websiteUrl,
      sourceUrls: [input.websiteUrl],
      fieldProvenance: {
        websiteUrl: { sourceName: input.websiteUrlSourceName, sourceUrl: input.websiteUrl },
        shortDescription: { sourceName: 'ysm-faculty', sourceUrl: descriptionSourceUrl },
        fullDescription: { sourceName: 'ysm-faculty', sourceUrl: descriptionSourceUrl },
        displayName: { sourceName: 'ysm-faculty', sourceUrl: descriptionSourceUrl },
      },
    });
    await seedPi(entityId, input.lastName);
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
    await seedServedLab({
      slug: INDEX_PUBLISHED_SLUG,
      name: 'Marlow Vesicle Recycling Lab',
      lastName: 'Marlow',
      websiteUrl: LAB_ADDRESS,
      websiteUrlSourceName: 'ysm-atoz-index',
      shortDescription: INDEX_PUBLISHED_SHORT,
      fullDescription: INDEX_PUBLISHED_FULL,
    });
    await seedServedLab({
      slug: PROFILE_BORROWER_SLUG,
      name: 'Ashford Trafficking Group',
      lastName: 'Ashford',
      websiteUrl: LAB_ADDRESS_DEFAULT_DOCUMENT,
      websiteUrlSourceName: 'ysm-faculty-directory',
      shortDescription: BORROWER_SHORT,
      fullDescription: BORROWER_FULL,
    });
  });

  it('serves the index-published lab and holds the row that borrowed its address', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const indexPublished = await persisted(INDEX_PUBLISHED_SLUG);
    expect(indexPublished.studentVisibilityTier).toBe('student_ready');
    expect(indexPublished.studentVisibilityReasons).not.toContain('exact_url_duplicate_risk');

    const borrower = await persisted(PROFILE_BORROWER_SLUG);
    expect(borrower.studentVisibilityReasons).toContain('exact_url_duplicate_risk');
    expect(borrower.studentVisibilityTier).not.toBe('student_ready');

    const servedIndexPublished = await getResearchGroupDetail(INDEX_PUBLISHED_SLUG);
    expect(servedIndexPublished?.researchEntity.name).toBe('Marlow Vesicle Recycling Lab');
    expect(servedIndexPublished?.researchEntity.websiteUrl).toBe(LAB_ADDRESS);
    expect(await getResearchGroupDetail(PROFILE_BORROWER_SLUG)).toBeNull();
  }, 60000);

  it('leaves exactly one of the two colliding rows on the student-facing surface', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const served = await Promise.all(
      [INDEX_PUBLISHED_SLUG, PROFILE_BORROWER_SLUG].map(async (slug) => ({
        slug,
        reachable: (await getResearchGroupDetail(slug)) !== null,
      })),
    );
    expect(served.filter((row) => row.reachable).map((row) => row.slug)).toEqual([
      INDEX_PUBLISHED_SLUG,
    ]);
  }, 60000);
});
