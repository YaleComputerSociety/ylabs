import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AdminAuditEvent } from '../../models/adminAuditEvent';
import { Fellowship } from '../../models/fellowship';
import { runStudentVisibilityGate } from '../../services/studentVisibilityGateService';
import { runStudentVisibilityOverride } from '../studentVisibilityOverride';
import { parseStudentVisibilityOverrideArgs } from '../studentVisibilityOverrideCore';

const FUND_ID = new mongoose.Types.ObjectId('000000000000000000006220');
const FUND_KEY = 'student-grants-database:fixture-orrery-research-fellowship';
const HOLD_REASON = 'fixture_program_hold: the synthetic fund is held for a fixture reason';
const RETIRE_REASON = 'redundant_forced_serve: the rules serve this fund without the override';

const servableFund = {
  _id: FUND_ID,
  sourceKey: FUND_KEY,
  sourceName: 'student-grants-database',
  title: 'Fixture Orrery Research Fellowship',
  summary:
    'Funds undergraduates conducting independent summer research with a faculty mentor at Yale.',
  programKind: 'FELLOWSHIP_FUNDING',
  studentFacingCategory: 'Research travel funding',
  sourceUrl: 'https://yale.communityforce.com/Funds/FundDetails.aspx?ORRERY',
  applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?ORRERY',
  deadline: new Date('2027-03-24T17:00:00.000Z'),
  undergraduateOnly: true,
  archived: false,
};

const devEnv = (mongoUrl: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  MONGODBURL: mongoUrl,
  SCRAPER_ENV: 'development',
  NODE_ENV: 'development',
  ...extra,
});

const programArgs = (extra: string[]) =>
  parseStudentVisibilityOverrideArgs([
    `--id=${FUND_ID.toHexString()}`,
    '--collection=programs',
    '--actor=fixtureop',
    ...extra,
  ]);

const APPLY = ['--apply', '--confirm-student-visibility-override'];

const fund = () => Fellowship.findById(FUND_ID).lean<any>();
const regate = () =>
  runStudentVisibilityGate({
    collection: 'programs',
    mode: 'apply',
    recordIds: [FUND_ID.toHexString()],
  });

