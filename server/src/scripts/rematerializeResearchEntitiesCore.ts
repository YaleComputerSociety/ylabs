import {
  fieldProvenanceEntries,
  fieldProvenanceEntryNamesALaneWithoutEvidence,
} from '../models/fieldProvenanceBacking';
import {
  RESEARCH_ENTITY_CONTACT_FIELDS,
  observationIsKeyedToRow,
} from '../scrapers/rowKeyedContactEvidence';
import { sanitizeLogValue } from '../utils/logSanitizer';
import type { UnbackedResearchAreaOutcome } from '../scrapers/entityMaterializer';

export interface RematerializeResearchEntitiesArgs {
  slugs: string[];
  apply: boolean;
  confirmRematerialize: boolean;
  reclaimStrandedField?: string;
  unbackedProvenance: boolean;
  foreignContact: boolean;
  unbackedResearchAreas: boolean;
  onlyFields: string[];
  includeArchived: boolean;
  output?: string;
}

/**
 * `--reclaim-stranded` selects only rows where `researchEntityFieldIsStranded`
 * holds, so every row it touches stores an empty value for the field. That is why
 * `fullDescription` is reclaimable even though the corpus sweep over rows that
 * already HOLD prose is not safe: the 43-of-96 rejection rate recorded on #1908
 * was measured on rows whose stored body would be REPLACED, and an empty body has
 * nothing to displace. Measured on Development, zero `student_ready` rows store an
 * empty `fullDescription`, so an empty one always means nothing is served.
 *
 * `shortDescription` is deliberately NOT here. The same measurement found 26
 * `student_ready` rows storing an empty short, 25 of which serve a card DERIVED at
 * serve time from the body, so a stranded short is not a row serving nothing and
 * adopting one would replace a card students already see.
 */
export const RECLAIMABLE_STRANDED_FIELDS = ['methods', 'researchAreas', 'fullDescription'] as const;

export type ReclaimableStrandedField = (typeof RECLAIMABLE_STRANDED_FIELDS)[number];

function parseReclaimStrandedField(value: string | undefined): ReclaimableStrandedField {
  const field = value?.trim();
  if (!field) throw new Error('--reclaim-stranded requires a field name');
  if (!(RECLAIMABLE_STRANDED_FIELDS as readonly string[]).includes(field)) {
    throw new Error(
      `--reclaim-stranded only supports ${RECLAIMABLE_STRANDED_FIELDS.join(', ')} (got: ${field})`,
    );
  }
  return field as ReclaimableStrandedField;
}

/**
 * The report is only as wide as this list, so a field the materializer rewrites and
 * this list omits reads as unchanged rather than as unmeasured (#2536). `kind` is a
 * pure function of `entityType`, so tracking the derived field without its source
 * made every LAB-versus-FACULTY_RESEARCH_AREA drift report the shadow of the answer.
 * A field belongs here when the materializer plans it and the product serves it;
 * `inferredPiUserKey` is deliberately absent because it is planned but never
 * persisted, so tracking it would report a change on every run forever, and
 * `contactEmail`, `contactName` and `contactRole` are absent because
 * `publicResearchDetailGroup` withholds them from every served payload, so tracking
 * them would print a withheld contact into a report an operator pastes around.
 */
export const REMATERIALIZE_TRACKED_FIELDS = [
  'name',
  'displayName',
  'shortDescription',
  'fullDescription',
  'description',
  'summary',
  'researchAreas',
  'methods',
  'websiteUrl',
  'contactUrl',
  'sourceUrls',
  'inferredPiUserId',
  'entityType',
  'kind',
  'school',
  'schools',
  'departments',
  'orgAffiliationLabels',
  'undergradEvidenceQuote',
  'studentVisibilityTier',
] as const;

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;

function parseSlugList(value: string | undefined): string[] {
  if (!value) throw new Error('--slugs requires a comma-separated list of entity slugs');
  const slugs = value
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
  if (slugs.length === 0) throw new Error('--slugs requires at least one entity slug');
  for (const slug of slugs) {
    if (!SLUG_RE.test(slug)) throw new Error(`Invalid entity slug: ${slug}`);
  }
  return Array.from(new Set(slugs));
}

function parseOnlyFieldsList(value: string | undefined): string[] {
  if (!value) throw new Error('--only-fields requires a comma-separated list of fields');
  const fields = value
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.length === 0) throw new Error('--only-fields requires at least one field');
  for (const field of fields) {
    if (!(REMATERIALIZE_TRACKED_FIELDS as readonly string[]).includes(field)) {
      throw new Error(`Unsupported --only-fields field: ${field}`);
    }
  }
  return Array.from(new Set(fields));
}

