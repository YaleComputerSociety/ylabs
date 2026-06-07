/**
 * Backfill the identified-faculty-lead "ways in" for existing research homes.
 *
 * The access materializer now derives an evidence-based EXPLORATORY_CONTACT
 * pathway + FACULTY_PI contact route + REACH_OUT_PLAUSIBLE signal for research
 * homes that have an attached faculty lead and an official (non-grant) source
 * page but no other derived ways-in. New scrape/materialize runs pick this up
 * automatically; this script applies it to the already-materialized corpus so
 * historical entities are not left with `missing_action_evidence`.
 *
 * Dry-run-first. Apply mode requires an explicit `--limit` and
 * `--confirm-faculty-ways-in`, and is blocked against production unless
 * CONFIRM_PROD_SCRAPE=true.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { EntryPathway } from '../models/entryPathway';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import {
  materializeAccessForResearchGroup,
  officialNonGrantSourceUrl,
} from '../scrapers/accessMaterializer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ELIGIBLE_ENTITY_TYPES = [
  'LAB',
  'CENTER',
  'INSTITUTE',
  'FACULTY_RESEARCH_AREA',
  'FACULTY_PROJECT',
  'DIGITAL_HUMANITIES_PROJECT',
  'COLLECTIONS_INITIATIVE',
  'ARCHIVE_OR_MUSEUM_PROJECT',
  'INITIATIVE',
  'GROUP',
  'INDIVIDUAL_RESEARCH',
];

const LEAD_ROLES = ['pi', 'co-pi', 'director', 'co-director'];
const ORGANIZATIONAL_ENTITY_TYPES = new Set(['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY']);
const FORMALIZATION_ONLY_PATHWAY_TYPES = ['COURSE_CREDIT', 'SENIOR_THESIS', 'FELLOWSHIP_FUNDED_PROJECT'];

export interface FacultyWaysInBackfillCliOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirmFacultyWaysIn: boolean;
  output?: string;
}

export function parseFacultyWaysInBackfillArgs(argv: string[]): FacultyWaysInBackfillCliOptions {
  const options: FacultyWaysInBackfillCliOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirmFacultyWaysIn: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm-faculty-ways-in') {
      options.confirmFacultyWaysIn = true;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseLimit(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parseLimit(argv[i + 1]);
      options.explicitLimit = true;
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

export interface FacultyWaysInCandidate {
  researchEntityId: string;
  slug?: string;
  name?: string;
  entityType?: string;
  officialUrl: string;
}

/**
 * Find active research homes that have an attached faculty lead and an official
 * non-grant source page but no active non-formalization entry pathway, and are
 * not flagged as duplicates by the visibility gate.
 */
export async function findFacultyWaysInCandidates(limit?: number): Promise<FacultyWaysInCandidate[]> {
  const entities = await ResearchEntity.find(
    { archived: { $ne: true }, entityType: { $in: ELIGIBLE_ENTITY_TYPES } },
    {
      _id: 1,
      slug: 1,
      name: 1,
      entityType: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      studentVisibilityReasons: 1,
    },
  ).lean();

  const candidates: FacultyWaysInCandidate[] = [];
  for (const entity of entities as any[]) {
    const reasons: string[] = Array.isArray(entity.studentVisibilityReasons)
      ? entity.studentVisibilityReasons
      : [];
    if (reasons.includes('duplicate_risk') || reasons.includes('exact_url_duplicate_risk')) continue;

    const officialUrl = officialNonGrantSourceUrl(entity);
    if (!officialUrl) continue;

    const lead = await ResearchGroupMember.findOne({
      researchEntityId: entity._id,
      role: { $in: LEAD_ROLES },
      isCurrentMember: { $ne: false },
      $or: [{ userId: { $exists: true, $ne: null } }, { facultyMemberId: { $exists: true, $ne: null } }],
    })
      .select('_id')
      .lean();
    // Faculty/lab homes need a named lead; organizational homes
    // (centers/institutes/initiatives) qualify for a center-level ways-in without one.
    const isOrganizational = ORGANIZATIONAL_ENTITY_TYPES.has(
      String(entity.entityType || '').toUpperCase(),
    );
    if (!lead && !isOrganizational) continue;

    const hasPathway = await EntryPathway.countDocuments({
      researchEntityId: entity._id,
      archived: false,
      pathwayType: { $nin: FORMALIZATION_ONLY_PATHWAY_TYPES },
      sourceUrls: { $elemMatch: { $regex: '^https?://', $options: 'i' } },
    });
    if (hasPathway > 0) continue;

    candidates.push({
      researchEntityId: String(entity._id),
      slug: entity.slug,
      name: entity.name,
      entityType: entity.entityType,
      officialUrl,
    });
    if (limit && candidates.length >= limit) break;
  }
  return candidates;
}

export interface FacultyWaysInBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  pathwaysCreated: number;
  accessSignalsCreated: number;
  contactRoutesCreated: number;
  entitiesWithNewWaysIn: number;
  errors: number;
  samples: FacultyWaysInCandidate[];
}

export async function runFacultyWaysInBackfill(options: {
  dryRun: boolean;
  limit?: number;
}): Promise<FacultyWaysInBackfillResult> {
  const candidates = await findFacultyWaysInCandidates(options.limit);
  const result: FacultyWaysInBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: candidates.length,
    pathwaysCreated: 0,
    accessSignalsCreated: 0,
    contactRoutesCreated: 0,
    entitiesWithNewWaysIn: 0,
    errors: 0,
    samples: candidates.slice(0, 20),
  };

  if (options.dryRun) return result;

  for (const candidate of candidates) {
    try {
      const materialized = await materializeAccessForResearchGroup({
        researchEntityId: candidate.researchEntityId,
      });
      if (materialized.errors) result.errors += materialized.errors;
      if (materialized.entryPathways > 0) {
        result.entitiesWithNewWaysIn += 1;
        result.pathwaysCreated += materialized.entryPathways;
        result.accessSignalsCreated += materialized.accessSignals;
        result.contactRoutesCreated += materialized.contactRoutes;
      }
    } catch (error) {
      result.errors += 1;
      console.error(`Faculty ways-in backfill failed for ${candidate.slug || candidate.researchEntityId}:`, error);
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseFacultyWaysInBackfillArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirmFacultyWaysIn) {
    throw new Error('Apply mode requires --confirm-faculty-ways-in.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'faculty-ways-in backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(`Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`);

  await initializeConnections();
  try {
    const result = await runFacultyWaysInBackfill({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun, limit: options.explicitLimit ? options.limit : undefined },
      result,
    };
    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(payload, null, 2));
      console.log(`Saved faculty ways-in backfill report to ${options.output}`);
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
