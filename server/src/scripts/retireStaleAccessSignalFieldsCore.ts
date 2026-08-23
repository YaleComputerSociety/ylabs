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

export function assertStaleAccessSignalFieldsFullyUnset(presentAfter: number): void {
  if (presentAfter !== 0) {
    throw new Error(
      `retire:stale-access-signal-fields invariant violated: ${presentAfter} research_entities documents still carry a stale access-signal field after apply.`,
    );
  }
}
