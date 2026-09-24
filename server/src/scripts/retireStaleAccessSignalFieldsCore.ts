// PR #463 dropped all 8 of these from the ResearchEntity schema (not just the
// 4 named in the top-level access booleans), matching researchModelInventoryCore's
// RETIREMENT_FIELD_PROBES for this cluster. Mongoose ignores undeclared fields on
// read but does not strip stored values, so Development docs may still carry them.
export const STALE_ACCESS_SIGNAL_FIELDS = [
  'acceptingUndergrads',
  'openness',
  'acceptanceConfidence',
  'opennessSignals',
  'opennessStatusCache',
  'opennessExplanationCache',
  'opennessComputedAt',
  'opennessLastSignalAt',
] as const;

/**
 * The provenance sibling of the list above. `fieldProvenance.openness` outlived the
 * top-level fields because it is not read by name anywhere: it has no writer and no
 * named reader, and the top-level cluster above already reads 0 documents while this
 * one reads 532.
 *
 * It is listed separately rather than folded in because the comment above is a claim
 * about PR #463's eight top-level fields and stays true only if the list holds exactly
 * those, and because this key needed a measurement the others did not:
 * `hasLiveSourceCitation` unions every `fieldProvenance.*.sourceUrl` by POSITION, so
 * removing a key can in principle move an `all_citations_dead` verdict.
 *
 * Measured on Development before removal, by calling that function rather than
 * reimplementing its predicate: 532 rows carry the key, 343 of them `student_ready`,
 * all 532 carry a `sourceUrl` under it, and `hasLiveSourceCitation` is true for all 532
 * both with and without it. So the removal moves 0 gate verdicts.
 *
 * Three controls, because that zero is otherwise worthless: marking every citation on
 * a row dead flips 532 of 532, so the comparison can return non-zero; dropping all
 * `fieldProvenance` keys at once flips 4 rows, so provenance is load-bearing somewhere;
 * and under the hypothetical where every other citation on a row is dead, this key is
 * the sole live citation on exactly 1 row.
 *
 * That 1 row is the watchable case, named by predicate because this repository is
 * public: the single `student_ready`, non-archived row carrying this key whose 2 stored
 * `sourceUrls` and 27 sibling provenance citations are all marked dead across its 7
 * `sourceLinkHealth` records, leaving the `medicine.yale.edu` URL under this key as the
 * only citation not known to be dead. It is not affected today, because those sibling
 * citations are not in fact dead.
 */
export const STALE_ACCESS_SIGNAL_PROVENANCE_FIELDS = ['fieldProvenance.openness'] as const;

/**
 * Every path this script retires. `$exists` and `$unset` both take a dotted path, so
 * the nested key needs no separate mechanism.
 */
export const RETIRED_ACCESS_SIGNAL_PATHS = [
  ...STALE_ACCESS_SIGNAL_FIELDS,
  ...STALE_ACCESS_SIGNAL_PROVENANCE_FIELDS,
] as const;

export function assertStaleAccessSignalFieldsFullyUnset(presentAfter: number): void {
  if (presentAfter !== 0) {
    throw new Error(
      `retire:stale-access-signal-fields invariant violated: ${presentAfter} research_entities documents still carry a stale access-signal field after apply.`,
    );
  }
}
