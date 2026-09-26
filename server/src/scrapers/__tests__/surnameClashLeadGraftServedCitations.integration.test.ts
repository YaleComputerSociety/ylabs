import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { materializeEntity } from '../entityMaterializer';
import { getResearchGroupDetail } from '../../services/researchGroupService';

const SLUG = 'quimby-lab-rq249';
const NAME = 'Rosalind Quimby Lab';
const OWNER_PAGE = 'https://ysph.yale.edu/people/rosalind-quimby/';
const DIRECTORY_CITED_OWNER_PAGE = 'https://medicine.yale.edu/people/rosalind-quimby/';
const OWN_PROFILE_PAGE = 'https://medicine.yale.edu/profile/rosalind-quimby/';
const STRANGER_PAGE = 'https://medicine.yale.edu/profile/desmond-quimby/';
const DIRECTORY_PAGE = 'https://medicine.yale.edu/internal-medicine/faculty/';

const SHORT_DESCRIPTION =
  'Studies how repeated antibiotic exposure reshapes gut microbial communities in hospitalised patients.';
const FULL_DESCRIPTION =
  'The lab studies how repeated antibiotic exposure reshapes gut microbial communities in hospitalised patients, combining longitudinal stool metagenomics, anaerobic culture of resistant isolates, and pharmacokinetic modelling to predict which treatment courses leave a community unable to recover its original composition.';

const seedEntity = (sourceUrls: string[]) =>
  ResearchEntity.create({
    slug: SLUG,
    name: NAME,
    kind: 'lab',
    entityType: 'LAB',
    studentVisibilityTier: 'student_ready',
    archived: false,
    school: 'School of Medicine',
    departments: ['Internal Medicine'],
    shortDescription: SHORT_DESCRIPTION,
    fullDescription: FULL_DESCRIPTION,
    sourceUrls,
  });

const seedObservation = (
  field: string,
  value: unknown,
  sourceUrl: string,
  confidence: number,
  sourceName: string,
) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey: SLUG,
    field,
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl,
    confidence,
    observedAt: new Date('2026-01-01T00:00:00Z'),
    superseded: false,
  });

const servedSourceUrls = async () => {
  const detail = await getResearchGroupDetail(SLUG);
  return detail?.researchEntity?.sourceUrls ?? [];
};

/**
 * The served citations are the assertion surface because the detail page's
 * official-profile way in reads only `sourceUrls`, so a grafted page is what a
 * student clicks and a refused winner is a way in that disappears (#2945).
 */
describe('a same-surname stranger page never reaches a served row citations (#2945)', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('refuses the stranger against an owner page this same pass projected', async () => {
    await seedEntity([]);
    await seedObservation(
      'sourceUrls',
      [DIRECTORY_PAGE, DIRECTORY_CITED_OWNER_PAGE],
      DIRECTORY_PAGE,
      0.8,
      'ysm-faculty-directory',
    );
    await seedObservation(
      'inferredDirectorName',
      'Desmond Quimby',
      STRANGER_PAGE,
      0.9,
      'ysm-faculty-directory',
    );

    await materializeEntity('researchEntity', { entityKey: SLUG }, {});

    const served = await servedSourceUrls();
    expect(served).toContain(DIRECTORY_CITED_OWNER_PAGE);
    expect(served).not.toContain(STRANGER_PAGE);
  });

  it('refuses the stranger against an owner page the row already cites', async () => {
    await seedEntity([OWNER_PAGE]);
    await seedObservation(
      'inferredDirectorName',
      'Desmond Quimby',
      STRANGER_PAGE,
      0.9,
      'ysm-faculty-directory',
    );

    await materializeEntity('researchEntity', { entityKey: SLUG }, {});

    const served = await servedSourceUrls();
    expect(served).toEqual([OWNER_PAGE]);
  });

  it('keeps the way in by falling through to a lower-confidence own person page', async () => {
    await seedEntity([OWNER_PAGE]);
    await seedObservation(
      'inferredDirectorName',
      'Desmond Quimby',
      STRANGER_PAGE,
      0.9,
      'ysm-faculty-directory',
    );
    await seedObservation(
      'inferredPiUserKey',
      'dept:internal-medicine:rosalind-quimby',
      OWN_PROFILE_PAGE,
      0.6,
      'ysm-faculty-directory',
    );

    await materializeEntity('researchEntity', { entityKey: SLUG }, {});

    const served = await servedSourceUrls();
    expect(served).toContain(OWN_PROFILE_PAGE);
    expect(served).not.toContain(STRANGER_PAGE);
  });

  it('still mints a lead page on a row whose own person citation is already lost', async () => {
    await seedEntity([]);
    await seedObservation(
      'inferredDirectorName',
      'Desmond Quimby',
      STRANGER_PAGE,
      0.9,
      'ysm-faculty-directory',
    );

    await materializeEntity('researchEntity', { entityKey: SLUG }, {});

    expect(await servedSourceUrls()).toEqual([STRANGER_PAGE]);
  });

  it('retracts a stored graft on a row with no lead-profile observation to trigger on (#3000)', async () => {
    await seedEntity([OWNER_PAGE, STRANGER_PAGE]);
    await seedObservation(
      'researchAreas',
      ['Microbial ecology'],
      DIRECTORY_PAGE,
      0.8,
      'ysm-faculty-directory',
    );

    expect(await servedSourceUrls()).toEqual([OWNER_PAGE, STRANGER_PAGE]);

    await materializeEntity('researchEntity', { entityKey: SLUG }, {});

    expect(await servedSourceUrls()).toEqual([OWNER_PAGE]);
  });

  it('retracts a stored graft arbitrated against a nested owner citation (#3000)', async () => {
    const NESTED_OWNER_PAGE = 'https://medicine.yale.edu/cancer/profile/rosalind-quimby/';
    await seedEntity([NESTED_OWNER_PAGE, STRANGER_PAGE]);
    await seedObservation(
      'researchAreas',
      ['Microbial ecology'],
      DIRECTORY_PAGE,
      0.8,
      'ysm-faculty-directory',
    );

    await materializeEntity('researchEntity', { entityKey: SLUG }, {});

    expect(await servedSourceUrls()).toEqual([NESTED_OWNER_PAGE]);
  });

  it('retracts a stored graft published at a nested person path (#3000)', async () => {
    const NESTED_STRANGER_PAGE = 'https://jackson.yale.edu/person/desmond-quimby';
    await seedEntity([OWNER_PAGE, NESTED_STRANGER_PAGE]);
    await seedObservation(
      'researchAreas',
      ['Microbial ecology'],
      DIRECTORY_PAGE,
      0.8,
      'ysm-faculty-directory',
    );

    await materializeEntity('researchEntity', { entityKey: SLUG }, {});

    expect(await servedSourceUrls()).toEqual([OWNER_PAGE]);
  });

  it('never empties a row that cites only one person page, however the arm reads it', async () => {
    await seedEntity([STRANGER_PAGE, DIRECTORY_PAGE]);
    await seedObservation(
      'researchAreas',
      ['Microbial ecology'],
      DIRECTORY_PAGE,
      0.8,
      'ysm-faculty-directory',
    );

    await materializeEntity('researchEntity', { entityKey: SLUG }, {});

    expect(await servedSourceUrls()).toContain(STRANGER_PAGE);
  });
});
