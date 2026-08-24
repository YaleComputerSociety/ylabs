/**
 * DB writer for the Fellowship -> ResearchEntity projection (issue #1381).
 *
 * Consumes the pure projection from `fellowshipResearchEntityProjection.ts` and
 * upserts a first-class `ResearchEntity` (typed `RA_PROGRAM`/`FELLOWSHIP_PROGRAM`)
 * plus its application-access `Signal`s, keyed on a stable projected slug so
 * re-runs update rather than duplicate. A fellowship that is no longer
 * `student_ready` (or no longer projectable) has its previously-projected home
 * suppressed so it drops out of the public `/research` corpus.
 */
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { Fellowship } from '../models/fellowship';
import { upsertSignal } from './signalService';
import { recomputeBrowseRankForEntities } from './researchEntityBrowseRankService';
import { syncEntity } from './meiliSyncService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { STUDENT_VISIBILITY_VERSION } from './studentVisibilityTier';
import {
  buildFellowshipResearchEntityProjection,
  projectedProgramSlug,
  type FellowshipProjectionInput,
  type ProjectedProgramEntityType,
} from './fellowshipResearchEntityProjection';

const PROJECTED_PROGRAM_SLUG_REGEX = /^program-/;

export interface ProjectFellowshipOptions {
  dryRun?: boolean;
  sync?: boolean;
}

export interface ProjectFellowshipResult {
  slug?: string;
  entityId?: string;
  entityType?: ProjectedProgramEntityType;
  created: boolean;
  updated: boolean;
  suppressed: boolean;
  signalsWritten: number;
  skipped?: string;
}

async function suppressProjectedResearchEntity(
  slug: string,
  reason: string,
  options: ProjectFellowshipOptions,
): Promise<boolean> {
  const existing: any = await ResearchEntity.findOne({ slug })
    .select('_id studentVisibilityTier')
    .lean();
  if (!existing?._id || existing.studentVisibilityTier === 'suppressed') return false;
  if (options.dryRun) return true;
  await ResearchEntity.updateOne(
    { _id: existing._id },
    {
      $set: {
        studentVisibilityTier: 'suppressed',
        studentVisibilityComputedTier: 'suppressed',
        studentVisibilityOverrideTier: 'suppressed',
        studentVisibilityReasons: [reason],
        studentVisibilityVersion: STUDENT_VISIBILITY_VERSION,
      },
    },
  );
  if (options.sync !== false) {
    const fresh = await ResearchEntity.findById(existing._id).lean();
    if (fresh) await syncEntity('researchEntity', fresh);
  }
  return true;
}

/**
 * Project one Fellowship record into its ResearchEntity home. Idempotent:
 * re-running converges on a single home keyed by the projected slug.
 */
export async function projectFellowshipToResearchEntity(
  fellowship: FellowshipProjectionInput,
  options: ProjectFellowshipOptions = {},
): Promise<ProjectFellowshipResult> {
  const empty: ProjectFellowshipResult = {
    created: false,
    updated: false,
    suppressed: false,
    signalsWritten: 0,
  };
  const projection = buildFellowshipResearchEntityProjection(fellowship);

  if ('skip' in projection) {
    if (projection.slug) {
      const suppressed = await suppressProjectedResearchEntity(
        projection.slug,
        'projected_fellowship_no_longer_student_ready',
        options,
      );
      return { ...empty, slug: projection.slug, suppressed, skipped: projection.skip };
    }
    return { ...empty, skipped: projection.skip };
  }

  const now = new Date();
  const set: Record<string, unknown> = { ...projection.set, lastObservedAt: now };
  const existing: any = await ResearchEntity.findOne({ slug: projection.slug })
    .select('_id')
    .lean();

  if (options.dryRun) {
    return {
      ...empty,
      slug: projection.slug,
      entityId: existing?._id ? serializedDocumentId(existing._id) : undefined,
      entityType: projection.entityType,
      created: !existing,
      updated: Boolean(existing),
      signalsWritten: projection.accessSignals.length,
    };
  }

  let entityId: string;
  let created = false;
  if (existing?._id) {
    entityId = serializedDocumentId(existing._id) || '';
    await ResearchEntity.updateOne({ _id: existing._id }, { $set: set });
  } else {
    const _id = new mongoose.Types.ObjectId();
    await ResearchEntity.create([{ _id, slug: projection.slug, ...set }]);
    entityId = _id.toHexString();
    created = true;
  }

  for (const signal of projection.accessSignals) {
    await upsertSignal({
      researchEntityId: entityId,
      type: signal.type,
      confidence: 'HIGH',
      confidenceScore: 0.9,
      observedAt: now,
      excerpt: signal.excerpt,
      sourceName: fellowship.sourceName || 'fellowship-research-projection',
      sourceUrl: projection.sourceUrl,
      derivationKey: `fellowship-projection:${signal.type}`,
    });
  }

  await recomputeBrowseRankForEntities([entityId], { sync: false });
  if (options.sync !== false) {
    const fresh = await ResearchEntity.findById(entityId).lean();
    if (fresh) await syncEntity('researchEntity', fresh);
  }

  return {
    slug: projection.slug,
    entityId,
    entityType: projection.entityType,
    created,
    updated: !created,
    suppressed: false,
    signalsWritten: projection.accessSignals.length,
  };
}

