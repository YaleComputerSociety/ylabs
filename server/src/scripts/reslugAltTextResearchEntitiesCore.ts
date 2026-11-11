import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import {
  DEFAULT_DEPT_CONFIGS,
  rosterDeptConfigsForResearchEntitySlug,
  rosterResearchEntitySlugForPersonName,
  rosterResearchEntitySlugPrefix,
  type DeptConfig,
} from '../scrapers/sources/departmentRosterScraper';
import { isPhotoSceneDescription, normalizeName } from '../scrapers/utils/scraperHelpers';
import {
  applyResearchEntityReslug,
  firstFreeResearchEntitySlug,
  keylessResearchEntityObservationsOf,
  resyncRenamedResearchEntities,
  type ResearchEntityReslugPlan,
} from './researchEntityReslugCore';

export const SCRIPT_NAME = 'research-entity:reslug-alt-text-slugs';
export const ALT_TEXT_RESLUG_REASON = 'alt_text_slug';

export interface AltTextReslugArgs {
  apply: boolean;
  confirm: boolean;
}

export function parseAltTextReslugArgs(argv: string[]): AltTextReslugArgs {
  const args: AltTextReslugArgs = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--') continue;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--confirm') args.confirm = true;
    else if (arg === '--dry-run') args.apply = false;
    else {
      throw new Error(
        `Unknown ${SCRIPT_NAME} argument: ${arg}. It takes no identifier: it matches every live roster row whose slug is photo alt text.`,
      );
    }
  }
  return args;
}

export function assertAltTextReslugApplyAllowed(args: AltTextReslugArgs, dbLabel: string): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(`${SCRIPT_NAME} --apply also needs --confirm, because it renames served rows.`);
  }
  if (!/\/development$/i.test(dbLabel)) {
    throw new Error(
      `${SCRIPT_NAME} apply is restricted to a Development database (got ${dbLabel}); Beta and Production receive the renamed rows by promotion.`,
    );
  }
}

const RESEARCH_ENTITY_NAME_SUFFIX = /(?:^|\s+)(?:faculty\s+research|lab)$/i;

/** The person a roster row is named for, read off the row's own name, never off its slug. */
export function rosterPersonNameOfResearchEntity(name: unknown): string {
  const raw = typeof name === 'string' ? name.trim() : '';
  return normalizeName(raw.replace(RESEARCH_ENTITY_NAME_SUFFIX, ''));
}

/** The alt text a roster slug was minted from, read back from the slug's name part. */
export function altTextSlugDept(
  slug: string,
  configs: readonly DeptConfig[] = DEFAULT_DEPT_CONFIGS,
): DeptConfig | null {
  for (const dept of rosterDeptConfigsForResearchEntitySlug(slug, configs)) {
    const nameSlug = slug.slice(rosterResearchEntitySlugPrefix(dept).length);
    if (isPhotoSceneDescription(nameSlug.replace(/-/g, ' '))) return dept;
  }
  return null;
}

export interface AltTextReslugCounts {
  liveRosterRows: number;
  rowsWithAltTextSlug: number;
  servedRowsWithAltTextSlug: number;
  rowsWithNoUsableName: number;
  rowsToRename: number;
  rowsTakingANumberedSlug: number;
  observationsToStamp: number;
}

export interface AltTextReslugReport extends AltTextReslugCounts {
  apply: boolean;
  rowsRenamed?: number;
  observationsStamped?: number;
  searchDocumentsResynced?: number;
  searchIndexSyncFailures?: number;
  searchIndexSyncDeferred?: number;
}

interface RosterRow {
  _id: mongoose.Types.ObjectId;
  slug: string;
  name?: string;
  studentVisibilityTier?: string;
}

export async function planAltTextReslugs(
  configs: readonly DeptConfig[] = DEFAULT_DEPT_CONFIGS,
): Promise<{ plans: ResearchEntityReslugPlan[]; counts: AltTextReslugCounts }> {
  const rows = await ResearchEntity.find({ slug: /^dept-/, archived: { $ne: true } })
    .select('_id slug name studentVisibilityTier')
    .sort({ _id: 1 })
    .lean<RosterRow[]>();
  const counts: AltTextReslugCounts = {
    liveRosterRows: rows.length,
    rowsWithAltTextSlug: 0,
    servedRowsWithAltTextSlug: 0,
    rowsWithNoUsableName: 0,
    rowsToRename: 0,
    rowsTakingANumberedSlug: 0,
    observationsToStamp: 0,
  };
  const plans: ResearchEntityReslugPlan[] = [];
  const reserved = new Set<string>();
  for (const row of rows) {
    const dept = altTextSlugDept(row.slug, configs);
    if (!dept) continue;
    counts.rowsWithAltTextSlug += 1;
    if (row.studentVisibilityTier === 'student_ready') counts.servedRowsWithAltTextSlug += 1;
    const personName = rosterPersonNameOfResearchEntity(row.name);
    const base = personName ? rosterResearchEntitySlugForPersonName(personName, dept) : '';
    if (!base || base === row.slug || altTextSlugDept(base, [dept])) {
      counts.rowsWithNoUsableName += 1;
      continue;
    }
    const toSlug = await firstFreeResearchEntitySlug(base, reserved, SCRIPT_NAME);
    reserved.add(toSlug);
    if (toSlug !== base) counts.rowsTakingANumberedSlug += 1;
    counts.rowsToRename += 1;
    counts.observationsToStamp += await Observation.countDocuments(
      keylessResearchEntityObservationsOf(row.slug),
    );
    plans.push({ entityId: row._id, fromSlug: row.slug, toSlug });
  }
  return { plans, counts };
}

export async function runAltTextReslug(args: {
  apply: boolean;
  now?: Date;
  configs?: readonly DeptConfig[];
}): Promise<AltTextReslugReport> {
  const { plans, counts } = await planAltTextReslugs(args.configs);
  if (!args.apply) return { apply: false, ...counts };

  const redirect = { reason: ALT_TEXT_RESLUG_REASON, renamedAt: args.now ?? new Date() };
  let observationsStamped = 0;
  let rowsRenamed = 0;
  const renamedIds: mongoose.Types.ObjectId[] = [];
  for (const plan of plans) {
    const outcome = await applyResearchEntityReslug(plan, redirect);
    observationsStamped += outcome.stamped;
    rowsRenamed += outcome.renamed;
    if (outcome.renamed > 0) renamedIds.push(plan.entityId);
  }
  const index = await resyncRenamedResearchEntities(renamedIds);
  return {
    apply: true,
    ...counts,
    rowsRenamed,
    observationsStamped,
    searchDocumentsResynced: index.resynced,
    searchIndexSyncFailures: index.indexSyncFailures,
    ...(index.indexSyncDeferred ? { searchIndexSyncDeferred: index.indexSyncDeferred } : {}),
  };
}
