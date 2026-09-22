/**
 * observations:materialize-profile-page-joined-users - re-runs the `user` materializer
 * over the keys the official-profile-page join reaches (#2325).
 *
 * The join fires only while a scrape ingests `user` observations, so evidence already in
 * the corpus is never re-offered to it. This visits stored evidence instead, through the
 * ordinary `materializeEntity('user', { entityKey })` path, so every guard on that path
 * still applies: this is not a new write path.
 *
 * Two passes. The first is a dry run over every key whose evidence cites a Yale person
 * page, and it reads the engine's own `identityJoin` report to decide the apply set. The
 * second writes only the keys the engine said the page join resolved.
 *
 *   yarn --cwd server observations:materialize-profile-page-joined-users
 *   yarn --cwd server observations:materialize-profile-page-joined-users --apply \
 *     --confirm-materialize-profile-page-joined-users
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import {
  materializeEntity,
  officialUserProfileUrlsFromObservations,
} from '../scrapers/entityMaterializer';
import { runWithBoundedConcurrency } from '../scrapers/utils/boundedConcurrency';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  PROFILE_PAGE_JOIN_IDENTITY,
  classifyProfilePageJoinOutcome,
  parseMaterializeProfilePageJoinedUsersArgs,
  summarizeProfilePageJoinRows,
  type ProfilePageJoinRow,
} from './materializeProfilePageJoinedUsersCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:materialize-profile-page-joined-users';
const PLANNING_CONCURRENCY = 10;

async function candidateKeys(): Promise<string[]> {
  const observations = (await Observation.find(
    {
      entityType: 'user',
      field: { $in: ['profileUrls', 'profileUrl'] },
      superseded: false,
    },
    { entityKey: 1, field: 1, value: 1 },
  ).lean()) as Array<{ entityKey?: unknown; field?: string; value?: unknown }>;

  const byKey = new Map<string, Array<{ field?: string; value?: unknown }>>();
  for (const observation of observations) {
    const entityKey = typeof observation.entityKey === 'string' ? observation.entityKey.trim() : '';
    if (!entityKey) continue;
    byKey.set(entityKey, [
      ...(byKey.get(entityKey) ?? []),
      { field: observation.field, value: observation.value },
    ]);
  }
  return [...byKey.entries()]
    .filter(([, rows]) => officialUserProfileUrlsFromObservations(rows).length > 0)
    .map(([entityKey]) => entityKey)
    .sort();
}

async function visit(entityKey: string, apply: boolean): Promise<ProfilePageJoinRow> {
  try {
    const result: any = await materializeEntity('user', { entityKey }, { dryRun: !apply });
    return {
      entityKey,
      outcome: classifyProfilePageJoinOutcome(result ?? {}, { apply }),
      identityJoin: result?.identityJoin,
      skippedReason: result?.skipped,
      fieldsWritten: result?.fieldsWritten ?? 0,
      researcherId: result?.entityId,
    };
  } catch (error) {
    return {
      entityKey,
      outcome: 'error',
      fieldsWritten: 0,
      error: sanitizeLogValue((error as Error)?.message ?? String(error)),
    };
  }
}

async function main(): Promise<void> {
  const args = parseMaterializeProfilePageJoinedUsersArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();

  const candidates = await candidateKeys();
  const visiting = args.limit ? candidates.slice(0, args.limit) : candidates;

  // The planning pass is read-only, so it fans out. The apply pass below stays serial:
  // several keys can resolve to one researcher, and two workers saving the same mongoose
  // document race on its version and one of them throws.
  const planned: ProfilePageJoinRow[] = [];
  await runWithBoundedConcurrency(visiting, PLANNING_CONCURRENCY, async (entityKey) => {
    planned.push(await visit(entityKey, false));
  });
  planned.sort((left, right) => left.entityKey.localeCompare(right.entityKey));
  const joinedKeys = planned
    .filter((row) => row.identityJoin === PROFILE_PAGE_JOIN_IDENTITY)
    .map((row) => row.entityKey);

  const applied: ProfilePageJoinRow[] = [];
  if (args.apply) {
    for (const entityKey of joinedKeys) {
      applied.push(await visit(entityKey, true));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: process.env.SCRAPER_ENV || 'development',
    mode: args.apply ? 'apply' : 'dry-run',
    candidates: candidates.length,
    visited: visiting.length,
    planned: summarizeProfilePageJoinRows(planned),
    ...(args.apply ? { applied: summarizeProfilePageJoinRows(applied) } : {}),
  };

  if (args.output) {
    const outputPath = resolveSafeJsonReportOutputPath(args.output);
    fs.writeFileSync(outputPath, JSON.stringify({ ...report, planned, applied }, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
