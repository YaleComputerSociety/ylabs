import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AdminAuditEvent } from '../../models/adminAuditEvent';
import { ResearchEntity } from '../../models/researchEntity';
import { getResearchGroupDetail } from '../../services/researchGroupService';
import { runStudentVisibilityGate } from '../../services/studentVisibilityGateService';
import { runStudentVisibilityOverride } from '../studentVisibilityOverride';
import { parseStudentVisibilityOverrideArgs } from '../studentVisibilityOverrideCore';

const UMBRELLA = 'orrery-umbrella-lab';
const MEMBER = 'orrery-member-lab';
const REASON = 'umbrella_center_subunits_discoverable: its member labs serve under their own names';

const DESCRIPTION =
  'The lab studies how orbital resonances shape the long-term stability of planetary systems, pairing numerical integration of thousands of synthetic systems with observational constraints from transit surveys.';

const devEnv = (mongoUrl: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  MONGODBURL: mongoUrl,
  SCRAPER_ENV: 'development',
  NODE_ENV: 'development',
  ...extra,
});

const argsFor = (extra: string[]) =>
  parseStudentVisibilityOverrideArgs([
    `--slug=${UMBRELLA}`,
    `--reason=${REASON}`,
    '--actor=fixtureop',
    ...extra,
  ]);

describe('student-visibility:override hides one row and its affiliated link (#5618)', () => {
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
      researchAreas: ['Planetary dynamics'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      shortDescription: 'Studies how orbital resonances shape planetary system stability.',
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
      displayName: `Orrery ${surname}`,
      firstName: 'Orrery',
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

  const seed = async () => {
    const umbrellaId = await seedLab(UMBRELLA, 'Orrery Umbrella Lab', 'umbrellafix');
    const memberId = await seedLab(MEMBER, 'Orrery Member Lab', 'memberfix');
    await mongoose.connection.db!.collection('research_entity_relationships').insertOne({
      sourceResearchEntityId: umbrellaId,
      targetResearchEntityId: memberId,
      relationshipType: 'AFFILIATED_LAB',
      label: 'Member lab',
      evidenceStrength: 'MODERATE',
      confidence: 0.8,
      archived: false,
    });
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    return umbrellaId;
  };

  const affiliatedSlugs = async () =>
    ((await getResearchGroupDetail(MEMBER)) as any)?.affiliatedResearchEntities?.map(
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
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  it('plans without writing on a dry run', async () => {
    await seed();
    const report: any = await runStudentVisibilityOverride(
      argsFor(['--tier=suppressed']),
      devEnv(mongoUrl),
    );
    expect(report.mode).toBe('dry-run');
    expect(report.decision.action).toBe('write');
    expect(report.audited).toBe(false);
    const row = await ResearchEntity.findOne({ slug: UMBRELLA }).lean<any>();
    expect(row.studentVisibilityOverrideTier).toBeUndefined();
    expect(await AdminAuditEvent.countDocuments()).toBe(0);
  });

  it('refuses a Development write without the opt-in', async () => {
    await seed();
    await expect(
      runStudentVisibilityOverride(
        argsFor(['--tier=suppressed', '--apply', '--confirm-student-visibility-override']),
        devEnv(mongoUrl),
      ),
    ).rejects.toThrow('ALLOW_NON_PROD_SCRAPER_WRITES');
  });

  it('writes the verdict with an audit event, and the gate stops serving the row and its link', async () => {
    const umbrellaId = await seed();
    expect(await getResearchGroupDetail(UMBRELLA)).toBeTruthy();
    expect(await affiliatedSlugs()).toEqual([UMBRELLA]);

    const report: any = await runStudentVisibilityOverride(
      argsFor(['--tier=suppressed', '--apply', '--confirm-student-visibility-override']),
      devEnv(mongoUrl, { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }),
    );
    expect(report.audited).toBe(true);
    const audit = await AdminAuditEvent.findOne().lean<any>();
    expect(audit).toMatchObject({
      actorNetid: 'fixtureop',
      action: 'research_entity.visibility_override.set',
      targetType: 'research_entity',
      targetId: String(umbrellaId),
      summary: { note: REASON, status: 'set' },
      metadata: {
        before: { tier: 'student_ready', overrideTier: null },
        after: { overrideTier: 'suppressed', suppressionReason: REASON },
      },
    });

    await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: [String(umbrellaId)],
    });
    const row = await ResearchEntity.findOne({ slug: UMBRELLA }).lean<any>();
    expect(row.studentVisibilityTier).toBe('suppressed');
    expect(row.manuallyLockedFields ?? []).toEqual([]);
    expect(await getResearchGroupDetail(UMBRELLA)).toBeFalsy();
    expect(await getResearchGroupDetail(MEMBER)).toBeTruthy();
    expect(await affiliatedSlugs()).toEqual([]);

    const again: any = await runStudentVisibilityOverride(
      argsFor(['--tier=suppressed', '--apply', '--confirm-student-visibility-override']),
      devEnv(mongoUrl, { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }),
    );
    expect(again.decision).toMatchObject({ action: 'skip', reason: 'already_recorded' });
    expect(await AdminAuditEvent.countDocuments()).toBe(1);
  });

  it('adds a reason to an existing reasonless hold, records the reviewer, and keeps the tier (#5856)', async () => {
    const umbrellaId = await seed();
    await mongoose.connection.db!.collection('research_entities').updateOne(
      { _id: umbrellaId },
      {
        $set: {
          studentVisibilityTier: 'suppressed',
          studentVisibilityOverrideTier: 'suppressed',
        },
      },
    );

    const before = await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect(before.counts.holdsWithoutRecordedReason).toBe(1);
    expect(await getResearchGroupDetail(UMBRELLA)).toBeFalsy();

    const report: any = await runStudentVisibilityOverride(
      argsFor(['--tier=suppressed', '--apply', '--confirm-student-visibility-override']),
      devEnv(mongoUrl, { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }),
    );

    expect(report.decision.set).not.toHaveProperty('studentVisibilityTier');
    const row = await ResearchEntity.findById(umbrellaId).lean<any>();
    expect(row).toMatchObject({
      studentVisibilityTier: 'suppressed',
      studentVisibilityOverrideTier: 'suppressed',
      studentVisibilitySuppressionReason: REASON,
      studentVisibilityReviewedByNetid: 'fixtureop',
    });
    expect(row.studentVisibilityReviewedAt).toBeInstanceOf(Date);
    expect(await AdminAuditEvent.countDocuments({ targetId: String(umbrellaId) })).toBe(1);

    const after = await runStudentVisibilityGate({ collection: 'research', mode: 'dry-run' });
    expect(after.counts.holdsWithoutRecordedReason).toBe(0);
    const again: any = await runStudentVisibilityOverride(
      argsFor(['--tier=suppressed', '--apply', '--confirm-student-visibility-override']),
      devEnv(mongoUrl, { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }),
    );
    expect(again.decision).toMatchObject({ action: 'skip', reason: 'already_recorded' });
  });

  it('refuses a hold whose reason is empty before it reaches the row', () => {
    expect(() =>
      parseStudentVisibilityOverrideArgs([
        `--slug=${UMBRELLA}`,
        '--tier=operator_review',
        '--reason=  ',
        '--actor=fixtureop',
      ]),
    ).toThrow();
  });
});
