import {
  RESEARCH_ENTITY_TOMBSTONE_TERMINAL_CAUSES,
  tombstoneTerminalCauseIsMalformed,
  walkResearchEntityTombstoneChainWithCause,
  type ResearchEntityTombstoneNode,
  type ResearchEntityTombstoneTerminalCause,
} from '../services/researchEntityCanonicalTombstone';

export const DEAD_END_TOMBSTONE_VERDICTS = [
  'clear_malformed_pointer',
  'keep_subject_has_no_live_home',
  'keep_resolves',
] as const;
export type DeadEndTombstoneVerdict = (typeof DEAD_END_TOMBSTONE_VERDICTS)[number];

export interface DeadEndTombstonePlan {
  slug: string;
  entityId: string;
  verdict: DeadEndTombstoneVerdict;
  terminalCause?: ResearchEntityTombstoneTerminalCause;
}

export interface DeadEndTombstoneSummary {
  scanned: number;
  plans: DeadEndTombstonePlan[];
  byVerdict: Record<DeadEndTombstoneVerdict, number>;
  byTerminalCause: Record<ResearchEntityTombstoneTerminalCause, number>;
}

function emptyVerdicts(): Record<DeadEndTombstoneVerdict, number> {
  return DEAD_END_TOMBSTONE_VERDICTS.reduce(
    (counts, verdict) => ({ ...counts, [verdict]: 0 }),
    {} as Record<DeadEndTombstoneVerdict, number>,
  );
}

function emptyCauses(): Record<ResearchEntityTombstoneTerminalCause, number> {
  return RESEARCH_ENTITY_TOMBSTONE_TERMINAL_CAUSES.reduce(
    (counts, cause) => ({ ...counts, [cause]: 0 }),
    {} as Record<ResearchEntityTombstoneTerminalCause, number>,
  );
}

/**
 * Only a malformed pointer is repaired, and the repair is to CLEAR it rather than to
 * pick a new destination. A cycle and an absent target cannot name a destination by
 * construction, and guessing one from a name is the #2378 graft channel. Clearing
 * keeps the row, so it keeps occupying its slug and keeps its own description,
 * citations and website: the material anyone would need to decide later where the
 * slug should point. It becomes the `sole_surviving_record_of_slug` state the
 * archived-cleanup guard already refuses to delete.
 *
 * `archived_terminal` is left alone. The chain is well-formed and its answer is that
 * the subject has no live home, which a not-found states truthfully.
 */
export async function buildDeadEndTombstoneRepairPlan(input: {
  tombstones: Array<ResearchEntityTombstoneNode & { slug?: string }>;
  nodeById: (id: string) => ResearchEntityTombstoneNode | undefined;
}): Promise<DeadEndTombstoneSummary> {
  const plans: DeadEndTombstonePlan[] = [];
  const byVerdict = emptyVerdicts();
  const byTerminalCause = emptyCauses();
  const findById = async (id: string) => input.nodeById(id) ?? null;

  for (const tombstone of input.tombstones) {
    const chain = await walkResearchEntityTombstoneChainWithCause(tombstone, { findById });

    if (chain.canonical) {
      byVerdict.keep_resolves += 1;
      continue;
    }

    const terminalCause = chain.terminalCause ?? 'archived_terminal';
    byTerminalCause[terminalCause] += 1;

    const verdict: DeadEndTombstoneVerdict = tombstoneTerminalCauseIsMalformed(terminalCause)
      ? 'clear_malformed_pointer'
      : 'keep_subject_has_no_live_home';
    byVerdict[verdict] += 1;

    plans.push({
      slug: tombstone.slug ?? '',
      entityId: String(tombstone._id),
      verdict,
      terminalCause,
    });
  }

  return { scanned: input.tombstones.length, plans, byVerdict, byTerminalCause };
}

export function malformedPointerEntityIds(summary: DeadEndTombstoneSummary): string[] {
  return summary.plans
    .filter((plan) => plan.verdict === 'clear_malformed_pointer')
    .map((plan) => plan.entityId);
}
