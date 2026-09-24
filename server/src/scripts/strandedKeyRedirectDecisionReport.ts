/**
 * Comparison report for the stranded keys whose remedy is
 * `merge_evidence_into_live_home`: each key's stranded values beside the live entity
 * it resolves to, with a recommended redirect / retire / leave-alone (#2405).
 *
 * Read-only unless `--apply` is passed with its confirm flag, in which case the
 * recommendations are executed. The decision itself lives in
 * `strandedKeyRedirectDecisionCore.ts`; this file supplies the facts.
 *
 * Each stranded value is compared as the MATERIALIZER would write it, not raw:
 * `sanitizeProjectedField` is the same transform the projection runs, so raw
 * directory furniture that would be cleaned on the way in ("Lymphoid TissueYSPH
 * ResearcherView 16 Related Publications") is not reported as a conflict it is not.
 *
 * Run:
 *   yarn --cwd server observations:stranded-key-decisions
 *   yarn --cwd server observations:stranded-key-decisions --output=/tmp/2405.json
 *   yarn --cwd server observations:stranded-key-decisions --apply \
 *     --confirm-stranded-key-decisions --limit 25 --output=/tmp/2405-applied.json
 *   yarn --cwd server observations:stranded-key-decisions --apply \
 *     --confirm-stranded-key-decisions --only nsf-pi-jane-roe,ysm-faculty-jane-roe
 *
 * The report always covers the whole population; `--only` and `--limit` bound the
 * write, so an operator can execute exactly the rows they read in a dry run.
 */
import dotenv from 'dotenv';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import {
  materializeEntity,
  sanitizeProjectedField,
  shouldIgnoreObservationForEntityMaterialization,
} from '../scrapers/entityMaterializer';
import { retireObservations } from '../scrapers/observationStore';
import {
  recordResearchEntityMergeTombstone,
  withdrawResearchEntityMergeTombstone,
} from '../services/researchEntityCanonicalTombstone';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { runOrphanObservationKeyAudit } from './orphanObservationKeyAudit';
import { EVIDENCE_MERGE_REMEDY } from './orphanObservationKeyAuditCore';
import {
  comparableStrandedFields,
  decideStrandedKey,
  parseStrandedKeyApplyArgs,
  selectStrandedKeyApplyRows,
  strandedKeyMergeLanded,
  summarizeStrandedKeyDecisions,
  type StrandedFieldComparison,
  type StrandedKeyApplySelection,
  type StrandedKeyDecision,
  type StrandedKeyReason,
  type StrandedKeyTarget,
} from './strandedKeyRedirectDecisionCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export const STRANDED_KEY_REDIRECT_REASON = 'stranded_key_evidence_merge';
export const STRANDED_KEY_RETIRE_REASON = 'stranded_key_retired';

export type StrandedKeyApplyAction =
  | 'redirected'
  | 'redirect_withdrawn_merge_did_not_land'
  | 'retired'
  | 'skipped_no_target_id'
  | 'deferred_target_written_by_a_sibling_key';

interface StrandedKeyApplyOutcome {
  entityKey: string;
  action: StrandedKeyApplyAction;
  redirectsRecorded?: number;
  redirectsWithdrawn?: number;
  observationsRetired?: number;
  fieldsWritten?: number;
  materializedEntityId?: string;
  materializerSkipped?: string;
  errorMessage?: string;
}

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface ReportRow {
  entityKey: string;
  category: string;
  liveObservationCount: number;
  materializationReach: string;
  sourceNames: string[];
  keyPersonName: string;
  targetSlugs: string[];
  targetSlug?: string;
  targetEntityId?: string;
  targetLeadName?: string;
  targetTier?: string;
  decision: StrandedKeyDecision;
  reason: StrandedKeyReason;
  fieldComparisons: StrandedFieldComparison[];
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

// "Yale School of Medicine" and "School of Medicine" are the raw and canonical
// spellings of one org unit, so comparing them verbatim reported a conflict on almost
// every cross-school key. Only the redundant institution prefix is dropped; nothing
// else about the value is touched.
const canonicalizedOrgUnitText = (value: string): string =>
  value.replace(/^yale\s+(?=school|college|graduate)/i, '');

function normalizedForComparison(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(
      value
        .map((entry) => canonicalizedOrgUnitText(textValue(entry)).toLowerCase())
        .filter(Boolean)
        .sort(),
    );
  }
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    return canonicalizedOrgUnitText(textValue(value)).toLowerCase();
  }
  return JSON.stringify(value);
}

