/**
 * A durable refusal: one stored value is not admissible at one field on one row
 * (#3167).
 *
 * Why this is a separate capability rather than a use of something that exists.
 * Field retraction (#2542) answers "the page stopped saying it". These rows are
 * asking something else: the page still says it and the value is WRONG, so every
 * correct source keeps asserting it and retraction correctly never fires. Measured
 * on Development, 22 of the 28 values blocking a `websiteUrl` lock are admitted by
 * every rule in `researchHomeWebsiteUrlDecision` and should be - `tedcohenlab.org`
 * is a real lab site, it is simply not that row's. Admissibility there is a
 * judgement about a value on a row, not about a URL shape, so no vocabulary reaches
 * it and the only way a repair could make it stick was `manuallyLockedFields`.
 *
 * Why not `superseded`, and why not one of the rollback reasons. Both attach to an
 * observation ROW. A later run mints a fresh row carrying the same value, live and
 * unopposed, which is the #2542 mechanism itself and the reason re-scraping does not
 * retract a dead `sourceUrl`. 181,047 rows carry `superseded` and not one of them
 * can stop a value coming back. A refusal is keyed on the VALUE, so it survives
 * re-observation by construction.
 *
 * Why this is not the lock with extra steps. A lock removes the FIELD from
 * derivation, so the row can never improve. A refusal removes one VALUE, and
 * `refusedResolverObservations` drops only the matching observations before the
 * resolver runs, so a better rival at the same field wins normally and a field whose
 * every candidate is refused resolves to nothing - which is the retraction the repair
 * wanted, without freezing the field against the value that has not been offered yet.
 *
 * A refusal is withdrawable. `withdrawnAt` retires it through a reviewed operation,
 * because a rule can change and a judgement can be wrong, and a record that cannot
 * be retired is the permanent veto this exists to avoid.
 */
import { normalizeWebsiteUrlIdentityKey } from '../scripts/researchEntityPiDedupeCore';
import { type ResearchHomeWebsiteUrlRefusal } from './researchHomeWebsiteUrl';

/**
 * Reasons a value can be inadmissible on a row rather than by its own shape. The
 * shape-based vocabulary is reused rather than restated, so a refusal recorded
 * because a rule fired names that rule and an audit can tell the two apart.
 */
export const perRowFieldValueRefusalRules = [
  'wrong_owner',
  'not_this_rows_research',
  'superseded_by_better_source',
  'operator_judgement',
  // The page itself is gone, on the server's own answer. Recorded by
  // `research-entity:refuse-dead-website-values`, which requires an explicit 404 or
  // 410 and withdraws the record when a later probe answers (#3191).
  'confirmed_dead_page',
] as const;

export type PerRowFieldValueRefusalRule = (typeof perRowFieldValueRefusalRules)[number];
export type FieldValueRefusalRule = PerRowFieldValueRefusalRule | ResearchHomeWebsiteUrlRefusal;

export interface FieldValueRefusal {
  valueKey: string;
  rule: FieldValueRefusalRule;
  refusedBy: string;
  refusedAt: Date;
  note: string;
  evidenceUrl?: string;
  withdrawnAt?: Date;
  withdrawnReason?: string;
}

export const FIELD_VALUE_REFUSALS_PATH = 'fieldValueRefusals';

/**
 * Fields whose values are URLs, where two spellings of the same page must refuse
 * each other. Anything else compares on trimmed, case-folded text, because a
 * refusal that missed on a trailing space would read as a clean row.
 */
const URL_VALUED_FIELDS: ReadonlySet<string> = new Set(['websiteUrl', 'website']);

/**
 * A default document is the directory it sits in, so `/lab/x/index.aspx` and `/lab/x/`
 * are one page and must be one refusal (#3191).
 *
 * Folded here rather than in `normalizeWebsiteUrlIdentityKey`, which is deliberate:
 * that key is load bearing for entity dedupe, and widening what counts as the same URL
 * there would change which rows merge. The refusal key is this module's to define.
 *
 * Measured honestly, this is prevention rather than repair. The shape occurred once in
 * 105 lock instances, and none of the 16 currently reachable values is a variant
 * spelling of an existing refusal. It is folded because a default document IS the
 * directory, not because the corpus is full of them: without it, that one row needed a
 * second refusal recorded by hand.
 */
const DEFAULT_DOCUMENT_LEAF = /\/(?:index|default)\.(?:aspx?|html?|php|cfm)$/i;

export function foldDefaultDocumentLeaf(key: string): string {
  return key.replace(DEFAULT_DOCUMENT_LEAF, '');
}

/**
 * Internal whitespace is collapsed for the same reason a trailing space is trimmed: one
 * prose value wrapped differently is one value, and a refusal that missed on a newline
 * would read as a clean row.
 *
 * It is load bearing rather than tidy. A recorder that builds the key from a row's stored
 * text has already been through a collapsing normalizer, while the resolver screen and the
 * projection stage compare the raw observation and the raw stored value, so without this
 * the two sides of the same refusal can disagree on a line break and a refused description
 * survives its own refusal (#3438).
 */
const collapseRefusalWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function fieldValueRefusalKey(field: string, value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((entry) => collapseRefusalWhitespace(String(entry))));
  }
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return JSON.stringify(value);
  const text = collapseRefusalWhitespace(value);
  if (!text) return '';
  if (!URL_VALUED_FIELDS.has(field)) return text.toLowerCase();
  return foldDefaultDocumentLeaf(normalizeWebsiteUrlIdentityKey(text) || text.toLowerCase());
}

function assertRefusableFieldName(field: string): void {
  if (!field || field !== field.trim() || /[.$]/.test(field)) {
    throw new Error(`Cannot refuse a value at an unusable field name: ${JSON.stringify(field)}`);
  }
}

