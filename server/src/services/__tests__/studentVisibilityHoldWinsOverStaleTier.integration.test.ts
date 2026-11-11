import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getResearchGroupBySlug } from '../../controllers/researchGroupController';
import { ResearchEntity } from '../../models/researchEntity';
import { runStudentVisibilityOverride } from '../../scripts/studentVisibilityOverride';
import { parseStudentVisibilityOverrideArgs } from '../../scripts/studentVisibilityOverrideCore';
import { readFellowship, readFellowships } from '../fellowshipService';
import { getResearchGroupDetail } from '../researchGroupService';
import { buildResearchEntitySearchIndexDocument } from '../researchEntitySearchIndexService';
import { runStudentVisibilityGate } from '../studentVisibilityGateService';

const HELD = 'quasar-held-lab';
const NEIGHBOUR = 'quasar-neighbour-lab';
const REASON = 'fixture_hold: the served description is a biography fragment';

const DESCRIPTION =
  'The lab studies how accretion onto supermassive black holes regulates star formation in host galaxies, combining radio interferometry with hydrodynamic simulations of feedback.';

const devEnv = (mongoUrl: string): NodeJS.ProcessEnv => ({
  MONGODBURL: mongoUrl,
  SCRAPER_ENV: 'development',
  NODE_ENV: 'development',
  ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
});

const holdArgs = (tier: 'operator_review' | 'suppressed') =>
  parseStudentVisibilityOverrideArgs([
    `--slug=${HELD}`,
    `--tier=${tier}`,
    `--reason=${REASON}`,
    '--actor=fixtureop',
    '--apply',
    '--confirm-student-visibility-override',
  ]);

const anonymousDetailStatus = async (slug: string): Promise<number> => {
  let status = 0;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
    redirect(code: number) {
      status = code;
      return this;
    },
  } as unknown as Response;
  await getResearchGroupBySlug(
    { params: { slug }, baseUrl: '/api/research', user: undefined } as unknown as Request,
    response,
  );
  return status;
};

