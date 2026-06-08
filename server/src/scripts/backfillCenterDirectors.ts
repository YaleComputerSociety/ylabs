/**
 * Backfill the named director for existing organizational research homes.
 *
 * Centers / institutes / initiatives / core facilities have no single PI, so
 * their scraped rosters tag everyone `core-faculty` and the public "Principal
 * Investigator" panel renders empty. The `center-director-llm` source now reads
 * each home's official site + leadership pages and emits an entity-level
 * inferred-director observation, which the materializer resolves to a unique
 * Yale User and promotes to a `director` member. New scrape/materialize runs
 * pick this up automatically; this script applies it to the already-materialized
 * corpus so historical organizational homes are not left lead-less.
 *
 * Dry-run-first. Dry-run lists eligible organizational homes (no LLM calls).
 * Apply mode runs the LLM extraction + director promotion and requires an
 * explicit `--limit` and `--confirm-center-directors`, and is blocked against
 * production unless CONFIRM_PROD_SCRAPE=true.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { materializeInferredDirectorMembership } from '../scrapers/entityMaterializer';
import {
  CenterDirectorLLMExtractor,
  type CandidateCenter,
} from '../scrapers/sources/centerDirectorLLMExtractor';
import type { MaterializerObservationLike } from '../scrapers/entityMaterializer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SOURCE_NAME = 'center-director-llm';
const ORG_ENTITY_TYPES = ['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY'];
const LEAD_ROLES = ['pi', 'co-pi', 'director', 'co-director'];
const DEFAULT_OBSERVATION_CONFIDENCE = 0.6;

export interface CenterDirectorsBackfillCliOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirmCenterDirectors: boolean;
  only: string[];
  output?: string;
}

export function parseCenterDirectorsBackfillArgs(argv: string[]): CenterDirectorsBackfillCliOptions {
  const options: CenterDirectorsBackfillCliOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirmCenterDirectors: false,
    only: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm-center-directors') {
      options.confirmCenterDirectors = true;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseLimit(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parseLimit(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg.startsWith('--only=')) {
      options.only = splitOnly(arg.slice('--only='.length));
    } else if (arg === '--only') {
      options.only = splitOnly(argv[i + 1]);
      i += 1;
    } else if (arg === '--output') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--output requires a path');
      options.output = next;
      i += 1;
    } else if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length).trim();
      if (!value || value.startsWith('--')) throw new Error('--output requires a path');
      options.output = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parseLimit(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--limit must be a positive integer');
  return parsed;
}

function splitOnly(value: string | undefined): string[] {
  if (!value || value.startsWith('--')) throw new Error('--only requires a comma-separated value');
  return value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Organizational homes with an official website but no current lead member.
 * `--only` (slug / name / id) narrows the set for targeted reruns.
 */
export async function findCenterDirectorCandidates(
  only: string[],
  limit?: number,
): Promise<CandidateCenter[]> {
  const onlyObjectIds = only
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));
  const identityFilter = only.length
    ? {
        $or: [
          ...(onlyObjectIds.length ? [{ _id: { $in: onlyObjectIds } }] : []),
          { slug: { $in: only } },
          { name: { $in: only } },
        ],
      }
    : {};

  const docs = await ResearchEntity.find(
    {
      $and: [
        { entityType: { $in: ORG_ENTITY_TYPES } },
        { archived: { $ne: true } },
        { websiteUrl: /^https?:\/\//i },
        identityFilter,
      ],
    },
    { _id: 1, slug: 1, name: 1, websiteUrl: 1 },
  ).lean();

  const withLead = await ResearchGroupMember.distinct('researchEntityId', {
    researchEntityId: { $in: (docs as any[]).map((doc) => doc._id) },
    role: { $in: LEAD_ROLES },
    isCurrentMember: { $ne: false },
  });
  const withLeadSet = new Set(withLead.map((id: any) => String(id)));

  const candidates: CandidateCenter[] = [];
  for (const doc of docs as any[]) {
    if (withLeadSet.has(String(doc._id))) continue;
    candidates.push({
      _id: String(doc._id),
      slug: doc.slug,
      name: doc.name,
      websiteUrl: doc.websiteUrl,
    });
    if (limit && candidates.length >= limit) break;
  }
  return candidates;
}

