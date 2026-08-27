import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntityRedirect } from '../models/researchEntityRedirect';
import { User } from '../models/user';
import { Researcher } from '../models/researcher';
import { recordCanonicalAlias } from '../services/canonicalAliasService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  dedupePlannedAliases,
  planCanonicalAliasesFromRedirects,
  planCanonicalAliasesFromResearcherTombstones,
  planCanonicalAliasesFromUserTombstones,
  redirectRowFromDoc,
  researcherTombstoneRowFromDoc,
  userTombstoneRowFromDoc,
  type PlannedCanonicalAlias,
} from './backfillCanonicalAliasesCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Args {
  apply: boolean;
  confirm: boolean;
}

function parseArgs(argv: string[]): Args {
  return {
    apply: argv.includes('--apply'),
    confirm: argv.includes('--confirm-canonical-alias-backfill'),
  };
}

async function loadPlannedAliases(): Promise<PlannedCanonicalAlias[]> {
  const redirects = (await ResearchEntityRedirect.find({})
    .select('mergedSlug mergedEntityId canonicalEntityId')
    .lean()) as Record<string, unknown>[];
  const userTombstones = (await User.find({ dedupedIntoUserId: { $ne: null } })
    .select('dedupedIntoUserId netid email orcid')
    .lean()) as Record<string, unknown>[];
  const researcherTombstones = (await Researcher.find({ dedupedIntoResearcherId: { $ne: null } })
    .select('dedupedIntoResearcherId identifiers.orcid')
    .lean()) as Record<string, unknown>[];

  const planned = [
    ...planCanonicalAliasesFromRedirects(redirects.map(redirectRowFromDoc)),
    ...planCanonicalAliasesFromUserTombstones(userTombstones.map(userTombstoneRowFromDoc)),
    ...planCanonicalAliasesFromResearcherTombstones(
      researcherTombstones.map(researcherTombstoneRowFromDoc),
    ),
  ];
  return dedupePlannedAliases(planned);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'data:backfill-canonical-aliases',
    mongoUrl: process.env.MONGODBURL,
  });
  if (args.apply) {
    if (!args.confirm) {
      throw new Error(
        'data:backfill-canonical-aliases apply requires --confirm-canonical-alias-backfill.',
      );
    }
    if (!guard.dbLabel.toLowerCase().endsWith('/development')) {
      throw new Error(
        `data:backfill-canonical-aliases apply is restricted to a Development DB (target: ${guard.dbLabel}).`,
      );
    }
  }

  await initializeConnections();
  const planned = await loadPlannedAliases();

  const byType: Record<string, number> = {};
  for (const alias of planned) byType[alias.type] = (byType[alias.type] ?? 0) + 1;

  let applied = 0;
  if (args.apply) {
    for (const alias of planned) {
      const ok = await recordCanonicalAlias(alias);
      if (ok) applied += 1;
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    plannedTotal: planned.length,
    plannedByType: byType,
    applied,
  };
  console.log(JSON.stringify(report, null, 2));
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to backfill canonical aliases:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