export function parseRematerializeResearchEntitiesArgs(
  argv: string[],
): RematerializeResearchEntitiesArgs {
  const args: RematerializeResearchEntitiesArgs = {
    slugs: [],
    apply: false,
    confirmRematerialize: false,
    unbackedProvenance: false,
    foreignContact: false,
    unbackedResearchAreas: false,
    onlyFields: [],
    includeArchived: false,
  };
  let slugsProvided = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
      continue;
    }
    if (arg === '--confirm-rematerialize') {
      args.confirmRematerialize = true;
      continue;
    }
    if (arg === '--include-archived') {
      args.includeArchived = true;
      continue;
    }
    if (arg === '--unbacked-provenance') {
      args.unbackedProvenance = true;
      continue;
    }
    if (arg === '--foreign-contact') {
      args.foreignContact = true;
      continue;
    }
    if (arg === '--unbacked-research-areas') {
      args.unbackedResearchAreas = true;
      continue;
    }
    if (arg.startsWith('--slugs=')) {
      args.slugs = parseSlugList(arg.slice('--slugs='.length));
      slugsProvided = true;
      continue;
    }
    if (arg === '--slugs') {
      args.slugs = parseSlugList(argv[index + 1]);
      slugsProvided = true;
      index += 1;
      continue;
    }
    if (arg.startsWith('--reclaim-stranded=')) {
      args.reclaimStrandedField = parseReclaimStrandedField(
        arg.slice('--reclaim-stranded='.length),
      );
      continue;
    }
    if (arg === '--reclaim-stranded') {
      args.reclaimStrandedField = parseReclaimStrandedField(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--only-fields=')) {
      args.onlyFields = parseOnlyFieldsList(arg.slice('--only-fields='.length));
      continue;
    }
    if (arg === '--only-fields') {
      args.onlyFields = parseOnlyFieldsList(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
      continue;
    }
    if (arg === '--output') {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown rematerialize argument: ${arg}`);
  }

  if (
    !slugsProvided &&
    !args.reclaimStrandedField &&
    !args.unbackedProvenance &&
    !args.foreignContact &&
    !args.unbackedResearchAreas
  ) {
    throw new Error(
      '--slugs, --reclaim-stranded, --unbacked-provenance, --foreign-contact or --unbacked-research-areas is required',
    );
  }
  if (
    args.unbackedResearchAreas &&
    (args.unbackedProvenance || args.foreignContact || args.reclaimStrandedField)
  ) {
    throw new Error('--unbacked-research-areas writes research areas only, so it runs on its own');
  }
  if (args.unbackedProvenance && args.reclaimStrandedField) {
    throw new Error('--unbacked-provenance writes provenance only, so it cannot reclaim a field');
  }
  if (args.foreignContact && (args.unbackedProvenance || args.reclaimStrandedField)) {
    throw new Error('--foreign-contact writes contact fields only, so it runs on its own');
  }
  if (args.foreignContact && args.onlyFields.length > 0) {
    throw new Error('--foreign-contact is already scoped to the contact fields');
  }
  // A reclaim run selects its cohort by one field being empty, and an unscoped
  // rematerialize over that cohort rewrites every tracked field - which is how a
  // reclaim dropped a row's direct profile sourceUrl (#1908). Scope it to the
  // field being reclaimed unless the operator asked for a wider scope.
  if (args.reclaimStrandedField && args.onlyFields.length === 0) {
    args.onlyFields = [args.reclaimStrandedField];
  }
  if (args.unbackedResearchAreas && args.onlyFields.length === 0) {
    args.onlyFields = ['researchAreas'];
  }
  return args;
}

export function assertRematerializeApplyAllowed(
  args: RematerializeResearchEntitiesArgs,
  dbLabel: string,
): void {
  if (!args.apply) return;
  if (!args.confirmRematerialize) {
    throw new Error('--confirm-rematerialize is required when --apply is set.');
  }
  if (!/\/development$/i.test(dbLabel)) {
    throw new Error(
      `rematerialize --apply is restricted to the Development database (target: ${dbLabel}).`,
    );
  }
}

export interface RematerializeFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

function normalizeForComparison(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map((entry) => normalizeForComparison(entry));
  return value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right))
  );
}

/**
 * A contact value is withheld from every served payload, and this report is written to
 * files an operator pastes around, so a contact change is recorded by field name and
 * direction and never by value.
 */
export interface RematerializeWithheldFieldChange {
  field: string;
  withheld: 'set' | 'replaced' | 'cleared';
}

export type RematerializeReportedChange =
  | RematerializeFieldChange
  | RematerializeWithheldFieldChange;

export function isWithheldChange(
  change: RematerializeReportedChange,
): change is RematerializeWithheldFieldChange {
  return 'withheld' in change;
}

/**
 * Every field the run may write, so a write outside the tracked list cannot read as no
 * change (#3822). The contact fields are always compared because an unscoped pass can
 * write them too; their values never reach the report.
 */
export function rematerializeComparedFields(writeOnlyFields: readonly string[]): string[] {
  return Array.from(
    new Set([
      ...REMATERIALIZE_TRACKED_FIELDS,
      ...writeOnlyFields,
      ...RESEARCH_ENTITY_CONTACT_FIELDS,
    ]),
  );
}

/**
 * The row a dry run's plan would leave, in the same shape an apply re-reads, so the
 * two modes diff the same way. A re-read omits an unset field, which is why the apply
 * side must not fall back to the stored value for an absent key.
 */
export function rematerializeStateAfterPlan(
  before: Record<string, unknown>,
  plannedSet: Record<string, unknown>,
  plannedUnset: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const after: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(plannedUnset, field)) continue;
    const value = Object.prototype.hasOwnProperty.call(plannedSet, field)
      ? plannedSet[field]
      : before[field];
    if (value !== undefined) after[field] = value;
  }
  return after;
}

export function rematerializeReportedChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): RematerializeReportedChange[] {
  const changes: RematerializeReportedChange[] = [];
  for (const field of fields) {
    const beforeValue = before[field];
    const afterValue = after[field];
    if (valuesEqual(beforeValue, afterValue)) continue;
    if (RESEARCH_ENTITY_CONTACT_FIELDS.includes(field)) {
      const withheld = researchEntityFieldIsStranded(afterValue)
        ? 'cleared'
        : researchEntityFieldIsStranded(beforeValue)
          ? 'set'
          : 'replaced';
      changes.push({ field, withheld });
      continue;
    }
    changes.push({ field, before: beforeValue, after: afterValue });
  }
  return changes;
}

export function buildRematerializeFieldChanges(
  before: Record<string, unknown>,
  plannedSet: Record<string, unknown>,
  plannedUnset: Record<string, unknown>,
  trackedFields: readonly string[] = REMATERIALIZE_TRACKED_FIELDS,
): RematerializeFieldChange[] {
  const changes: RematerializeFieldChange[] = [];
  for (const field of trackedFields) {
    const beforeValue = before[field];
    let afterValue: unknown;
    if (Object.prototype.hasOwnProperty.call(plannedUnset, field)) {
      afterValue = undefined;
    } else if (Object.prototype.hasOwnProperty.call(plannedSet, field)) {
      afterValue = plannedSet[field];
    } else {
      afterValue = beforeValue;
    }
    if (!valuesEqual(beforeValue, afterValue)) {
      changes.push({ field, before: beforeValue, after: afterValue });
    }
  }
  return changes;
}

export interface ForeignContactCandidateRow {
  _id?: unknown;
  slug?: unknown;
  manuallyLockedFields?: unknown;
  [field: string]: unknown;
}

/**
 * The rows `--foreign-contact` reaches: a live row storing an unlocked contact field
 * that no live observation keyed to the row states (#3609). Returns field names only,
 * never a value, because the report is pasted around.
 */
export function foreignContactFieldsByRow(
  rows: readonly ForeignContactCandidateRow[],
  liveContactObservations: ReadonlyArray<{
    entityId?: unknown;
    entityKey?: unknown;
    field?: unknown;
    value?: unknown;
  }>,
): Map<string, string[]> {
  const statement = (field: unknown, value: unknown) =>
    `${String(field)}\u0000${typeof value === 'string' ? value.trim() : ''}`;
  const byRow = new Map<string, string[]>();
  for (const row of rows) {
    if (typeof row.slug !== 'string' || !row.slug) continue;
    const isLocked = (field: string) =>
      Array.isArray(row.manuallyLockedFields) && row.manuallyLockedFields.includes(field);
    const statedByRow = new Set(
      liveContactObservations
        .filter((observation) => observationIsKeyedToRow(observation, row))
        .map((observation) => statement(observation.field, observation.value)),
    );
    const foreign = RESEARCH_ENTITY_CONTACT_FIELDS.filter(
      (field) =>
        typeof row[field] === 'string' &&
        (row[field] as string).trim().length > 0 &&
        !isLocked(field) &&
        !statedByRow.has(statement(field, row[field])),
    );
    if (foreign.length > 0) byRow.set(row.slug, foreign);
  }
  return byRow;
}

export function slugsCarryingUnbackedProvenance(
  rows: ReadonlyArray<{ slug?: unknown; fieldProvenance?: unknown }>,
): string[] {
  const slugs = new Set<string>();
  for (const row of rows) {
    if (typeof row.slug !== 'string' || !row.slug) continue;
    const unbacked = fieldProvenanceEntries(row.fieldProvenance).some(([, entry]) =>
      fieldProvenanceEntryNamesALaneWithoutEvidence(entry),
    );
    if (unbacked) slugs.add(row.slug);
  }
  return Array.from(slugs).sort();
}

function recordedObservationId(entry: unknown): string | undefined {
  const observationId = (entry as { observationId?: unknown } | null)?.observationId;
  return observationId === undefined || observationId === null || String(observationId) === ''
    ? undefined
    : String(observationId);
}

/**
 * One change per entry that named a lane without evidence before the pass and was either
 * retired (`after` undefined) or relinked to the observation it cites (`after` names it).
 */
export function provenanceReconciliationChanges(
  before: unknown,
  after: unknown,
): RematerializeFieldChange[] {
  const remaining = new Map(fieldProvenanceEntries(after));
  const changes: RematerializeFieldChange[] = [];
  for (const [field, entry] of fieldProvenanceEntries(before)) {
    if (!fieldProvenanceEntryNamesALaneWithoutEvidence(entry)) continue;
    const sourceName = (entry as { sourceName?: unknown } | null)?.sourceName ?? null;
    if (!remaining.has(field)) {
      changes.push({ field: `fieldProvenance.${field}`, before: sourceName, after: undefined });
      continue;
    }
    const observationId = recordedObservationId(remaining.get(field));
    if (observationId) {
      changes.push({
        field: `fieldProvenance.${field}`,
        before: sourceName,
        after: { sourceName, observationId },
      });
    }
  }
  return changes;
}

export function countProvenanceReconciliation(
  entities: ReadonlyArray<{ changes: RematerializeReportedChange[] }>,
): { retired: number; relinked: number } {
  let retired = 0;
  let relinked = 0;
  for (const entity of entities) {
    for (const change of entity.changes) {
      if (isWithheldChange(change) || !change.field.startsWith('fieldProvenance.')) continue;
      if (change.after === undefined) retired += 1;
      else relinked += 1;
    }
  }
  return { retired, relinked };
}

export function rematerializeChangeAffectsVisibilityGate(
  changes: RematerializeReportedChange[],
): boolean {
  return changes.some((change) => change.field !== 'studentVisibilityTier');
}

export interface RematerializeEntityReport {
  slug: string;
  found: boolean;
  entityId?: string;
  studentVisibilityTierBefore?: unknown;
  fieldsWritten?: number;
  materializerFieldsWritten?: number;
  conflicts?: number;
  changes: RematerializeReportedChange[];
  clearedContactFields?: string[];
  unbackedResearchAreas?: UnbackedResearchAreaOutcome;
  skipped?: string;
  error?: string;
}

/**
 * `fieldsWritten` and `clearedContactFields` are read off `changes`, the same list
 * `entitiesChanged` counts, so the three cannot disagree. The materializer's own count
 * is kept apart because it also counts a planned value equal to the stored one.
 */
export function rematerializeEntityReportFromChanges(input: {
  slug: string;
  entityId?: string;
  studentVisibilityTierBefore?: unknown;
  materializerFieldsWritten?: number;
  conflicts?: number;
  changes: RematerializeReportedChange[];
  foreignContact: boolean;
  unbackedResearchAreas?: UnbackedResearchAreaOutcome;
  skipped?: string;
}): RematerializeEntityReport {
  return {
    slug: input.slug,
    found: true,
    entityId: input.entityId,
    studentVisibilityTierBefore: input.studentVisibilityTierBefore,
    fieldsWritten: input.changes.length,
    materializerFieldsWritten: input.materializerFieldsWritten,
    conflicts: input.conflicts,
    changes: input.changes,
    ...(input.foreignContact
      ? {
          clearedContactFields: input.changes
            .filter((change) => isWithheldChange(change) && change.withheld === 'cleared')
            .map((change) => change.field),
        }
      : {}),
    ...(input.unbackedResearchAreas ? { unbackedResearchAreas: input.unbackedResearchAreas } : {}),
    skipped: input.skipped,
  };
}

function researchAreaChipList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((area): area is string => typeof area === 'string')
    : [];
}

export function countResearchAreaChipChanges(changes: readonly RematerializeReportedChange[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    if (change.field !== 'researchAreas' || isWithheldChange(change)) continue;
    const before = researchAreaChipList(change.before);
    const after = researchAreaChipList(change.after);
    added += after.filter((area) => !before.includes(area)).length;
    removed += before.filter((area) => !after.includes(area)).length;
  }
  return { added, removed };
}

export function summarizeRematerializeEntities(
  entities: readonly RematerializeEntityReport[],
  options: { foreignContact: boolean },
): {
  entitiesChanged: number;
  fieldsWritten: number;
  clearedContactFields?: number;
  unbackedResearchAreas: Partial<Record<UnbackedResearchAreaOutcome, number>>;
  researchAreaChips: { added: number; removed: number };
} {
  let entitiesChanged = 0;
  let fieldsWritten = 0;
  let clearedContactFields = 0;
  const unbackedResearchAreas: Partial<Record<UnbackedResearchAreaOutcome, number>> = {};
  const researchAreaChips = { added: 0, removed: 0 };
  for (const entity of entities) {
    const chips = countResearchAreaChipChanges(entity.changes);
    researchAreaChips.added += chips.added;
    researchAreaChips.removed += chips.removed;
    if (entity.changes.length > 0) entitiesChanged += 1;
    fieldsWritten += entity.changes.length;
    clearedContactFields += entity.clearedContactFields?.length ?? 0;
    if (entity.unbackedResearchAreas) {
      unbackedResearchAreas[entity.unbackedResearchAreas] =
        (unbackedResearchAreas[entity.unbackedResearchAreas] ?? 0) + 1;
    }
  }
  return {
    entitiesChanged,
    fieldsWritten,
    ...(options.foreignContact ? { clearedContactFields } : {}),
    unbackedResearchAreas,
    researchAreaChips,
  };
}

/**
 * An archived row has no served surface, so recomputing its fields cannot change
 * what a student sees. A merged shell is archived and its identifiers resolve to a
 * live canonical, so materializing it writes one document while the report diffs
 * another (#2905). A redirected row stays skipped even when the operator opts into
 * archived rows, because the write would land on the canonical while the diff and
 * the re-gate scope are keyed on the requested row.
 */
export function rematerializeSkipReasonForEntity(
  before: Record<string, unknown>,
  includeArchived: boolean,
  resolvedCanonicalEntityId?: string,
): string | undefined {
  if (before.archived === true && !includeArchived) return 'archived-entity';
  if (resolvedCanonicalEntityId && before._id && resolvedCanonicalEntityId !== String(before._id)) {
    return 'redirected-to-canonical';
  }
  return undefined;
}

export function rematerializeFailureMessage(error: unknown): string {
  return sanitizeLogValue(error instanceof Error ? error.message : error);
}

/**
 * Aborting the loop on the first throw leaves the corpus between its before and
 * after states with nothing in the report saying where it stopped, so an operator
 * cannot tell which slugs were written (#2905). Every slug is attempted and each
 * failure is carried in the report instead.
 */
export async function collectRematerializeEntityReports(
  slugs: string[],
  processSlug: (slug: string) => Promise<RematerializeEntityReport>,
): Promise<RematerializeEntityReport[]> {
  const reports: RematerializeEntityReport[] = [];
  for (const slug of slugs) {
    try {
      reports.push(await processSlug(slug));
    } catch (error) {
      reports.push({
        slug,
        found: false,
        changes: [],
        error: rematerializeFailureMessage(error),
      });
    }
  }
  return reports;
}

export interface RematerializeRegateCandidate {
  entityId?: string;
  found: boolean;
  skipped?: string;
  changes: RematerializeReportedChange[];
}

export function selectRematerializeRegateEntityIds(
  reports: RematerializeRegateCandidate[],
): string[] {
  const entityIds = new Set<string>();
  for (const report of reports) {
    if (!report.found || report.skipped || !report.entityId) continue;
    if (rematerializeChangeAffectsVisibilityGate(report.changes)) entityIds.add(report.entityId);
  }
  return Array.from(entityIds);
}

export function researchEntityFieldIsStranded(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

export function observationValueIsMaterializable(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) =>
      typeof entry === 'string' ? entry.trim().length > 0 : entry != null,
    );
  }
  if (typeof value === 'string') return value.trim().length > 0;
  return value != null;
}