describe('an operator hold wins over a stale stored tier (#5783)', () => {
  let replSet: MongoMemoryReplSet;
  let mongoUrl: string;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    mongoUrl = `${replSet.getUri().replace(/\/\?/, '/Development?')}`;
    await mongoose.connect(mongoUrl);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  const seedLab = async (slug: string, name: string, surname: string) => {
    const db = mongoose.connection.db!;
    const entityId = new mongoose.Types.ObjectId();
    const site = `https://${slug}.example.edu/`;
    const profile = `https://medicine.yale.edu/profile/${surname}/`;
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug,
      name,
      displayName: name,
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Astronomy'],
      researchAreas: ['Galaxy evolution'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      shortDescription: 'Studies how black hole feedback regulates star formation.',
      fullDescription: DESCRIPTION,
      websiteUrl: site,
      sourceUrls: [site],
      activeAtYaleCache: true,
      fieldProvenance: {
        websiteUrl: { sourceName: 'lab-site', sourceUrl: site },
        shortDescription: { sourceName: 'faculty', sourceUrl: profile },
        fullDescription: { sourceName: 'faculty', sourceUrl: profile },
        displayName: { sourceName: 'faculty', sourceUrl: profile },
      },
    });
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: `Quasar ${surname}`,
      firstName: 'Quasar',
      lastName: surname,
      netid: `fixture${surname}`,
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'faculty', url: profile },
    });
    return entityId;
  };

  const seedServedPair = async () => {
    const heldId = await seedLab(HELD, 'Quasar Held Lab', 'heldfix');
    const neighbourId = await seedLab(NEIGHBOUR, 'Quasar Neighbour Lab', 'neighbourfix');
    await mongoose.connection.db!.collection('research_entity_relationships').insertOne({
      sourceResearchEntityId: heldId,
      targetResearchEntityId: neighbourId,
      relationshipType: 'AFFILIATED_LAB',
      label: 'Member lab',
      evidenceStrength: 'MODERATE',
      confidence: 0.8,
      archived: false,
    });
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    return heldId;
  };

  const resetStoredTierAsARematerializeWould = async (entityId: mongoose.Types.ObjectId) => {
    await mongoose.connection.db!.collection('research_entities').updateOne(
      { _id: entityId },
      {
        $set: {
          studentVisibilityTier: 'student_ready',
          studentVisibilityComputedTier: 'student_ready',
        },
      },
    );
  };

  const affiliatedSlugsOfNeighbour = async () =>
    ((await getResearchGroupDetail(NEIGHBOUR)) as any)?.affiliatedResearchEntities?.map(
      (entity: any) => entity.slug,
    ) ?? [];

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'research_entity_relationships',
      'admin_audit_events',
      'visibility_release_queue_items',
      'signals',
      'observations',
      'fellowships',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  it('does not serve a row whose hold was recorded after the stored tier was decided', async () => {
    const heldId = await seedServedPair();
    expect(await anonymousDetailStatus(HELD)).toBe(200);
    expect(await affiliatedSlugsOfNeighbour()).toEqual([HELD]);

    await mongoose.connection
      .db!.collection('research_entities')
      .updateOne({ _id: heldId }, { $set: { studentVisibilityOverrideTier: 'operator_review' } });

    const row = await ResearchEntity.findById(heldId).lean<any>();
    expect(row.studentVisibilityTier).toBe('student_ready');
    expect(await anonymousDetailStatus(HELD)).toBe(404);
    expect(await getResearchGroupDetail(HELD)).toBeNull();
    expect(await affiliatedSlugsOfNeighbour()).toEqual([]);
    expect(buildResearchEntitySearchIndexDocument(row)?.studentVisibilityTier).toBe(
      'operator_review',
    );
    expect(await anonymousDetailStatus(NEIGHBOUR)).toBe(200);
  });

  it('holds the row at once when the override command records the verdict, with no gate run', async () => {
    const heldId = await seedServedPair();
    expect(await anonymousDetailStatus(HELD)).toBe(200);

    const report: any = await runStudentVisibilityOverride(
      holdArgs('operator_review'),
      devEnv(mongoUrl),
    );
    expect(report.servedNow).toBe(false);

    const row = await ResearchEntity.findById(heldId).lean<any>();
    expect(row.studentVisibilityOverrideTier).toBe('operator_review');
    expect(row.studentVisibilityTier).toBe('operator_review');
    expect(await anonymousDetailStatus(HELD)).toBe(404);
  });

  it('keeps the row held when a later write resets the stored tier above the hold', async () => {
    const heldId = await seedServedPair();
    await runStudentVisibilityOverride(holdArgs('suppressed'), devEnv(mongoUrl));
    await resetStoredTierAsARematerializeWould(heldId);

    expect(await anonymousDetailStatus(HELD)).toBe(404);
    expect(await affiliatedSlugsOfNeighbour()).toEqual([]);

    await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: [String(heldId)],
    });
    const regated = await ResearchEntity.findById(heldId).lean<any>();
    expect(regated.studentVisibilityTier).toBe('suppressed');
    expect(await anonymousDetailStatus(HELD)).toBe(404);
  });

  it('does not serve a program whose hold was recorded after the stored tier was decided', async () => {
    const programId = new mongoose.Types.ObjectId();
    await mongoose.connection.db!.collection('fellowships').insertOne({
      _id: programId,
      title: 'Quasar Summer Research Fellowship',
      archived: false,
      studentVisibilityTier: 'student_ready',
    });
    await expect(readFellowship(String(programId))).resolves.toBeTruthy();

    await mongoose.connection
      .db!.collection('fellowships')
      .updateOne({ _id: programId }, { $set: { studentVisibilityOverrideTier: 'suppressed' } });

    await expect(readFellowship(String(programId))).rejects.toThrow('Fellowship not found');
    expect(await readFellowships([String(programId)])).toEqual([]);
  });
});
