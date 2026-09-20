import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { RESEARCH_ENTITY_SEARCH_INDEX_NAME } from '../services/researchEntitySearchIndexService';
import { getMeiliIndex } from '../utils/meiliClient';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { hasLiveSourceCitation } from '../services/sourceLinkHealth';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  planDeadCitationRetirement,
  summarizeDeadCitationRefusals,
  type DeadCitationCandidate,
} from './retireDeadCitationResearchEntitiesCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:retire-dead-citation-entities';
const DEFAULT_MAX_APPLY = 100;

interface Args {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, confirm: false, maxApply: DEFAULT_MAX_APPLY };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--confirm-dead-citation-retirement') args.confirm = true;
    else if (arg === '--max-apply') args.maxApply = Number(argv[++index]);
    else if (arg.startsWith('--max-apply='))
      args.maxApply = Number(arg.slice('--max-apply='.length));
    else if (arg === '--output') args.output = argv[++index];
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!Number.isSafeInteger(args.maxApply) || args.maxApply < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return args;
}

export function citationsOf(entity: { sourceUrls?: unknown; fieldProvenance?: unknown }): string[] {
  const stored = Array.isArray(entity.sourceUrls)
    ? entity.sourceUrls.filter((url): url is string => typeof url === 'string' && url.trim() !== '')
    : [];
  const provenance =
    entity.fieldProvenance && typeof entity.fieldProvenance === 'object'
      ? Object.values(entity.fieldProvenance as Record<string, unknown>)
          .map((record) =>
            record && typeof record === 'object'
              ? (record as { sourceUrl?: unknown }).sourceUrl
              : undefined,
          )
          .filter((url): url is string => typeof url === 'string' && url.trim() !== '')
      : [];
  return [...new Set([...stored, ...provenance])];
}

async function deleteSearchDocuments(
  ids: string[],
  getIndex: typeof getMeiliIndex,
): Promise<{ requested: number; deleted: boolean; error?: string }> {
  if (ids.length === 0) return { requested: 0, deleted: false };
  try {
    const index = await getIndex(RESEARCH_ENTITY_SEARCH_INDEX_NAME);
    await index.deleteDocuments(ids);
    return { requested: ids.length, deleted: true };
  } catch (error) {
    return { requested: ids.length, deleted: false, error: String(sanitizeLogValue(error)) };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (args.apply && !args.confirm) {
    throw new Error(`${SCRIPT_NAME} apply requires --confirm-dead-citation-retirement`);
  }

  await initializeConnections();

  const rows = await ResearchEntity.find({ archived: { $ne: true } })
    .select(
      '_id archived studentVisibilityTier sourceUrls fieldProvenance sourceLinkHealth websiteUrl',
    )
    .lean();

  // The candidate set is whatever the served predicate already calls citation-dead,
  // so this lane can never archive a row the gate still considers backed.
  const candidates: DeadCitationCandidate[] = rows
    .filter((row) => !hasLiveSourceCitation(row as Record<string, unknown>))
    .flatMap((row) => {
      const id = serializedDocumentId(row._id);
      if (!id) return [];
      return [
        {
          id,
          tier:
            typeof row.studentVisibilityTier === 'string' ? row.studentVisibilityTier : undefined,
          archived: row.archived === true,
          citations: citationsOf(row as { sourceUrls?: unknown; fieldProvenance?: unknown }),
          websiteUrl: typeof row.websiteUrl === 'string' ? row.websiteUrl : null,
          sourceLinkHealth: row.sourceLinkHealth,
        },
      ];
    });

  const plan = planDeadCitationRetirement(candidates);
  const toApply = plan.toArchive.slice(0, args.maxApply);

  let archived = 0;
  let search: { requested: number; deleted: boolean; error?: string } = {
    requested: 0,
    deleted: false,
  };

  if (args.apply && toApply.length > 0) {
    const objectIds = toApply
      .map((entry) => entry.id)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const result = await ResearchEntity.updateMany(
      { _id: { $in: objectIds }, archived: { $ne: true } },
      { $set: { archived: true } },
    );
    archived = result.modifiedCount ?? 0;
    search = await deleteSearchDocuments(
      toApply.map((entry) => entry.id),
      getMeiliIndex,
    );
  }

  const report = {
    script: SCRIPT_NAME,
    mode: args.apply ? 'apply' : 'dry-run',
    nonArchivedRows: rows.length,
    citationDeadCandidates: candidates.length,
    plannedToArchive: plan.toArchive.length,
    plannedWithWebsiteUrl: plan.toArchive.filter((entry) => entry.hadWebsiteUrl).length,
    refusedByReason: summarizeDeadCitationRefusals(plan.refused),
    appliedLimit: args.maxApply,
    archived,
    search: {
      ...search,
      rebuildGuidance:
        'If search documents were not deleted, rebuild with meili:rebuild-research-entities --clear --confirm-meili-rebuild.',
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (args.output) {
    const outputPath = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`Saved report to ${outputPath}`);
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
