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

const ADDRESS_OWNER_SLUG = 'ysm-quimby-neonatal-lab';
const CITING_READER_SLUG = 'ysm-halloran-airway-lab';

const OWNED_ADDRESS = 'https://medicine.yale.edu/lab/quimby/';
const READER_OWN_ADDRESS = 'https://medicine.yale.edu/lab/halloran/';

const OWNER_SHORT =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const OWNER_FULL =
  'The lab studies neonatal care quality improvement across community hospital nurseries, pairing implementation trials of standardized resuscitation protocols with chart review of delivery-room outcomes to explain why comparable nurseries reach very different rates of avoidable transfer.';
const READER_SHORT =
  'Studies airway inflammation and macrophage biology in chronic obstructive pulmonary disease.';
const READER_FULL =
  'Research covers airway inflammation and macrophage biology in chronic obstructive pulmonary disease cohorts, combining bronchoscopic sampling, single-cell transcriptional profiling of alveolar macrophages, and longitudinal spirometry to describe which inflammatory programs track loss of lung function.';

type PersistedVisibility = {
  slug?: string;
  studentVisibilityTier?: string;
  studentVisibilityReasons?: string[];
};

const persisted = (slug: string) =>
  ResearchEntity.findOne({ slug }).lean<PersistedVisibility>() as Promise<PersistedVisibility>;

describe('a stale citation does not suppress the row that publishes the address (#1896)', () => {
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

  const seedLab = async (input: {
    slug: string;
    name: string;
    lastName: string;
    websiteUrl: string;
    sourceUrls: string[];
    shortDescription: string;
    fullDescription: string;
    studentVisibilityTier: string;
    studentVisibilityReasons: string[];
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
      departments: ['Pediatrics'],
      researchAreas: ['Quality improvement', 'Pulmonary medicine'],
      studentVisibilityTier: input.studentVisibilityTier,
      studentVisibilityReasons: input.studentVisibilityReasons,
      shortDescription: input.shortDescription,
      fullDescription: input.fullDescription,
      websiteUrl: input.websiteUrl,
      sourceUrls: input.sourceUrls,
      fieldProvenance: {
        websiteUrl: { sourceName: 'ysm-lab-site', sourceUrl: input.websiteUrl },
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
    await seedLab({
      slug: ADDRESS_OWNER_SLUG,
      name: 'Quimby Neonatal Outcomes Lab',
      lastName: 'Quimby',
      websiteUrl: OWNED_ADDRESS,
      sourceUrls: [OWNED_ADDRESS],
      shortDescription: OWNER_SHORT,
      fullDescription: OWNER_FULL,
      studentVisibilityTier: 'operator_review',
      studentVisibilityReasons: [],
    });
    await seedLab({
      slug: CITING_READER_SLUG,
      name: 'Halloran Airway Inflammation Lab',
      lastName: 'Halloran',
      websiteUrl: READER_OWN_ADDRESS,
      sourceUrls: [READER_OWN_ADDRESS, OWNED_ADDRESS],
      shortDescription: READER_SHORT,
      fullDescription: READER_FULL,
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
    });
  });

  it('serves the address owner to students instead of holding it for the citation', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const owner = await persisted(ADDRESS_OWNER_SLUG);
    expect(owner.studentVisibilityReasons).not.toContain('exact_url_duplicate_risk');
    expect(owner.studentVisibilityReasons).not.toContain('duplicate_risk');
    expect(owner.studentVisibilityTier).toBe('student_ready');

    const servedOwner = await getResearchGroupDetail(ADDRESS_OWNER_SLUG);
    expect(servedOwner?.researchEntity.name).toBe('Quimby Neonatal Outcomes Lab');
    expect(servedOwner?.researchEntity.websiteUrl).toBe(OWNED_ADDRESS);
    expect(servedOwner?.researchEntity.shortDescription).toBe(OWNER_SHORT);
  }, 60000);

  it('leaves the citing row served on its own address as well', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const reader = await persisted(CITING_READER_SLUG);
    expect(reader.studentVisibilityReasons).not.toContain('exact_url_duplicate_risk');

    const servedReader = await getResearchGroupDetail(CITING_READER_SLUG);
    expect(servedReader?.researchEntity.websiteUrl).toBe(READER_OWN_ADDRESS);
  }, 60000);

  it('still holds the citing row when it serves a field harvested from that page', async () => {
    await ResearchEntity.updateOne(
      { slug: CITING_READER_SLUG },
      {
        $set: {
          'fieldProvenance.fullDescription': {
            sourceName: 'ysm-lab-site',
            sourceUrl: OWNED_ADDRESS,
          },
        },
      },
    );

    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const contested = [ADDRESS_OWNER_SLUG, CITING_READER_SLUG];
    const reasonsBySlug = await Promise.all(
      contested.map(async (slug) => ({
        slug,
        reasons: (await persisted(slug)).studentVisibilityReasons || [],
        reachable: (await getResearchGroupDetail(slug)) !== null,
      })),
    );

    expect(
      reasonsBySlug.filter((row) => row.reasons.includes('exact_url_duplicate_risk')),
    ).toHaveLength(1);
    expect(reasonsBySlug.filter((row) => row.reachable)).toHaveLength(1);
  }, 60000);
});
