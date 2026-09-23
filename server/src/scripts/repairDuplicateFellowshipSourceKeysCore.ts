export interface FellowshipSourceKeyRow {
  id: string;
  sourceKey: string;
  title?: string;
  archived?: boolean;
}

export interface FellowshipSourceKeyRetirement {
  sourceKey: string;
  keepId: string;
  retireIds: string[];
}

export type FellowshipSourceKeyRefusalReason = 'no_live_row' | 'multiple_live_rows';

export interface FellowshipSourceKeyRefusal {
  sourceKey: string;
  reason: FellowshipSourceKeyRefusalReason;
  ids: string[];
}

export interface FellowshipSourceKeyPlan {
  keysWithDuplicates: number;
  retirements: FellowshipSourceKeyRetirement[];
  refusals: FellowshipSourceKeyRefusal[];
}

export function groupFellowshipsBySourceKey(
  rows: readonly FellowshipSourceKeyRow[],
): Map<string, FellowshipSourceKeyRow[]> {
  const groups = new Map<string, FellowshipSourceKeyRow[]>();
  for (const row of rows) {
    const key = typeof row.sourceKey === 'string' ? row.sourceKey.trim() : '';
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/**
 * Which rows lose their claim on a shared `sourceKey`, so the declared unique
 * partial index can build (#3081).
 *
 * The survivor is the one live row in the group. That is the rule
 * `findFellowshipByNormalizedTitle` already resolves a re-scrape with, a live row
 * ahead of an archived one, and it is the only row the gate can ever serve, so
 * keeping it changes nothing a student sees. A group with no live row, or with more
 * than one, is not mechanically decidable: which of two served rows is canonical is
 * a product judgement, so the group is refused and reported rather than guessed.
 */
export function planDuplicateFellowshipSourceKeyRetirements(
  rows: readonly FellowshipSourceKeyRow[],
): FellowshipSourceKeyPlan {
  const retirements: FellowshipSourceKeyRetirement[] = [];
  const refusals: FellowshipSourceKeyRefusal[] = [];
  let keysWithDuplicates = 0;

  for (const [sourceKey, group] of groupFellowshipsBySourceKey(rows)) {
    if (group.length < 2) continue;
    keysWithDuplicates += 1;
    const live = group.filter((row) => row.archived !== true);
    if (live.length !== 1) {
      refusals.push({
        sourceKey,
        reason: live.length === 0 ? 'no_live_row' : 'multiple_live_rows',
        ids: group.map((row) => row.id),
      });
      continue;
    }
    retirements.push({
      sourceKey,
      keepId: live[0].id,
      retireIds: group.filter((row) => row.id !== live[0].id).map((row) => row.id),
    });
  }

  return { keysWithDuplicates, retirements, refusals };
}

export function retiredFellowshipIds(plan: FellowshipSourceKeyPlan): string[] {
  return plan.retirements.flatMap((retirement) => retirement.retireIds);
}
