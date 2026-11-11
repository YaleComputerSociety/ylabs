/**
 * observations:rederive-over-shared-person-websites - re-runs the `user` materializer over
 * the people whose live evidence asserts an over-shared website (#5645).
 *
 * The materializer now ignores a website asserted for too many different people and clears
 * a stored one, but only when it resolves that person. The lane does not reassert these
 * values, so no scrape reaches them again; this visits exactly those identities through the
 * ordinary `materializeEntity('user', ...)` path and writes nothing the engine would not.
 *
 *   yarn --cwd server observations:rederive-over-shared-person-websites --output tmp/plan.json
 *   ALLOW_NON_PROD_SCRAPER_WRITES=true yarn --cwd server observations:rederive-over-shared-person-websites \
 *     --apply --confirm-rederive-over-shared-person-websites --output tmp/apply.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { readOverSharedPersonWebsiteKeys } from '../scrapers/overSharedPersonWebsite';
import { runWithBoundedConcurrency } from '../scrapers/utils/boundedConcurrency';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  condemnedPersonWebsiteRule,
  identifiersAssertingCondemnedWebsites,
  isWebsiteOnlyVisit,
  parseRederiveOverSharedPersonWebsitesArgs,
  scopeWebsiteOnlyPlans,
  uniqueIdentifiers,
  withoutNetidKey,
  summarizeRederiveVisits,
  type CondemnedPersonWebsite,
  type RederiveVisit,
  type UserMaterializeIdentifier,
} from './rederiveOverSharedPersonWebsitesCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'observations:rederive-over-shared-person-websites';
const PLANNING_CONCURRENCY = 10;

async function researchersStoringCondemnedWebsites(isCondemned: CondemnedPersonWebsite) {
  const researchers = await Researcher.find(
    { 'profile.websiteUrl': { $exists: true, $nin: ['', null] } },
    { 'profile.websiteUrl': 1, 'identifiers.netid': 1, archived: 1, updatedAt: 1 },
  ).lean<
    Array<{
      _id: unknown;
      profile?: { websiteUrl?: string };
      identifiers?: { netid?: string };
      archived?: boolean;
      updatedAt?: Date;
    }>
  >();
  return researchers
    .filter((researcher) => isCondemned(researcher.profile?.websiteUrl))
    .map((researcher) => ({
      researcherId: String(researcher._id),
      websiteUrl: researcher.profile?.websiteUrl,
      archived: Boolean(researcher.archived),
      updatedAt: researcher.updatedAt,
      netid: researcher.identifiers?.netid,
    }));
}

async function liveUserIdentifiersOfResearchers(
  rows: ReadonlyArray<{ researcherId: string; netid?: string }>,
): Promise<UserMaterializeIdentifier[]> {
  const netidKeys = rows.flatMap((row) => (row.netid ? [`netid:${row.netid}`] : []));
  const researcherIds = rows.map((row) => new mongoose.Types.ObjectId(row.researcherId));
  const [liveKeys, liveIds] = await Promise.all([
    Observation.distinct('entityKey', {
      entityType: 'user',
      superseded: false,
      entityKey: { $in: netidKeys },
    }),
    Observation.distinct('entityId', {
      entityType: 'user',
      superseded: false,
      entityId: { $in: researcherIds },
    }),
  ]);
  return [
    ...liveKeys.map((entityKey) => ({ entityKey: String(entityKey) })),
    ...liveIds.map((entityId) => ({ entityId: String(entityId) })),
  ];
}

function writePrivateJson(target: string, value: unknown): void {
  fs.writeFileSync(resolveSafeJsonReportOutputPath(target), JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
}

async function visit(
  identifier: UserMaterializeIdentifier,
  apply: boolean,
): Promise<RederiveVisit> {
  try {
    const result: any = await materializeEntity('user', identifier, { dryRun: !apply });
    return {
      identifier,
      researcherId: result?.entityId ? String(result.entityId) : undefined,
      fieldsWritten: result?.fieldsWritten ?? 0,
      ...(Array.isArray(result?.plannedPaths) ? { plannedPaths: result.plannedPaths } : {}),
      ...(result?.skipped ? { skipped: result.skipped } : {}),
    };
  } catch (error) {
    return {
      identifier,
      fieldsWritten: 0,
      error: sanitizeLogValue((error as Error)?.message ?? String(error)),
    };
  }
}

async function main(): Promise<void> {
  const args = parseRederiveOverSharedPersonWebsitesArgs(process.argv.slice(2));
  assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME });
  if (args.apply && process.env.ALLOW_NON_PROD_SCRAPER_WRITES !== 'true') {
    throw new Error(`${SCRIPT_NAME} --apply requires ALLOW_NON_PROD_SCRAPER_WRITES=true.`);
  }
  const outputPath = args.output ? resolveSafeJsonReportOutputPath(args.output) : undefined;

  await connectScriptMongo(String(process.env.MONGODBURL ?? ''));
  const databaseName = mongoose.connection.db?.databaseName;
  if (args.apply && databaseName !== 'Development') {
    throw new Error(`${SCRIPT_NAME} applies to Development only; connected to ${databaseName}.`);
  }

  const overSharedKeys = await readOverSharedPersonWebsiteKeys();
  const isCondemned = condemnedPersonWebsiteRule(args, overSharedKeys);
  const observations = await Observation.find(
    {
      entityType: 'user',
      field: { $in: ['website', 'websiteUrl'] },
      superseded: false,
      'rollback.rolledBackAt': { $exists: false },
    },
    { entityId: 1, entityKey: 1, value: 1 },
  ).lean();
  const storedBefore = await researchersStoringCondemnedWebsites(isCondemned);
  const identifiers = uniqueIdentifiers([
    ...identifiersAssertingCondemnedWebsites(observations, isCondemned),
    ...(await liveUserIdentifiersOfResearchers(storedBefore)),
  ]);
  const visiting = args.limit ? identifiers.slice(0, args.limit) : identifiers;

  const planned: RederiveVisit[] = [];
  await runWithBoundedConcurrency(visiting, PLANNING_CONCURRENCY, async (identifier) => {
    planned.push(await visit(identifier, false));
  });

  const scope = args.websiteOnly
    ? scopeWebsiteOnlyPlans(planned, new Set(storedBefore.map((row) => row.researcherId)))
    : undefined;
  if (scope && args.deferredOutput) {
    writePrivateJson(args.deferredOutput, { deferredResearcherIds: scope.deferredResearcherIds });
  }

  const applied: RederiveVisit[] = [];
  const skippedForDrift: RederiveVisit[] = [];
  if (args.apply && scope) {
    const applySet = new Set(scope.websiteOnlyResearcherIds);
    writePrivateJson(String(args.snapshotOutput), {
      takenAt: new Date().toISOString(),
      databaseName,
      researchers: await Researcher.find({
        _id: { $in: scope.websiteOnlyResearcherIds.map((id) => new mongoose.Types.ObjectId(id)) },
      }).lean(),
    });
    for (const identifier of scope.applyIdentifiers) {
      const replanned = await visit(identifier, false);
      if (
        !replanned.researcherId ||
        !applySet.has(replanned.researcherId) ||
        !isWebsiteOnlyVisit(replanned)
      ) {
        skippedForDrift.push(replanned);
        continue;
      }
      applied.push(await visit(identifier, true));
    }
  } else if (args.apply) {
    for (const identifier of visiting) applied.push(await visit(identifier, true));
  }
  const storedAfter = args.apply
    ? await researchersStoringCondemnedWebsites(isCondemned)
    : undefined;

  const reachedResearchers = new Set(planned.map((row) => row.researcherId).filter(Boolean));
  const report = {
    generatedAt: new Date().toISOString(),
    databaseName,
    mode: args.apply ? 'apply' : 'dry-run',
    rule: args.inadmissible ? 'inadmissible' : 'over-shared',
    overSharedKeys: [...overSharedKeys].sort(),
    identifiers: identifiers.length,
    storedBefore: storedBefore.length,
    storedBeforeNotReached: storedBefore.filter((row) => !reachedResearchers.has(row.researcherId))
      .length,
    planned: summarizeRederiveVisits(planned),
    ...(scope
      ? {
          websiteOnly: {
            researchers: scope.websiteOnlyResearcherIds.length,
            identities: scope.applyIdentifiers.length,
            deferredResearchers: scope.deferredResearcherIds.length,
            scopedPlan: summarizeRederiveVisits(
              planned.filter((row) =>
                scope.applyIdentifiers.some(
                  (identifier) =>
                    identifier.entityId === row.identifier.entityId &&
                    identifier.entityKey === row.identifier.entityKey,
                ),
              ),
            ),
            skippedForDrift: skippedForDrift.length,
          },
        }
      : {}),
    ...(args.apply
      ? { applied: summarizeRederiveVisits(applied), storedAfter: storedAfter?.length }
      : {}),
  };
  if (outputPath) {
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          ...report,
          storedBeforeRows: storedBefore.map(({ netid: _netid, ...row }) => row),
          planned: planned.map(withoutNetidKey),
          applied: applied.map(withoutNetidKey),
        },
        null,
        2,
      ),
    );
  }
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
