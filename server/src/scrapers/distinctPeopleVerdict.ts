export interface DistinctPeopleVerdictRecord {
  researcherId: string;
  distinctFromResearcherIds: readonly string[];
}

export interface DistinctPeopleVerdictIndex {
  readonly size: number;
  canonicalPersonId(personId: string): string;
  areDistinctPeople(left: string, right: string): boolean;
  verdictPairs(): ReadonlyArray<readonly [string, string]>;
}

export type DistinctPeopleVerdictPair = readonly [string, string];

const text = (value: unknown): string => (value == null ? '' : String(value).trim());

const pairKey = (left: string, right: string): string => [left, right].sort().join('|');

/**
 * The operator's recorded distinct-people verdicts (`researchers:record-distinct-people`),
 * read symmetrically and through researcher fold chains (#5802).
 *
 * A verdict is written on both researchers, but either half alone is enough, so a row
 * that lost one side still counts. A researcher folded into another by researcher-dedupe
 * carries its verdicts to the researcher it was folded into, so a later fold cannot
 * launder a verdict by renaming one side of it. A verdict whose two sides fold into one
 * researcher no longer separates anyone and is dropped.
 */
export function buildDistinctPeopleVerdictIndex(input: {
  verdicts: ReadonlyArray<DistinctPeopleVerdictRecord>;
  dedupedIntoByResearcherId?: ReadonlyMap<string, string>;
}): DistinctPeopleVerdictIndex {
  const foldedInto = input.dedupedIntoByResearcherId ?? new Map<string, string>();
  const canonicalPersonId = (personId: string): string => {
    let current = text(personId);
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const next = text(foldedInto.get(current));
      if (!next) break;
      current = next;
    }
    return current;
  };
  const pairs = new Map<string, DistinctPeopleVerdictPair>();
  for (const verdict of input.verdicts) {
    const left = canonicalPersonId(verdict.researcherId);
    for (const other of verdict.distinctFromResearcherIds) {
      const right = canonicalPersonId(other);
      if (!left || !right || left === right) continue;
      const ordered = [left, right].sort() as [string, string];
      pairs.set(pairKey(left, right), ordered);
    }
  }
  return {
    size: pairs.size,
    canonicalPersonId,
    areDistinctPeople: (left, right) => {
      const a = canonicalPersonId(left);
      const b = canonicalPersonId(right);
      return Boolean(a && b && a !== b && pairs.has(pairKey(a, b)));
    },
    verdictPairs: () => [...pairs.values()],
  };
}

/**
 * The recorded distinct-people pairs a proposed fold would join (#5802). Each side is the
 * lead person ids of one row, or the one id of one researcher, that the fold would make
 * one. An empty result means the verdicts do not stand in the way.
 *
 * A pair is joined when one side holds one of the two people and a side holds the other,
 * unless every side that holds either of them already holds both: two copies of a lab the
 * two people genuinely co-lead are not refused for containing both, while folding one
 * person's own row into the shared lab, or into the other person's row, is.
 *
 * This only ever refuses. It cannot make two sides foldable that were not already.
 */
export function distinctPeopleVerdictPairsJoinedByFold(
  sides: ReadonlyArray<Iterable<string>>,
  verdicts: DistinctPeopleVerdictIndex,
): DistinctPeopleVerdictPair[] {
  if (verdicts.size === 0 || sides.length < 2) return [];
  const canonicalSides = sides.map(
    (side) => new Set([...side].map((id) => verdicts.canonicalPersonId(id)).filter(Boolean)),
  );
  const joined: DistinctPeopleVerdictPair[] = [];
  for (const pair of verdicts.verdictPairs()) {
    const [left, right] = pair;
    const holders = canonicalSides.filter((side) => side.has(left) || side.has(right));
    if (holders.length < 2) continue;
    const holdsLeft = holders.some((side) => side.has(left));
    const holdsRight = holders.some((side) => side.has(right));
    if (!holdsLeft || !holdsRight) continue;
    if (holders.every((side) => side.has(left) && side.has(right))) continue;
    joined.push(pair);
  }
  return joined;
}