export interface ProjectAllFellowshipsOptions {
  apply?: boolean;
  limit?: number;
}

export interface ProjectAllFellowshipsReport {
  mode: 'apply' | 'dry-run';
  considered: number;
  created: number;
  updated: number;
  suppressedStale: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  byEntityType: Record<string, number>;
  errors: number;
  sample: Array<{ slug?: string; entityType?: string; action: string }>;
}

/**
 * Project every `student_ready` Fellowship into the research corpus, then
 * reconcile: any previously-projected program home whose backing fellowship is
 * no longer `student_ready` is suppressed so the corpus does not serve stale
 * program duplicates.
 */
export async function projectAllStudentReadyFellowships(
  options: ProjectAllFellowshipsOptions = {},
): Promise<ProjectAllFellowshipsReport> {
  const apply = options.apply === true;
  const dryRun = !apply;
  const report: ProjectAllFellowshipsReport = {
    mode: apply ? 'apply' : 'dry-run',
    considered: 0,
    created: 0,
    updated: 0,
    suppressedStale: 0,
    skipped: 0,
    skippedByReason: {},
    byEntityType: {},
    errors: 0,
    sample: [],
  };

  const query = Fellowship.find({
    archived: { $ne: true },
    studentVisibilityTier: 'student_ready',
  }).lean();
  if (typeof options.limit === 'number' && options.limit > 0) query.limit(options.limit);
  const fellowships = (await query) as any[];

  const projectedSlugs = new Set<string>();
  for (const fellowship of fellowships) {
    report.considered += 1;
    const slug = projectedProgramSlug(fellowship);
    if (slug) projectedSlugs.add(slug);
    try {
      const result = await projectFellowshipToResearchEntity(fellowship, { dryRun });
      if (result.skipped) {
        report.skipped += 1;
        report.skippedByReason[result.skipped] =
          (report.skippedByReason[result.skipped] || 0) + 1;
      } else if (result.created) {
        report.created += 1;
      } else if (result.updated) {
        report.updated += 1;
      }
      if (result.entityType) {
        report.byEntityType[result.entityType] =
          (report.byEntityType[result.entityType] || 0) + 1;
      }
      if (report.sample.length < 20 && (result.created || result.updated)) {
        report.sample.push({
          slug: result.slug,
          entityType: result.entityType,
          action: result.created ? 'created' : 'updated',
        });
      }
    } catch (error) {
      report.errors += 1;
      console.error(
        'projectAllStudentReadyFellowships: projection failed:',
        sanitizeLogValue({ slug, error }),
      );
    }
  }

  const staleProjected = (await ResearchEntity.find({
    slug: PROJECTED_PROGRAM_SLUG_REGEX,
    studentVisibilityTier: 'student_ready',
  })
    .select('slug')
    .lean()) as any[];
  for (const entity of staleProjected) {
    const slug = String(entity.slug || '');
    if (!slug || projectedSlugs.has(slug)) continue;
    try {
      const suppressed = await suppressProjectedResearchEntity(
        slug,
        'projected_fellowship_no_longer_student_ready',
        { dryRun },
      );
      if (suppressed) report.suppressedStale += 1;
    } catch (error) {
      report.errors += 1;
      console.error(
        'projectAllStudentReadyFellowships: suppression failed:',
        sanitizeLogValue({ slug, error }),
      );
    }
  }

  return report;
}