const isEmptyValue = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && !value.trim()) ||
  (Array.isArray(value) && value.length === 0);

/**
 * The person a stranded key is about, taken from its `inferredPiUserKey` where the
 * source stated one and otherwise from the key's own slug tail.
 *
 * The resolved researcher is preferred because a slug tail is only a spelling: the
 * decision then compares two RESOLVED names rather than a slug against a name.
 */
async function resolveKeyPersonName(
  entityKey: string,
  inferredPiUserKey: unknown,
): Promise<string> {
  const piKey = textValue(inferredPiUserKey);
  const netid = piKey.startsWith('netid:')
    ? piKey.slice('netid:'.length)
    : piKey.includes('@')
      ? piKey.split('@')[0]
      : '';
  if (netid) {
    const byNetid = await Researcher.findOne({
      $or: [{ netid }, { 'profile.netid': netid }, { primaryEmail: new RegExp(`^${netid}@`, 'i') }],
      archived: { $ne: true },
    })
      .select('displayName')
      .lean();
    const resolved = textValue((byNetid as { displayName?: unknown } | null)?.displayName);
    if (resolved) return resolved;
    return netid.replace(/[._-]+/g, ' ');
  }
  // Only the namespace prefix is stripped, and nothing else. An earlier revision also
  // tried to drop a department segment with a lookahead, which silently ate the GIVEN
  // NAME of every three-segment key: `dept-ysph-emma-x-zang` resolved to "x zang" and
  // was then reported as a different person from "Emma Zang".
  const withoutNamespace = entityKey.replace(
    /^(?:dept-[a-z0-9-]*?-(?=[a-z]+(?:-[a-z]+)+$)|ysm-faculty-|ysm-|yse-|ysph-|bbs-|nih-pi-|nsf-pi-|doe-pi-|faculty-research-area-)/,
    '',
  );
  return withoutNamespace.replace(/-/g, ' ');
}

