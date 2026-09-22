/**
 * observations:retire-deploy-host-citations - retires observations cited to a host a
 * hosting platform assigns to a deploy target rather than to a published page (#2805).
 *
 *   yarn --cwd server observations:retire-deploy-host-citations
 *   yarn --cwd server observations:retire-deploy-host-citations --apply \
 *     --confirm-retire-deploy-host-citations --output="$TMPDIR/deploy-host-citations.json"
 *
 * Dry-run by default. Uses `retireObservations`, never a delete, so the removal is
 * itself evidenced on the row it removes.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { retireObservations } from '../scrapers/observationStore';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { EPHEMERAL_DEPLOY_HOST_DOMAINS } from '../utils/urlSafety';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  CONFIRM_RETIRE_DEPLOY_HOST_CITATIONS,
  DEPLOY_HOST_CITATION_ROLLBACK_REASON,
  type DeployHostCitationPlan,
  planDeployHostCitationRetirement,
} from './retireEphemeralDeployHostCitationsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface RetireDeployHostCitationsOptions {
  dryRun: boolean;
  confirmed: boolean;
  limit?: number;
  output?: string;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return Number(value);
}

export function parseRetireDeployHostCitationsArgs(
  argv: string[],
): RetireDeployHostCitationsOptions {
  const options: RetireDeployHostCitationsOptions = { dryRun: true, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    else if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_RETIRE_DEPLOY_HOST_CITATIONS) options.confirmed = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export interface RetireDeployHostCitationsResult {
  mode: 'dry-run' | 'apply';
  plan: Omit<DeployHostCitationPlan, 'active' | 'supersededOnly'> & {
    activeToRetire: number;
    supersededToStamp: number;
  };
  retiredActive: number;
  stampedSuperseded: number;
  citationsRemaining: { activeBefore: number; activeAfter: number; inReadScopeAfter: number };
  sampleRows: Array<{ sourceName: string; field: string; entityType: string; host: string }>;
}

/**
 * Selected by a Mongo-side host prefilter and then re-judged in full by
 * `planDeployHostCitationRetirement`. The prefilter is a cheap superset: it must not be
 * the thing that decides, or the repair and the ingest guard would answer to two
 * different rules.
 */
function deployHostPrefilter(): Record<string, unknown> {
  const escaped = EPHEMERAL_DEPLOY_HOST_DOMAINS.map((domain) => domain.replace(/\./g, '\\.'));
  return { sourceUrl: { $regex: `(${escaped.join('|')})`, $options: 'i' } };
}

async function countCitations(extra: Record<string, unknown>): Promise<number> {
  return Observation.countDocuments({ ...deployHostPrefilter(), ...extra });
}

export async function runRetireDeployHostCitations(options: {
  dryRun: boolean;
  limit?: number;
}): Promise<RetireDeployHostCitationsResult> {
  const docs = (await Observation.find(deployHostPrefilter())
    .select('_id sourceName sourceUrl field entityType entityKey superseded rollback')
    .lean()) as Array<Record<string, any>>;

  const plan = planDeployHostCitationRetirement(
    docs.map((doc) => ({
      id: String(doc._id),
      sourceName: String(doc.sourceName),
      sourceUrl: doc.sourceUrl,
      field: String(doc.field),
      entityType: String(doc.entityType),
      entityKey: doc.entityKey,
      superseded: doc.superseded === true,
      alreadyRolledBack: Boolean(doc.rollback?.rolledBackAt),
    })),
  );

  const active = options.limit ? plan.active.slice(0, options.limit) : plan.active;
  const supersededOnly = options.limit
    ? plan.supersededOnly.slice(0, options.limit)
    : plan.supersededOnly;

  const activeBefore = await countCitations({ superseded: { $ne: true } });

  let retiredActive = 0;
  let stampedSuperseded = 0;
  if (!options.dryRun) {
    if (active.length > 0) {
      const result = await retireObservations(
        { _id: { $in: active.map((row) => new mongoose.Types.ObjectId(row.id)) } },
        DEPLOY_HOST_CITATION_ROLLBACK_REASON,
      );
      retiredActive = result.retired;
    }
    if (supersededOnly.length > 0) {
      const stamped = await Observation.updateMany(
        {
          _id: { $in: supersededOnly.map((row) => new mongoose.Types.ObjectId(row.id)) },
          'rollback.rolledBackAt': { $exists: false },
        },
        {
          $set: {
            rollback: {
              rolledBackAt: new Date(),
              reason: DEPLOY_HOST_CITATION_ROLLBACK_REASON,
            },
          },
        },
      );
      stampedSuperseded = stamped.modifiedCount || 0;
    }
  }

  const activeAfter = options.dryRun
    ? activeBefore
    : await countCitations({ superseded: { $ne: true } });
  const inReadScopeAfter = await countCitations({ 'rollback.rolledBackAt': { $exists: false } });

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    plan: {
      scanned: plan.scanned,
      activeToRetire: active.length,
      supersededToStamp: supersededOnly.length,
      alreadyRetired: plan.alreadyRetired,
      byHost: plan.byHost,
      byLaneField: plan.byLaneField,
    },
    retiredActive,
    stampedSuperseded,
    citationsRemaining: { activeBefore, activeAfter, inReadScopeAfter },
    sampleRows: [...active, ...supersededOnly].slice(0, 10).map((row) => ({
      sourceName: row.sourceName,
      field: row.field,
      entityType: row.entityType,
      host: new URL(String(row.sourceUrl)).hostname.toLowerCase(),
    })),
  };
}

async function main(): Promise<void> {
  const options = parseRetireDeployHostCitationsArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirmed) {
    throw new Error(`Apply mode requires ${CONFIRM_RETIRE_DEPLOY_HOST_CITATIONS}.`);
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'retire deploy-host observation citations',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runRetireDeployHostCitations({
      dryRun: options.dryRun,
      limit: options.limit,
    });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        JSON.stringify(
          { generatedAt: new Date().toISOString(), environment: guard.environment, result },
          null,
          2,
        ),
      );
      console.log(`Saved report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
