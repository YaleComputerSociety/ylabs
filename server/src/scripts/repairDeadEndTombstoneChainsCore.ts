export const DEAD_END_TOMBSTONE_TERMINAL_CAUSES = [
  'cycle',
  'absent_target',
  'archived_terminal',
] as const;
export type DeadEndTombstoneTerminalCause = (typeof DEAD_END_TOMBSTONE_TERMINAL_CAUSES)[number];

export const DEAD_END_TOMBSTONE_VERDICTS = [
  'clear_malformed_pointer',
  'keep_subject_has_no_live_home',
  'keep_resolves',
] as const;
export type DeadEndTombstoneVerdict = (typeof DEAD_END_TOMBSTONE_VERDICTS)[number];

export interface TombstoneChainNode {
  id: string;
  archived: boolean;
  canonicalGroupId?: string;
}

export interface TombstoneChainResult {
  resolvedCanonicalId?: string;
  hops: number;
  terminalCause?: DeadEndTombstoneTerminalCause;
}

export const MAX_TOMBSTONE_CHAIN_HOPS = 10;

/**
 * Walks a tombstone's `canonicalGroupId` chain and names why it failed when it did,
 * because the three failures are not one defect: a cycle and an absent target are
 * malformed pointers, while a chain that simply ends on an archived row is
 * well-formed data saying the subject has no live home.
 */
export function walkTombstoneChain(
  start: TombstoneChainNode,
  nodeById: (id: string) => TombstoneChainNode | undefined,
  maxHops: number = MAX_TOMBSTONE_CHAIN_HOPS,
): TombstoneChainResult {
  const visited = new Set<string>([start.id]);
  let nextId = start.canonicalGroupId;
  let hops = 0;

  while (nextId && hops < maxHops) {
    if (visited.has(nextId)) return { hops, terminalCause: 'cycle' };
    visited.add(nextId);
    const node = nodeById(nextId);
    hops += 1;
    if (!node) return { hops, terminalCause: 'absent_target' };
    if (!node.archived) return { resolvedCanonicalId: node.id, hops };
    nextId = node.canonicalGroupId;
  }

  if (nextId) return { hops, terminalCause: 'cycle' };
  return { hops, terminalCause: 'archived_terminal' };
}

export interface DeadEndTombstonePlan {
  slug: string;
  entityId: string;
  verdict: DeadEndTombstoneVerdict;
  terminalCause?: DeadEndTombstoneTerminalCause;
}

export interface DeadEndTombstoneSummary {
  scanned: number;
  plans: DeadEndTombstonePlan[];
  byVerdict: Record<DeadEndTombstoneVerdict, number>;
  byTerminalCause: Record<DeadEndTombstoneTerminalCause, number>;
}

function emptyVerdicts(): Record<DeadEndTombstoneVerdict, number> {
  return DEAD_END_TOMBSTONE_VERDICTS.reduce(
    (counts, verdict) => ({ ...counts, [verdict]: 0 }),
    {} as Record<DeadEndTombstoneVerdict, number>,
  );
}

function emptyCauses(): Record<DeadEndTombstoneTerminalCause, number> {
  return DEAD_END_TOMBSTONE_TERMINAL_CAUSES.reduce(
    (counts, cause) => ({ ...counts, [cause]: 0 }),
    {} as Record<DeadEndTombstoneTerminalCause, number>,
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
export function buildDeadEndTombstoneRepairPlan(input: {
  tombstones: Array<{ id: string; slug: string; canonicalGroupId?: string }>;
  nodeById: (id: string) => TombstoneChainNode | undefined;
}): DeadEndTombstoneSummary {
  const plans: DeadEndTombstonePlan[] = [];
  const byVerdict = emptyVerdicts();
  const byTerminalCause = emptyCauses();

  for (const tombstone of input.tombstones) {
    const chain = walkTombstoneChain(
      { id: tombstone.id, archived: true, canonicalGroupId: tombstone.canonicalGroupId },
      input.nodeById,
    );

    if (chain.resolvedCanonicalId) {
      byVerdict.keep_resolves += 1;
      continue;
    }

    const terminalCause = chain.terminalCause ?? 'archived_terminal';
    byTerminalCause[terminalCause] += 1;

    const verdict: DeadEndTombstoneVerdict =
      terminalCause === 'archived_terminal'
        ? 'keep_subject_has_no_live_home'
        : 'clear_malformed_pointer';
    byVerdict[verdict] += 1;

    plans.push({ slug: tombstone.slug, entityId: tombstone.id, verdict, terminalCause });
  }

  return { scanned: input.tombstones.length, plans, byVerdict, byTerminalCause };
}

export function malformedPointerEntityIds(summary: DeadEndTombstoneSummary): string[] {
  return summary.plans
    .filter((plan) => plan.verdict === 'clear_malformed_pointer')
    .map((plan) => plan.entityId);
}