async function resolveTargetLeadName(entityId: unknown): Promise<string> {
  const lead = await RoleAssignment.findOne({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': entityId,
    role: { $in: LEAD_ROLE_CANONICAL_VALUES },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('personId')
    .lean();
  const personId = (lead as unknown as { personId?: unknown } | null)?.personId;
  if (!personId) return '';
  const person = await Researcher.findById(personId).select('displayName').lean();
  return textValue((person as { displayName?: unknown } | null)?.displayName);
}

export async function buildStrandedKeyDecisionReport(): Promise<{
  generatedAt: string;
  evidenceMergeKeyCount: number;
  summary: Record<string, { keys: number; liveObservations: number }>;
  rows: ReportRow[];
}> {
  const audit = await runOrphanObservationKeyAudit();
  const reviewRows = audit.classifications.filter((row) => row.remedy === EVIDENCE_MERGE_REMEDY);
  const rows: ReportRow[] = [];

  for (const classification of reviewRows) {
    const observations = await Observation.find({
      entityType: 'researchEntity',
      entityKey: classification.entityKey,
      superseded: { $ne: true },
      'rollback.rolledBackAt': { $exists: false },
    })
      .select('field value confidence observedAt')
      .lean();

    // The comparison has to cover every field a redirect WOULD write and no field it
    // would not, so the set comes from the materializer's own intake filter rather than
    // from a second opinion stated here. Without this an implausible
    // `undergradEvidenceQuote` read as DIFFERS and withdrew the key as
    // WOULD_OVERWRITE_SERVED_COPY for a write the materializer drops, and the
    // `undergraduateLogistics*` fields read as FILLS_GAP for evidence that only ever
    // reaches `signals`.
    const materializableObservations = (observations as Record<string, unknown>[]).filter(
      (observation) =>
        !shouldIgnoreObservationForEntityMaterialization('researchEntity', {
          field: observation.field as string | undefined,
          value: observation.value,
        }),
    );

    const strandedByField = new Map<string, unknown>();
    for (const observation of [...materializableObservations].sort(
      (left, right) =>
        Number(right.confidence || 0) - Number(left.confidence || 0) ||
        new Date(String(right.observedAt || 0)).getTime() -
          new Date(String(left.observedAt || 0)).getTime(),
    )) {
      const field = String(observation.field);
      if (!strandedByField.has(field)) strandedByField.set(field, observation.value);
    }

    const targets: StrandedKeyTarget[] = [];
    for (const slug of classification.targetSlugs) {
      const entity = await ResearchEntity.findOne({ slug, archived: { $ne: true } })
        .select('_id slug name entityType kind studentVisibilityTier')
        .lean();
      if (!entity) continue;
      targets.push({
        slug,
        name: (entity as { name?: unknown }).name,
        entityType: (entity as { entityType?: unknown }).entityType,
        kind: (entity as { kind?: unknown }).kind,
        studentVisibilityTier: (entity as { studentVisibilityTier?: unknown })
          .studentVisibilityTier,
        leadName: await resolveTargetLeadName((entity as { _id: unknown })._id),
      });
    }

    const soleTarget = targets.length === 1 ? targets[0] : undefined;
    const targetDoc = soleTarget
      ? await ResearchEntity.findOne({ slug: soleTarget.slug }).lean()
      : null;

    const fieldComparisons: StrandedFieldComparison[] = [];
    for (const field of comparableStrandedFields(strandedByField.keys())) {
      const targetValue = targetDoc ? (targetDoc as Record<string, unknown>)[field] : undefined;
      // Projected exactly as a redirect would write it, so furniture the projection
      // strips is never reported as a disagreement.
      const projected = sanitizeProjectedField(
        'researchEntity',
        field,
        strandedByField.get(field),
        targetValue,
        targetDoc
          ? {
              slug: textValue((targetDoc as Record<string, unknown>).slug),
              name: textValue((targetDoc as Record<string, unknown>).name),
              school: textValue((targetDoc as Record<string, unknown>).school),
              sourceUrls: ((targetDoc as Record<string, unknown>).sourceUrls as string[]) || [],
            }
          : undefined,
      );
      const verdict = isEmptyValue(targetValue)
        ? isEmptyValue(projected)
          ? 'AGREES'
          : 'FILLS_GAP'
        : normalizedForComparison(projected) === normalizedForComparison(targetValue)
          ? 'AGREES'
          : 'DIFFERS';
      fieldComparisons.push({ field, verdict, strandedValue: projected, targetValue });
    }

    const keyPersonName = await resolveKeyPersonName(
      classification.entityKey,
      strandedByField.get('inferredPiUserKey'),
    );
    const decision = decideStrandedKey({
      entityKey: classification.entityKey,
      keyPersonName,
      strandedName: strandedByField.get('name'),
      strandedEntityType: strandedByField.get('entityType'),
      targets,
      fieldComparisons,
    });

    rows.push({
      entityKey: classification.entityKey,
      category: classification.category,
      liveObservationCount: classification.liveObservationCount,
      materializationReach: classification.materializationReach,
      sourceNames: classification.sourceNames,
      keyPersonName,
      targetSlugs: classification.targetSlugs,
      targetSlug: decision.targetSlug,
      targetEntityId: targetDoc ? String((targetDoc as Record<string, unknown>)._id) : undefined,
      targetLeadName: soleTarget ? textValue(soleTarget.leadName) : undefined,
      targetTier: soleTarget ? textValue(soleTarget.studentVisibilityTier) : undefined,
      decision: decision.decision,
      reason: decision.reason,
      fieldComparisons,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    evidenceMergeKeyCount: reviewRows.length,
    summary: summarizeStrandedKeyDecisions(rows),
    rows,
  };
}

/**
 * Executes the recommendations. A `BACKFILL_REDIRECT` row gets a slug-keyed redirect
 * and is then materialized through the real materializer, because the redirect alone
 * only records where the evidence belongs and nothing re-enumerates observations by
 * key afterwards. A `RETIRE_OBSERVATIONS` row is superseded through
 * `retireObservations` rather than deleted, so the evidence stays auditable.
 *
 * Each row verifies through `strandedKeyMergeLanded` that the projection reached the
 * intended canonical and withdraws its own redirect when it did not, and a throw is
 * isolated to its row so an abort partway through cannot leave the rest of the
 * population behind an unbacked redirect.
 */
async function applyStrandedKeyDecisions(
  selection: StrandedKeyApplySelection<ReportRow>,
): Promise<StrandedKeyApplyOutcome[]> {
  const outcomes: StrandedKeyApplyOutcome[] = selection.deferredForSharedTarget.map((row) => ({
    entityKey: row.entityKey,
    action: 'deferred_target_written_by_a_sibling_key' as const,
  }));
  for (const row of selection.selected) {
    if (row.decision === 'RETIRE_OBSERVATIONS') {
      const { retired } = await retireObservations(
        { entityType: 'researchEntity', entityKey: row.entityKey },
        `${STRANDED_KEY_RETIRE_REASON}:${row.reason}`,
      );
      outcomes.push({ entityKey: row.entityKey, action: 'retired', observationsRetired: retired });
      continue;
    }
    if (row.decision !== 'BACKFILL_REDIRECT') continue;
    if (!row.targetEntityId) {
      outcomes.push({ entityKey: row.entityKey, action: 'skipped_no_target_id' });
      continue;
    }
    outcomes.push(await applyOneRedirect(row, row.targetEntityId));
  }
  return outcomes;
}

async function applyOneRedirect(
  row: ReportRow,
  targetEntityId: string,
): Promise<StrandedKeyApplyOutcome> {
  const tombstone = await recordResearchEntityMergeTombstone({
    slug: row.entityKey,
    canonicalEntityId: targetEntityId,
  });
  const redirectsRecorded = tombstone ? 1 : 0;
  const withdraw = async (): Promise<number> =>
    tombstone
      ? withdrawResearchEntityMergeTombstone({
          entityId: tombstone.entityId,
          onlyIfCreated: tombstone.created,
        })
      : 0;

  try {
    const materialized = await materializeEntity('researchEntity', { entityKey: row.entityKey });
    if (!strandedKeyMergeLanded(materialized, targetEntityId)) {
      return {
        entityKey: row.entityKey,
        action: 'redirect_withdrawn_merge_did_not_land',
        redirectsWithdrawn: await withdraw(),
        fieldsWritten: materialized.fieldsWritten,
        materializedEntityId: materialized.entityId,
        materializerSkipped: materialized.skipped,
      };
    }
    return {
      entityKey: row.entityKey,
      action: 'redirected',
      redirectsRecorded,
      fieldsWritten: materialized.fieldsWritten,
      materializedEntityId: materialized.entityId,
      materializerSkipped: materialized.skipped,
    };
  } catch (error) {
    return {
      entityKey: row.entityKey,
      action: 'redirect_withdrawn_merge_did_not_land',
      redirectsWithdrawn: await withdraw(),
      fieldsWritten: 0,
      errorMessage: sanitizeLogValue(error),
    };
  }
}

async function main(): Promise<void> {
  const args = parseStrandedKeyApplyArgs(process.argv.slice(2));
  const apply = args.apply;
  const safeOutput = args.output ? resolveSafeJsonReportOutputPath(args.output) : undefined;
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'observations:stranded-key-decisions',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const report = await buildStrandedKeyDecisionReport();

  console.log(
    `mode: ${apply ? 'apply' : 'dry-run'}  env: ${guard.environment}  db: ${guard.dbLabel}`,
  );
  console.log(`${EVIDENCE_MERGE_REMEDY} keys: ${report.evidenceMergeKeyCount}`);
  for (const [label, bucket] of Object.entries(report.summary).sort(
    (left, right) => right[1].keys - left[1].keys,
  )) {
    console.log(
      `  ${String(bucket.keys).padStart(4)} keys ${String(bucket.liveObservations).padStart(6)} obs  ${label}`,
    );
  }

  const selection = selectStrandedKeyApplyRows(report.rows, args);
  console.log(
    `actionable rows ${report.rows.filter((row) => row.decision !== 'LEAVE_ALONE').length}; ${
      apply ? 'applying' : 'would apply'
    } ${selection.selected.length} (limit ${args.limit}); deferred to a later run for a shared target ${selection.deferredForSharedTarget.length}`,
  );

  const outcomes = apply ? await applyStrandedKeyDecisions(selection) : [];
  if (apply) {
    const byAction: Record<string, number> = {};
    let fieldsWritten = 0;
    let observationsRetired = 0;
    for (const outcome of outcomes) {
      byAction[outcome.action] = (byAction[outcome.action] || 0) + 1;
      fieldsWritten += outcome.fieldsWritten ?? 0;
      observationsRetired += outcome.observationsRetired ?? 0;
    }
    console.log(`\napplied: ${JSON.stringify(byAction)}`);
    console.log(`fields written into live canonicals: ${fieldsWritten}`);
    console.log(`observations retired: ${observationsRetired}`);
    // Named rather than left to the counts: a withdrawn redirect is the one outcome an
    // operator has to re-read, because the key is still stranded and still needs a home.
    for (const outcome of outcomes.filter(
      (candidate) => candidate.action === 'redirect_withdrawn_merge_did_not_land',
    )) {
      console.warn(
        `  merge did not land, redirect withdrawn: ${sanitizeLogValue(outcome.entityKey)} ` +
          `skipped=${outcome.materializerSkipped ?? 'none'} error=${outcome.errorMessage ?? 'none'}`,
      );
    }
  }

  if (safeOutput) {
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify({ ...report, outcomes }, null, 2)}\n`);
    console.log(`\nwrote ${safeOutput}`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
