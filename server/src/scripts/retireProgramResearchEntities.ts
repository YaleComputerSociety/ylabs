import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Fellowship } from '../models/fellowship';
import { Signal } from '../models/signal';
import { deleteFromIndex } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  RETIRED_PROGRAM_ENTITY_TYPE,
  buildRetireProgramResearchEntitiesPlan,
  normalizeFellowshipTitle,
  type ProgramFellowshipMatchKey,
  type ProgramResearchEntityCandidate,
  type RetireProgramResearchEntitiesPlan,
} from './retireProgramResearchEntitiesCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = 'research-entity:retire-program-entities';
const DEFAULT_MAX_APPLY = 100;

export interface RetireProgramResearchEntitiesCliOptions {
  apply: boolean;
  confirmProgramEntityRetirement: boolean;
  maxApply: number;
  output?: string;
}

function parsePositiveInteger(value: string | undefined, optionName: string): number {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

export function parseRetireProgramResearchEntitiesArgs(
  argv: string[],
): RetireProgramResearchEntitiesCliOptions {
  const options: RetireProgramResearchEntitiesCliOptions = {
    apply: false,
    confirmProgramEntityRetirement: false,
    maxApply: DEFAULT_MAX_APPLY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--confirm-program-entity-retirement') {
      options.confirmProgramEntityRetirement = true;
      continue;
    }
    if (arg.startsWith('--confirm-program-entity-retirement=')) {
      throw new Error('--confirm-program-entity-retirement does not accept a value');
    }
    if (arg.startsWith('--max-apply=')) {
      options.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length), '--max-apply');
      continue;
    }
    if (arg === '--max-apply') {
      options.maxApply = parsePositiveInteger(argv[index + 1], '--max-apply');
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }

  return options;
}

export function assertRetireProgramResearchEntitiesApplyAllowed({
  apply,
  confirmProgramEntityRetirement,
  maxApply,
  plannedArchives,
}: {
  apply: boolean;
  confirmProgramEntityRetirement: boolean;
  maxApply: number;
  plannedArchives: number;
}): void {
  if (!apply) return;
  if (!confirmProgramEntityRetirement) {
    throw new Error(
      `--confirm-program-entity-retirement is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
  if (plannedArchives > maxApply) {
    throw new Error(
      `Apply would archive ${plannedArchives} PROGRAM research entities, above --max-apply (${maxApply}).`,
    );
  }
}

async function loadProgramResearchEntityCandidates(): Promise<ProgramResearchEntityCandidate[]> {
  const programEntities = (await ResearchEntity.find({
    entityType: RETIRED_PROGRAM_ENTITY_TYPE as never,
  })
    .select('_id slug name archived')
    .lean()) as Array<{ _id: unknown; slug?: string; name?: string; archived?: boolean }>;

  const fellowships = (await Fellowship.find({})
    .select('_id title sourceKey')
    .lean()) as Array<{ _id: unknown; title?: string; sourceKey?: string }>;

  const fellowshipSourceKeys = new Set<string>();
  const fellowshipTitles = new Set<string>();
  for (const fellowship of fellowships) {
    if (fellowship.sourceKey) fellowshipSourceKeys.add(fellowship.sourceKey);
    const normalizedTitle = normalizeFellowshipTitle(fellowship.title);
    if (normalizedTitle) fellowshipTitles.add(normalizedTitle);
  }

  const candidates: ProgramResearchEntityCandidate[] = [];
  for (const entity of programEntities) {
    const id = String(entity._id);
    const slug = typeof entity.slug === 'string' ? entity.slug : undefined;
    const name = typeof entity.name === 'string' ? entity.name : undefined;
    let fellowshipMatchKey: ProgramFellowshipMatchKey | undefined;
    if (slug && fellowshipSourceKeys.has(slug)) {
      fellowshipMatchKey = 'sourceKey';
    } else if (fellowshipTitles.has(normalizeFellowshipTitle(name || slug))) {
      fellowshipMatchKey = 'title';
    }
    const signalCount = await Signal.countDocuments({ researchEntityId: entity._id });
    candidates.push({
      id,
      ...(slug ? { slug } : {}),
      ...(name ? { name } : {}),
      archived: entity.archived === true,
      ...(fellowshipMatchKey ? { fellowshipMatchKey } : {}),
      signalCount,
    });
  }

  return candidates;
}

export interface RetireProgramResearchEntitiesResult {
  mode: 'dry-run' | 'apply';
  plan: RetireProgramResearchEntitiesPlan;
  archivedResearchEntities: number;
  searchDocumentsRemoved: number;
}

export async function retireProgramResearchEntities(options: {
  apply: boolean;
}): Promise<RetireProgramResearchEntitiesResult> {
  const candidates = await loadProgramResearchEntityCandidates();
  const plan = buildRetireProgramResearchEntitiesPlan({ candidates });

  let archivedResearchEntities = 0;
  let searchDocumentsRemoved = 0;

  if (options.apply && plan.toArchive.length > 0) {
    const objectIds = plan.toArchive
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const result = await ResearchEntity.updateMany(
      { _id: { $in: objectIds } },
      { $set: { archived: true } },
    );
    archivedResearchEntities = result.modifiedCount || 0;
    for (const id of plan.toArchive) {
      await deleteFromIndex('researchEntity', id);
      searchDocumentsRemoved += 1;
    }
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    plan,
    archivedResearchEntities,
    searchDocumentsRemoved,
  };
}

async function main(): Promise<void> {
  const options = parseRetireProgramResearchEntitiesArgs(process.argv.slice(2));
  assertRetireProgramResearchEntitiesApplyAllowed({
    apply: options.apply,
    confirmProgramEntityRetirement: options.confirmProgramEntityRetirement,
    maxApply: options.maxApply,
    plannedArchives: 0,
  });

  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${options.apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const candidates = await loadProgramResearchEntityCandidates();
    const plan = buildRetireProgramResearchEntitiesPlan({ candidates });
    assertRetireProgramResearchEntitiesApplyAllowed({
      apply: options.apply,
      confirmProgramEntityRetirement: options.confirmProgramEntityRetirement,
      maxApply: options.maxApply,
      plannedArchives: plan.toArchiveCount,
    });

    const result = await retireProgramResearchEntities({ apply: options.apply });

    const report = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options,
      mode: result.mode,
      scanned: result.plan.scanned,
      alreadyArchived: result.plan.alreadyArchived,
      toArchiveCount: result.plan.toArchiveCount,
      withFellowship: result.plan.withFellowship,
      withoutFellowship: result.plan.withoutFellowship,
      archivedResearchEntities: result.archivedResearchEntities,
      searchDocumentsRemoved: result.searchDocumentsRemoved,
      rows: result.plan.rows,
    };

    console.log(JSON.stringify(report, null, 2));
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`Saved report to ${safeOutput}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('Failed to retire PROGRAM research entities:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
