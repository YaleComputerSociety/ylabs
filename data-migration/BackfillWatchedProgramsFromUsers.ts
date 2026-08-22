/**
 * Backfill the canonical `research_plans` collection with PROGRAM targets from
 * the legacy embedded `User.favFellowships` / `User.savedProgramTracking` store.
 *
 * Program watching now serves from the first-class `ResearchPlan` collection
 * keyed on `accountId` + `target { kind: 'PROGRAM', id }`, matching the saved
 * research-home cutover. This one-time backfill lifts each account's already
 * watched programs and their note/applied tracking into canonical rows so
 * nothing watched before the cutover is lost. It is additive: it inserts only
 * account+program pairs that do not already have a canonical PROGRAM plan.
 *
 * The legacy `savedProgramTracking.stage` of `applied` maps to the canonical
 * stage `APPLIED`; every other value maps to `SAVED`. The tracking `note` maps
 * to `privateNotes`. Legacy optimistic-concurrency `revision` is not migrated.
 *
 * Dry-run by default. APPLY requires:
 * --apply --limit=N --confirm-v4-migration
 *
 * Run from data-migration/:
 * npx tsx BackfillWatchedProgramsFromUsers.ts
 * (add --apply --limit=1 --confirm-v4-migration to write)
 */
import fs from 'fs';
import mongoose from '../server/node_modules/mongoose';
import { RESEARCH_PLAN_SCHEMA_VERSION } from '../server/src/models/researchPlan';
import {
  assertV4MigrationApplyAllowed,
  buildV4MigrationOutput,
  connectForMigration,
  disconnectForMigration,
  parseMigrationOptions,
} from './v4MigrationUtils';

const TITLE = 'Backfill watched programs from users';
const SCRIPT_NAME = 'model-refactor:backfill-watched-programs';
const MAX_PROGRAM_NOTE_LENGTH = 8_000;

const toHexString = (value: unknown): string | null => {
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString().toLowerCase();
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{24}$/i.test(text) ? text : null;
};

const planKey = (accountId: string, targetId: string): string => `${accountId}:${targetId}`;

interface WatchedProgramRow {
  netid: string;
  accountId: string;
  targetId: string;
  stage: 'SAVED' | 'APPLIED';
  privateNotes: string;
}

async function run(): Promise<void> {
  const options = parseMigrationOptions(process.argv.slice(2));
  await connectForMigration(TITLE, options);
  assertV4MigrationApplyAllowed(options, SCRIPT_NAME);

  const observedAt = new Date();
  const usersCollection = mongoose.connection.collection('users');
  const accountsCollection = mongoose.connection.collection('accounts');
  const researchPlansCollection = mongoose.connection.collection('research_plans');

  const accountIdByNetid = new Map<string, string>();
  for await (const account of accountsCollection.find({}, { projection: { netid: 1 } })) {
    const netid = typeof account.netid === 'string' ? account.netid.trim().toLowerCase() : '';
    if (netid) accountIdByNetid.set(netid, String(account._id));
  }

  const existingPlanKeys = new Set<string>();
  for await (const plan of researchPlansCollection.find(
    { 'target.kind': 'PROGRAM' },
    { projection: { accountId: 1, 'target.id': 1 } },
  )) {
    const accountId = toHexString(plan.accountId);
    const targetId = toHexString(plan.target?.id);
    if (accountId && targetId) existingPlanKeys.add(planKey(accountId, targetId));
  }

  const rows: WatchedProgramRow[] = [];
  const seenRowKeys = new Set<string>();
  let usersScanned = 0;
  let accountsUnresolved = 0;
  let alreadyCanonical = 0;

  for await (const user of usersCollection.find(
    { favFellowships: { $exists: true, $ne: [] } },
    { projection: { netid: 1, favFellowships: 1, savedProgramTracking: 1 } },
  )) {
    usersScanned += 1;
    const netid = typeof user.netid === 'string' ? user.netid.trim() : '';
    if (!netid) continue;
    const accountId = accountIdByNetid.get(netid.toLowerCase()) ?? null;
    if (!accountId) {
      accountsUnresolved += 1;
      continue;
    }
    const tracking =
      user.savedProgramTracking && typeof user.savedProgramTracking === 'object'
        ? (user.savedProgramTracking as Record<string, { note?: unknown; stage?: unknown }>)
        : {};
    const favFellowships = Array.isArray(user.favFellowships) ? user.favFellowships : [];
    for (const value of favFellowships) {
      const targetId = toHexString(value);
      if (!targetId) continue;
      const key = planKey(accountId, targetId);
      if (existingPlanKeys.has(key)) {
        alreadyCanonical += 1;
        continue;
      }
      if (seenRowKeys.has(key)) continue;
      seenRowKeys.add(key);
      const record = tracking[targetId] || {};
      const note = typeof record.note === 'string' ? record.note.slice(0, MAX_PROGRAM_NOTE_LENGTH) : '';
      const stage = record.stage === 'applied' ? 'APPLIED' : 'SAVED';
      rows.push({ netid, accountId, targetId, stage, privateNotes: note });
    }
  }

  const rowsToInsert =
    options.apply && Number.isFinite(options.limit) ? rows.slice(0, options.limit as number) : rows;

  let inserted = 0;
  let collisions = 0;

  if (options.apply) {
    for (const row of rowsToInsert) {
      try {
        await researchPlansCollection.insertOne({
          schemaVersion: RESEARCH_PLAN_SCHEMA_VERSION.currentVersion,
          accountId: new mongoose.Types.ObjectId(row.accountId),
          target: { kind: 'PROGRAM', id: new mongoose.Types.ObjectId(row.targetId) },
          stage: row.stage,
          privateNotes: row.privateNotes,
          checklist: [],
          deadlines: [],
          exportPreferences: {
            includePrivateNotes: false,
            includeChecklist: false,
            includeDeadlines: false,
          },
          archived: false,
          createdAt: observedAt,
          updatedAt: observedAt,
        });
        inserted += 1;
      } catch (error: any) {
        if (error?.code === 11000) {
          collisions += 1;
          continue;
        }
        throw error;
      }
    }
  }

  const result = {
    scriptName: SCRIPT_NAME,
    applied: options.apply,
    usersScanned,
    accountsUnresolved,
    alreadyCanonical,
    plannedRows: rows.length,
    inserted,
    collisions,
    rowSamples: rows.slice(0, 25).map((row) => ({
      netid: row.netid,
      targetId: row.targetId,
      stage: row.stage,
      hasPrivateNotes: row.privateNotes.length > 0,
    })),
  };

  const output = buildV4MigrationOutput(result, {
    db: mongoose.connection.name,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  if (options.output) fs.writeFileSync(options.output, JSON.stringify(output, null, 2));

  await disconnectForMigration();
}

run().catch(async (err) => {
  console.error(err);
  await disconnectForMigration().catch(() => undefined);
  process.exit(1);
});