export function fieldValueRefusalsPath(field: string): string {
  assertRefusableFieldName(field);
  return `${FIELD_VALUE_REFUSALS_PATH}.${field}`;
}

const mapEntry = (container: unknown, key: string): unknown => {
  if (!container || typeof container !== 'object') return undefined;
  if (container instanceof Map) return container.get(key);
  return (container as Record<string, unknown>)[key];
};

function refusalList(fieldValueRefusals: unknown, field: string): FieldValueRefusal[] {
  const entry = mapEntry(fieldValueRefusals, field);
  return Array.isArray(entry) ? (entry as FieldValueRefusal[]) : [];
}

/** Refusals still standing on this field: a withdrawn one is history, not a rule. */
export function liveFieldValueRefusals(
  fieldValueRefusals: unknown,
  field: string,
): FieldValueRefusal[] {
  return refusalList(fieldValueRefusals, field).filter((refusal) => !refusal?.withdrawnAt);
}

export function refusedValueRule(
  fieldValueRefusals: unknown,
  field: string,
  value: unknown,
): FieldValueRefusalRule | undefined {
  const key = fieldValueRefusalKey(field, value);
  if (!key) return undefined;
  return liveFieldValueRefusals(fieldValueRefusals, field).find(
    (refusal) => refusal.valueKey === key,
  )?.rule;
}

export function valueIsRefused(
  fieldValueRefusals: unknown,
  field: string,
  value: unknown,
): boolean {
  return refusedValueRule(fieldValueRefusals, field, value) !== undefined;
}

export interface FieldValueRefusalDeclaration {
  field: string;
  value: unknown;
  rule: FieldValueRefusalRule;
  refusedBy: string;
  note?: string;
  evidenceUrl?: string;
  refusedAt?: Date;
}

/**
 * The `$set` fragment recording one refusal, given what the row already refuses at
 * that field. Re-refusing a value already refused returns the list unchanged rather
 * than appending a duplicate, so a re-runnable repair does not grow the record.
 */
export function planFieldValueRefusal(
  currentFieldValueRefusals: unknown,
  declaration: FieldValueRefusalDeclaration,
): Record<string, unknown> {
  const { field, value, rule, refusedBy } = declaration;
  assertRefusableFieldName(field);
  const valueKey = fieldValueRefusalKey(field, value);
  if (!valueKey) {
    throw new Error(`Cannot refuse an empty value at ${field}: there is nothing to refuse.`);
  }
  if (!refusedBy.trim()) {
    throw new Error(`A refusal must name what recorded it (field: ${field}).`);
  }
  // Every other rule names a condition a later reader can re-derive: a dead page can
  // be re-probed, a wrong owner re-checked against the record's own identity. An
  // operator judgement names nothing, so the note is the only thing that will ever
  // explain it, and a blank one is exactly what made 98 `manuallyLockedFields`
  // instances unreadable after the fact (#3368). This is the layer-3 writer, so the
  // fence belongs here rather than in one caller's argument parser.
  if (rule === 'operator_judgement' && !(declaration.note ?? '').trim()) {
    throw new Error(
      `A refusal recorded as operator_judgement must carry a note saying why (field: ${field}).`,
    );
  }
  const existing = refusalList(currentFieldValueRefusals, field);
  if (existing.some((refusal) => refusal.valueKey === valueKey && !refusal.withdrawnAt)) {
    return { [fieldValueRefusalsPath(field)]: existing };
  }
  const refusal: FieldValueRefusal = {
    valueKey,
    rule,
    refusedBy: refusedBy.trim(),
    refusedAt: declaration.refusedAt ?? new Date(),
    note: declaration.note ?? '',
    ...(declaration.evidenceUrl ? { evidenceUrl: declaration.evidenceUrl } : {}),
  };
  return {
    [fieldValueRefusalsPath(field)]: [
      ...existing.filter((entry) => entry.valueKey !== valueKey),
      refusal,
    ],
  };
}

export function planFieldValueRefusalWithdrawal(
  currentFieldValueRefusals: unknown,
  field: string,
  value: unknown,
  withdrawnReason: string,
  withdrawnAt: Date = new Date(),
): Record<string, unknown> {
  assertRefusableFieldName(field);
  if (!withdrawnReason.trim()) {
    throw new Error(`Withdrawing a refusal at ${field} requires a reason.`);
  }
  const key = fieldValueRefusalKey(field, value);
  return {
    [fieldValueRefusalsPath(field)]: refusalList(currentFieldValueRefusals, field).map((refusal) =>
      refusal.valueKey === key && !refusal.withdrawnAt
        ? { ...refusal, withdrawnAt, withdrawnReason: withdrawnReason.trim() }
        : refusal,
    ),
  };
}

export interface RefusableResolverObservation {
  field: string;
  value: unknown;
}

/**
 * The observations the resolver may see, with every refused value dropped.
 *
 * Dropping before resolution rather than after is what makes a refusal narrower than
 * a lock: the resolver still ranks whatever rivals remain, so a row keeps improving
 * at a field where one value was refused. A field left with no candidate resolves to
 * nothing, which is the retraction the repair was reaching for.
 */
export function refusedResolverObservations<T extends RefusableResolverObservation>(
  observations: readonly T[],
  fieldValueRefusals: unknown,
): { kept: T[]; refused: Array<{ field: string; rule: FieldValueRefusalRule }> } {
  const kept: T[] = [];
  const refused: Array<{ field: string; rule: FieldValueRefusalRule }> = [];
  for (const observation of observations) {
    const rule = refusedValueRule(fieldValueRefusals, observation.field, observation.value);
    if (rule) refused.push({ field: observation.field, rule });
    else kept.push(observation);
  }
  return { kept, refused };
}
