import { MongoClient, type Collection } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RESEARCH_PLAN_RESTORE_WINDOW_MS } from '../../models/researchPlan';
import { PI_DEDUPE_ARCHIVE_REASON } from '../../models/entityArchival';
import {
  EXPIRE_CONFIRM_FLAG,
  assertExpireLegacyArchivedResearchPlansApplyAllowed,
  expireLegacyArchivedResearchPlans,
  parseExpireLegacyArchivedResearchPlansArgs,
  resolveExpireMongoUrl,
} from '../expireLegacyArchivedResearchPlans';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const LONG_AGO = new Date('2026-08-22T00:00:00.000Z');
const RECENT = new Date(NOW.getTime() - 10 * 60 * 1000);
const STAMPED_UNTIL = new Date(NOW.getTime() + 30 * 60 * 1000);

let server: MongoMemoryServer | undefined;
let client: MongoClient | undefined;
let plans: Collection;

describe('expire legacy archived research plans (#4163)', () => {
  beforeAll(async () => {
    server = await MongoMemoryServer.create({ binary: { version: '8.0.12' } });
    client = await MongoClient.connect(server.getUri());
    plans = client.db('expire_legacy_plans_test').collection('research_plans');
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  beforeEach(async () => {
    await plans.deleteMany({});
    await plans.insertMany([
      { key: 'legacy-with-notes', archived: true, privateNotes: 'private', updatedAt: LONG_AGO },
      { key: 'legacy-recent', archived: true, updatedAt: RECENT },
      { key: 'legacy-undated', archived: true },
      { key: 'stamped', archived: true, restorableUntil: STAMPED_UNTIL, updatedAt: RECENT },
      { key: 'active', archived: false, privateNotes: 'kept', updatedAt: LONG_AGO },
      {
        key: 'dedupe-conflict',
        archived: true,
        archivedReason: PI_DEDUPE_ARCHIVE_REASON,
        privateNotes: 'kept',
        updatedAt: LONG_AGO,
      },
    ]);
  });

  const plan = (key: string) => plans.findOne({ key });

  it('counts the legacy archived plans on a dry run and writes nothing', async () => {
    const result = await expireLegacyArchivedResearchPlans(plans, { apply: false, now: NOW });

    expect(result).toMatchObject({
      mode: 'dry-run',
      legacyArchivedBefore: 3,
      legacyArchivedHoldingPrivateNotes: 1,
      legacyArchivedHoldingChecklist: 0,
      restoreWindowAlreadyPassed: 2,
      activePlans: 1,
      stamped: 0,
      legacyArchivedAfter: 3,
    });
    expect((await plan('legacy-with-notes'))?.restorableUntil).toBeUndefined();
  });

  it('gives each legacy archived plan the restore window it would have had, so the TTL index expires it', async () => {
    const result = await expireLegacyArchivedResearchPlans(plans, { apply: true, now: NOW });

    expect(result.stamped).toBe(3);
    expect(result.legacyArchivedAfter).toBe(0);
    expect((await plan('legacy-with-notes'))?.restorableUntil).toEqual(
      new Date(LONG_AGO.getTime() + RESEARCH_PLAN_RESTORE_WINDOW_MS),
    );
    expect((await plan('legacy-recent'))?.restorableUntil).toEqual(
      new Date(RECENT.getTime() + RESEARCH_PLAN_RESTORE_WINDOW_MS),
    );
    expect((await plan('legacy-undated'))?.restorableUntil).toBeInstanceOf(Date);
  });

  it('leaves active plans and plans that already carry a restore window untouched', async () => {
    await expireLegacyArchivedResearchPlans(plans, { apply: true, now: NOW });

    expect((await plan('active'))?.restorableUntil).toBeUndefined();
    expect((await plan('active'))?.privateNotes).toBe('kept');
    expect((await plan('stamped'))?.restorableUntil).toEqual(STAMPED_UNTIL);
  });

  it('leaves a plan a system lane archived untouched, because the student never removed it', async () => {
    await expireLegacyArchivedResearchPlans(plans, { apply: true, now: NOW });

    expect((await plan('dedupe-conflict'))?.restorableUntil).toBeUndefined();
    expect((await plan('dedupe-conflict'))?.privateNotes).toBe('kept');
  });

  it('stamps nothing on a second run', async () => {
    await expireLegacyArchivedResearchPlans(plans, { apply: true, now: NOW });
    const second = await expireLegacyArchivedResearchPlans(plans, { apply: true, now: NOW });

    expect(second.legacyArchivedBefore).toBe(0);
    expect(second.stamped).toBe(0);
  });
});

describe('expire legacy archived research plans arguments', () => {
  it('reads Development and refuses an apply without its confirmation', () => {
    expect(parseExpireLegacyArchivedResearchPlansArgs([])).toEqual({
      environment: 'development',
      apply: false,
      confirm: false,
    });
    expect(() =>
      assertExpireLegacyArchivedResearchPlansApplyAllowed(
        parseExpireLegacyArchivedResearchPlansArgs(['--apply']),
      ),
    ).toThrow(EXPIRE_CONFIRM_FLAG);
    expect(() =>
      assertExpireLegacyArchivedResearchPlansApplyAllowed(
        parseExpireLegacyArchivedResearchPlansArgs(['--apply', EXPIRE_CONFIRM_FLAG]),
      ),
    ).not.toThrow();
    expect(() => parseExpireLegacyArchivedResearchPlansArgs(['--environment=staging'])).toThrow(
      /--environment/,
    );
    expect(() => parseExpireLegacyArchivedResearchPlansArgs(['--force'])).toThrow(/Unknown/);
  });

  it('names the variable it needs when the environment has no database url', () => {
    expect(() => resolveExpireMongoUrl('production', {})).toThrow(/PRODUCTION_MONGODBURL/);
    expect(resolveExpireMongoUrl('development', { MONGODBURL: 'mongodb://fixture/dev' })).toBe(
      'mongodb://fixture/dev',
    );
  });
});