export interface CenterDirectorsBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  directorsExtracted: number;
  directorsResolved: number;
  membersPromoted: number;
  duplicatesRemoved: number;
  unresolved: number;
  errors: number;
  samples: Array<{
    slug?: string;
    name: string;
    director?: string;
    sourceUrl?: string;
    outcome?: string;
  }>;
}

/** Map the extractor's ObservationInput[] onto the materializer's shape. */
function toMaterializerObservations(
  observations: { field: string; value: unknown; sourceUrl?: string; confidenceOverride?: number }[],
  observedAt: Date,
): MaterializerObservationLike[] {
  return observations.map((obs) => ({
    field: obs.field,
    value: obs.value,
    sourceName: SOURCE_NAME,
    sourceUrl: obs.sourceUrl ?? null,
    observedAt,
    confidence: obs.confidenceOverride ?? DEFAULT_OBSERVATION_CONFIDENCE,
  }));
}

export async function runCenterDirectorsBackfill(options: {
  dryRun: boolean;
  limit?: number;
  only?: string[];
  extractor?: CenterDirectorLLMExtractor;
  now?: Date;
}): Promise<CenterDirectorsBackfillResult> {
  const candidates = await findCenterDirectorCandidates(options.only || [], options.limit);
  const result: CenterDirectorsBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: candidates.length,
    directorsExtracted: 0,
    directorsResolved: 0,
    membersPromoted: 0,
    duplicatesRemoved: 0,
    unresolved: 0,
    errors: 0,
    samples: [],
  };

  if (options.dryRun) {
    result.samples = candidates.slice(0, 20).map((c) => ({ slug: c.slug, name: c.name }));
    return result;
  }

  const extractor = options.extractor || new CenterDirectorLLMExtractor();
  const observedAt = options.now || new Date();

  for (const candidate of candidates) {
    try {
      const extraction = await extractor.extractDirectorForCenter(candidate, (msg) => console.log(msg));
      if (!extraction) continue;
      result.directorsExtracted += 1;

      const observations = toMaterializerObservations(extraction.observations, observedAt);
      const materialized = await materializeInferredDirectorMembership(
        String(candidate._id),
        observations,
      );
      const outcome = materialized.written
        ? materialized.promoted
          ? 'promoted'
          : 'created'
        : materialized.skipped || 'skipped';
      if (materialized.written) {
        result.directorsResolved += 1;
        result.membersPromoted += 1;
        result.duplicatesRemoved += materialized.removedDuplicates;
      } else {
        result.unresolved += 1;
      }
      if (result.samples.length < 20) {
        result.samples.push({
          slug: candidate.slug,
          name: candidate.name,
          director: extraction.director.name,
          sourceUrl: extraction.sourceUrl,
          outcome,
        });
      }
    } catch (error) {
      result.errors += 1;
      console.error(
        `Center director backfill failed for ${candidate.slug || candidate._id}:`,
        error,
      );
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseCenterDirectorsBackfillArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirmCenterDirectors) {
    throw new Error('Apply mode requires --confirm-center-directors.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'center-directors backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );
  if (apply && !process.env.OPENAI_API_KEY) {
    throw new Error('Apply mode requires OPENAI_API_KEY for director extraction.');
  }

  await initializeConnections();
  try {
    const result = await runCenterDirectorsBackfill({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
      only: options.only,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: {
        dryRun: options.dryRun,
        limit: options.explicitLimit ? options.limit : undefined,
        only: options.only,
      },
      result,
    };
    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(payload, null, 2));
      console.log(`Saved center directors backfill report to ${options.output}`);
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
    console.error(error);
    process.exit(1);
  });
}