describe('student-visibility:override on a program row (#6220)', () => {
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

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const name of ['fellowships', 'admin_audit_events', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    await db.collection('fellowships').insertOne({ ...servableFund } as any);
    await regate();
  });

  it('plans a program hold on a dry run without writing', async () => {
    const report: any = await runStudentVisibilityOverride(
      programArgs([`--reason=${HOLD_REASON}`, '--tier=suppressed']),
      devEnv(mongoUrl),
    );
    expect(report).toMatchObject({ mode: 'dry-run', collection: 'programs', audited: false });
    expect(report.decision.action).toBe('write');
    expect((await fund()).studentVisibilityOverrideTier).toBeUndefined();
    expect(await AdminAuditEvent.countDocuments()).toBe(0);
  });

  it('sets a program hold with a fellowship audit event and stops serving the row', async () => {
    expect((await fund()).studentVisibilityTier).toBe('student_ready');
    const report: any = await runStudentVisibilityOverride(
      programArgs([`--reason=${HOLD_REASON}`, '--tier=suppressed', ...APPLY]),
      devEnv(mongoUrl, { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }),
    );
    expect(report).toMatchObject({ audited: true, servedNow: false, searchIndexSynced: null });
    expect(await fund()).toMatchObject({
      studentVisibilityTier: 'suppressed',
      studentVisibilityOverrideTier: 'suppressed',
      studentVisibilitySuppressionReason: HOLD_REASON,
      studentVisibilityReviewedByNetid: 'fixtureop',
    });
    expect(await AdminAuditEvent.findOne().lean<any>()).toMatchObject({
      actorNetid: 'fixtureop',
      action: 'fellowship.visibility_override.set',
      targetType: 'fellowship',
      targetId: FUND_ID.toHexString(),
      summary: { note: HOLD_REASON, status: 'set' },
      metadata: { collection: 'programs', before: { overrideTier: null } },
    });
  });

  it('retires a forced-serve override and its backing observation with an audit event, leaving the tier to the rules', async () => {
    await mongoose.connection
      .db!.collection('fellowships')
      .updateOne(
        { _id: FUND_ID },
        {
          $set: {
            studentVisibilityOverrideTier: 'student_ready',
            'fieldProvenance.studentVisibilityOverrideTier': { sourceName: 'manual-admin-edit' },
          },
        },
      );
    await mongoose.connection.db!.collection('observations').insertOne({
      entityType: 'fellowship',
      entityKey: FUND_KEY,
      field: 'studentVisibilityOverrideTier',
      value: 'student_ready',
      sourceName: 'manual-admin-edit',
      observedAt: new Date('2026-06-11T00:00:00Z'),
      superseded: false,
    });

    const dryRun: any = await runStudentVisibilityOverride(
      programArgs([`--reason=${RETIRE_REASON}`, '--clear']),
      devEnv(mongoUrl),
    );
    expect(dryRun).toMatchObject({ audited: false, backingObservationsRetired: 1 });
    expect((await fund()).studentVisibilityOverrideTier).toBe('student_ready');

    const report: any = await runStudentVisibilityOverride(
      programArgs([`--reason=${RETIRE_REASON}`, '--clear', ...APPLY]),
      devEnv(mongoUrl, { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }),
    );
    expect(report).toMatchObject({ audited: true, backingObservationsRetired: 1, servedNow: true });
    expect(await fund()).not.toHaveProperty('studentVisibilityOverrideTier');
    expect((await fund()).fieldProvenance ?? {}).not.toHaveProperty(
      'studentVisibilityOverrideTier',
    );
    expect(
      await mongoose.connection
        .db!.collection('observations')
        .countDocuments({ entityKey: FUND_KEY, superseded: { $ne: true } }),
    ).toBe(0);
    expect(await AdminAuditEvent.findOne().lean<any>()).toMatchObject({
      action: 'fellowship.visibility_override.clear',
      targetType: 'fellowship',
      summary: { note: RETIRE_REASON, status: 'clear' },
      metadata: { backingObservationsRetired: 1, after: { overrideTier: null } },
    });

    await regate();
    expect((await fund()).studentVisibilityTier).toBe('student_ready');

    const again: any = await runStudentVisibilityOverride(
      programArgs([`--reason=${RETIRE_REASON}`, '--clear', ...APPLY]),
      devEnv(mongoUrl, { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }),
    );
    expect(again.decision).toMatchObject({ action: 'skip', reason: 'no_override_to_clear' });
    expect(await AdminAuditEvent.countDocuments()).toBe(1);
  });

  it('reports live override observations a clear leaves behind when the stored override is already gone', async () => {
    await mongoose.connection.db!.collection('observations').insertOne({
      entityType: 'fellowship',
      entityId: FUND_ID,
      field: 'studentVisibilityOverrideTier',
      value: 'student_ready',
      sourceName: 'manual-admin-edit',
      observedAt: new Date('2026-06-11T00:00:00Z'),
      superseded: false,
    });

    const report: any = await runStudentVisibilityOverride(
      programArgs([`--reason=${RETIRE_REASON}`, '--clear']),
      devEnv(mongoUrl),
    );
    expect(report.decision).toMatchObject({ action: 'skip', reason: 'no_override_to_clear' });
    expect(report).toMatchObject({ liveBackingObservations: 1, backingObservationsRetired: null });
    expect(report.next).toContain('1 live override observation');
  });

  it('refuses a program override with no reason before it reaches the row', () => {
    expect(() => programArgs(['--clear'])).toThrow('--reason is required');
    expect(() => programArgs(['--reason=  ', '--tier=suppressed'])).toThrow();
  });
});
