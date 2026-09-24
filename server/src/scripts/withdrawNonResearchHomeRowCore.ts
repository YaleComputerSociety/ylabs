/**
 * The shape of a withdrawal: a row that is not a research home of any modelled type
 * leaves the served surface, and the values that made it one stop being admissible
 * (#3305).
 *
 * Archiving alone is not the operation. An archived row keeps every one of its
 * observations, and a repair scoped to live slugs then cannot see them: an
 * entity-level zero reads as clean while the evidence is still there, which is the
 * shape measured at 688 observations on 171 keys with no entity. So the values are
 * refused in the same operation, and the refusal is what stops the next materialize
 * pass from restoring what the archive removed.
 *
 * Archiving rather than deleting, because every retirement in this repository has kept
 * its trail and a role edge pointing at a deleted row resolves to nothing at all.
 */
export const NON_RESEARCH_HOME_KINDS = [
  'blog',
  'database',
  'software',
  'clinical-practice',
] as const;

export type NonResearchHomeKind = (typeof NON_RESEARCH_HOME_KINDS)[number];

export const WITHDRAWAL_ARCHIVE_REASON = 'research-entity:withdraw-non-research-home-row';

export interface WithdrawalRow {
  slug: string;
  name?: unknown;
  displayName?: unknown;
  entityType?: unknown;
  kind?: unknown;
  archived?: unknown;
  manuallyLockedFields?: unknown;
}

export type WithdrawalRefusalReason = 'already-archived' | 'manually-locked' | 'no-value-to-refuse';

export interface WithdrawalPlan {
  slug: string;
  /** Field and value pairs the refusal records, so no lane can re-assert them. */
  refusals: Array<{ field: string; value: string }>;
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The values that made the row a research home, which is what a withdrawal has to
 * refuse rather than merely hide.
 *
 * The name and the display heading, because those are what a lane asserted when it
 * treated a link on a profile page as a research home. The type as well, because a
 * row restored by a later pass with its type intact is a research home again whatever
 * its name says.
 */
export function valuesThatMadeItAResearchHome(
  row: WithdrawalRow,
): Array<{ field: string; value: string }> {
  const candidates: Array<{ field: string; value: string }> = [];
  for (const field of ['name', 'displayName', 'entityType', 'kind'] as const) {
    const value = textValue(row[field]);
    if (value) candidates.push({ field, value });
  }
  const deduped = new Map(candidates.map((entry) => [`${entry.field}|${entry.value}`, entry]));
  return Array.from(deduped.values());
}

export function planNonResearchHomeWithdrawal(row: WithdrawalRow): {
  plan?: WithdrawalPlan;
  refused?: WithdrawalRefusalReason;
} {
  if (row.archived === true) return { refused: 'already-archived' };
  const locked = Array.isArray(row.manuallyLockedFields)
    ? row.manuallyLockedFields.map((value) => String(value))
    : [];
  if (locked.length > 0) return { refused: 'manually-locked' };
  const refusals = valuesThatMadeItAResearchHome(row);
  if (refusals.length === 0) return { refused: 'no-value-to-refuse' };
  return { plan: { slug: row.slug, refusals } };
}
