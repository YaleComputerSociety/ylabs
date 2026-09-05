/**
 * Read-only comparison report for the stranded keys whose #2401 remedy is
 * `review_per_key`: each key's stranded values beside the live entity it resolves
 * to, with a recommended redirect / retire / leave-alone (#2405).
 *
 * Writes nothing. The decision itself lives in
 * `strandedKeyRedirectDecisionCore.ts`; this file supplies the facts.
 *
 * Each stranded value is compared as the MATERIALIZER would write it, not raw:
 * `sanitizeProjectedField` is the same transform the projection runs, so raw
 * directory furniture that would be cleaned on the way in ("Lymphoid TissueYSPH
 * ResearcherView 16 Related Publications") is not reported as a conflict it is not.
 *
 * Run:
 *   npx tsx server/src/scripts/strandedKeyRedirectDecisionReport.ts
 *   npx tsx server/src/scripts/strandedKeyRedirectDecisionReport.ts --output=./tmp/2405.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { sanitizeProjectedField } from '../scrapers/entityMaterializer';
import { runOrphanObservationKeyAudit } from './orphanObservationKeyAudit';
import {
  decideStrandedKey,
  summarizeStrandedKeyDecisions,
  type StrandedFieldComparison,
  type StrandedKeyDecision,
  type StrandedKeyReason,
  type StrandedKeyTarget,
} from './strandedKeyRedirectDecisionCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Fields whose stranded value would be written into the canonical by a redirect and
// that a reviewer can judge. Bookkeeping fields (`slug`, `lastObservedAt`,
// `sourceContentHash`, `inferredPiUserKey`) are excluded: they carry no product
// copy, so a difference in them is not evidence either way.
const COMPARED_FIELDS = [
  'name',
  'entityType',
  'kind',
  'school',
  'departments',
  'researchAreas',
  'fullDescription',
  'shortDescription',
  'websiteUrl',
] as const;

interface ReportRow {
  entityKey: string;
  category: string;
  liveObservationCount: number;
  materializationReach: string;
  sourceNames: string[];
  keyPersonName: string;
  targetSlugs: string[];
  targetSlug?: string;
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
    role: { $in: ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'] },
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
  reviewPerKeyCount: number;
  summary: Record<string, { keys: number; liveObservations: number }>;
  rows: ReportRow[];
}> {
  const audit = await runOrphanObservationKeyAudit();
  const reviewRows = audit.classifications.filter((row) => row.remedy === 'review_per_key');
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

    const strandedByField = new Map<string, unknown>();
    for (const observation of [...(observations as Record<string, unknown>[])].sort(
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
    for (const field of COMPARED_FIELDS) {
      if (!strandedByField.has(field)) continue;
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
      targetLeadName: soleTarget ? textValue(soleTarget.leadName) : undefined,
      targetTier: soleTarget ? textValue(soleTarget.studentVisibilityTier) : undefined,
      decision: decision.decision,
      reason: decision.reason,
      fieldComparisons,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    reviewPerKeyCount: reviewRows.length,
    summary: summarizeStrandedKeyDecisions(rows),
    rows,
  };
}

function parseOutput(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index++) {
    if (argv[index].startsWith('--output=')) return argv[index].slice('--output='.length);
    if (argv[index] === '--output') return argv[index + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const requestedOutput = parseOutput(process.argv.slice(2));
  const safeOutput = requestedOutput ? resolveSafeJsonReportOutputPath(requestedOutput) : undefined;
  await initializeConnections();
  const report = await buildStrandedKeyDecisionReport();

  console.log(`review_per_key keys: ${report.reviewPerKeyCount}`);
  for (const [label, bucket] of Object.entries(report.summary).sort(
    (left, right) => right[1].keys - left[1].keys,
  )) {
    console.log(
      `  ${String(bucket.keys).padStart(4)} keys ${String(bucket.liveObservations).padStart(6)} obs  ${label}`,
    );
  }

  if (safeOutput) {
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
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
