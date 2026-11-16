import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import {
  buildRematerializeFieldChanges,
  observationValueIsMaterializable,
  researchEntityFieldIsStranded,
} from '../scripts/rematerializeResearchEntitiesCore';
import { MERGE_REMATERIALIZE_AUDITED_FIELDS } from '../scripts/mergeRematerializeDriftCore';

export interface MergeCanonicalRematerialization {
  attempted: boolean;
  fieldsWritten?: number;
  conflicts?: number;
  skipped?: string;
  filledFields?: string[];
  changedFields?: string[];
}

/**
 * Fill-only on purpose. Measured over Development's merge survivors, an unrestricted
 * re-projection recovers evidence the merge carry list drops (undergraduate hosting
 * quotes, lead links, method lists) but also REPLACES values the survivor already
 * holds, and some of those replacements are shorter or are prose about the source page
 * rather than about the research. Description arbitration already has length and trust
 * gates in the dedupe plan builders, so a re-projection gains evidence and never
 * trades it.
 */
export async function rematerializeMergeCanonicalFillOnly(
  canonicalId: mongoose.Types.ObjectId | string,
): Promise<MergeCanonicalRematerialization> {
  const entityId = String(canonicalId);
  const selectFields = ['slug', ...MERGE_REMATERIALIZE_AUDITED_FIELDS].join(' ');
  const before = await ResearchEntity.findById(entityId)
    .select(selectFields)
    .lean<Record<string, unknown>>();
  if (!before) return { attempted: false };

  const planned = await materializeEntity('researchEntity', { entityId }, { dryRun: true });
  if (planned.skipped) {
    return { attempted: true, skipped: planned.skipped, fieldsWritten: 0, conflicts: 0 };
  }

  const plannedSet = planned.plannedSet || {};
  const filledFields = MERGE_REMATERIALIZE_AUDITED_FIELDS.filter(
    (field) =>
      Object.prototype.hasOwnProperty.call(plannedSet, field) &&
      researchEntityFieldIsStranded(before[field]) &&
      observationValueIsMaterializable(plannedSet[field]),
  );
  if (filledFields.length === 0) {
    return { attempted: true, fieldsWritten: 0, conflicts: 0, filledFields: [], changedFields: [] };
  }

  const result = await materializeEntity(
    'researchEntity',
    { entityId },
    { writeOnlyFields: filledFields, keepPostProjectionEvidence: true },
  );
  if (result.skipped) {
    return { attempted: true, skipped: result.skipped, fieldsWritten: 0, conflicts: 0 };
  }

  const after = await ResearchEntity.findById(entityId)
    .select(selectFields)
    .lean<Record<string, unknown>>();
  const changedFields = buildRematerializeFieldChanges(
    before,
    (after as Record<string, unknown>) || {},
    {},
    MERGE_REMATERIALIZE_AUDITED_FIELDS,
  ).map((change) => change.field);

  return {
    attempted: true,
    fieldsWritten: result.fieldsWritten,
    conflicts: result.conflicts,
    filledFields,
    changedFields,
  };
}

export interface MergeSurvivorWebsiteDerivation {
  attempted: boolean;
  fieldsWritten?: number;
  skipped?: string;
}

export const MERGE_SURVIVOR_WEBSITE_FIELDS = ['website', 'websiteUrl'] as const;

/**
 * A merge never writes a survivor's website itself (#6323): the materializer derives it
 * from the evidence that reaches the survivor after the fold, which lets a merged-in
 * twin's backed website fill an empty slot and refuses one the survivor's own
 * lab-identity lane already owns.
 */
export async function deriveMergeSurvivorWebsite(
  canonicalId: mongoose.Types.ObjectId | string,
): Promise<MergeSurvivorWebsiteDerivation> {
  const result = await materializeEntity(
    'researchEntity',
    { entityId: String(canonicalId) },
    { writeOnlyFields: [...MERGE_SURVIVOR_WEBSITE_FIELDS] },
  );
  if (result.skipped) return { attempted: true, skipped: result.skipped, fieldsWritten: 0 };
  return { attempted: true, fieldsWritten: result.fieldsWritten };
}
