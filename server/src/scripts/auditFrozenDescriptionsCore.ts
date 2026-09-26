/**
 * Finds the rows a resolver improvement cannot reach, by asking what the served
 * surface would gain rather than what the resolver would decide differently (#3332).
 *
 * The freeze is real and its mechanism is not in dispute. `materializeFromRun`
 * enumerates only entities carrying an observation in that run, so a row is
 * re-resolved only when some lane emits for it; the content-hash gate exists to stop
 * a paid re-extraction of an unchanged page, and in stopping the emission it also
 * stops the re-resolution. A row whose page settles keeps whatever its fields
 * resolved to on the last run that touched it.
 *
 * What needs care is the size. #3163 changed the resolver's answer on 203 slots and
 * only 13 of those were a stored value failing the served bar, because a changed
 * decision is not a defect: most of the 203 already stored the winner. So this counts
 * one thing only, and counts it through the canonical served sanitizer: a field whose
 * SERVED value is empty today while the corpus holds a live observation for it. That
 * is the population a re-resolution can only improve, because there is nothing to
 * overwrite.
 *
 * The selector is also the verifier. After a bounded pass the same query re-run
 * reports the remainder, so delivery is measured by the instrument that scoped it
 * rather than by a run's own counters.
 */
export type FrozenDescriptionVerdict =
  /** The served field is empty and the projection would fill it. */
  | 'served_fill'
  /** The served field holds text and the projection would empty it. */
  | 'served_regress'
  /** Both serve and the text differs, which needs a per-row argument, not a pass. */
  | 'served_lateral'
  /** Both serve the same text, so the row is already delivered. */
  | 'served_unchanged'
  /** The projection says nothing about the field, so there is no answer to read. */
  | 'projection_silent';

export const FROZEN_DESCRIPTION_FIELDS = ['fullDescription', 'shortDescription'] as const;

export type FrozenDescriptionField = (typeof FROZEN_DESCRIPTION_FIELDS)[number];

export interface FrozenDescriptionInput {
  slug: string;
  field: FrozenDescriptionField;
  tier: string;
  liveObservationCount: number;
  projectionNamesField: boolean;
  servedBefore: string;
  servedAfter: string;
}

export interface FrozenDescriptionFinding extends FrozenDescriptionInput {
  verdict: FrozenDescriptionVerdict;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function classifyFrozenDescription(input: FrozenDescriptionInput): FrozenDescriptionFinding {
  const before = text(input.servedBefore);
  const after = text(input.servedAfter);
  if (!input.projectionNamesField) return { ...input, verdict: 'projection_silent' };
  if (!before && after) return { ...input, verdict: 'served_fill' };
  if (before && !after) return { ...input, verdict: 'served_regress' };
  if (before !== after) return { ...input, verdict: 'served_lateral' };
  return { ...input, verdict: 'served_unchanged' };
}

/**
 * The slugs a bounded delivery pass may run over: those with at least one
 * `served_fill` and no `served_regress`.
 *
 * A regression anywhere on the row disqualifies the whole row rather than the field,
 * because `research-entity:rematerialize` writes a field closure rather than one
 * field, so a row cannot be delivered half way.
 */
export function deliverableSlugs(findings: readonly FrozenDescriptionFinding[]): string[] {
  const fills = new Set<string>();
  const regressions = new Set<string>();
  for (const finding of findings) {
    if (finding.verdict === 'served_fill') fills.add(finding.slug);
    if (finding.verdict === 'served_regress') regressions.add(finding.slug);
  }
  return [...fills].filter((slug) => !regressions.has(slug)).sort();
}

export interface FrozenDescriptionSummary {
  rowsProbed: number;
  byVerdict: Record<string, number>;
  servedFillsByField: Record<string, number>;
  studentReadyServedFills: number;
  deliverableRows: number;
}

export function summarizeFrozenDescriptions(
  findings: readonly FrozenDescriptionFinding[],
): FrozenDescriptionSummary {
  const summary: FrozenDescriptionSummary = {
    rowsProbed: new Set(findings.map((finding) => finding.slug)).size,
    byVerdict: {},
    servedFillsByField: {},
    studentReadyServedFills: 0,
    deliverableRows: deliverableSlugs(findings).length,
  };
  for (const finding of findings) {
    summary.byVerdict[finding.verdict] = (summary.byVerdict[finding.verdict] ?? 0) + 1;
    if (finding.verdict !== 'served_fill') continue;
    summary.servedFillsByField[finding.field] =
      (summary.servedFillsByField[finding.field] ?? 0) + 1;
    if (finding.tier === 'student_ready') summary.studentReadyServedFills += 1;
  }
  return summary;
}
