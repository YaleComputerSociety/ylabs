export interface TraineePiEdgeRow {
  id: string;
  personId: string;
  entityId: string;
  role: string;
  reviewStatus?: string;
  sourceName?: string;
}

export type TraineePiEdgeRefusal =
  | 'lead-can-host'
  | 'edge-carries-provenance'
  | 'edge-already-reviewed';

export interface TraineePiEdgePlan {
  retire: TraineePiEdgeRow[];
  refused: Array<{ id: string; reason: TraineePiEdgeRefusal }>;
}

/**
 * Selects the lead edges to retire: a PI or DIRECTOR claim on someone whose title
 * says they cannot host a student (#2876).
 *
 * Fails closed twice. An edge citing a source is left alone, because a page that
 * actually names this person as the lead is evidence worth a human read rather than
 * a bulk retirement. An edge an operator has already reviewed is left alone for the
 * same reason: a decision already made is not this lane's to reverse.
 */
export function planTraineePiEdgeRetirement(
  edges: readonly TraineePiEdgeRow[],
  isTraineeLevelTitle: (title?: string) => boolean,
  titleByPersonId: ReadonlyMap<string, string>,
): TraineePiEdgePlan {
  const retire: TraineePiEdgeRow[] = [];
  const refused: Array<{ id: string; reason: TraineePiEdgeRefusal }> = [];

  for (const edge of edges) {
    if (!isTraineeLevelTitle(titleByPersonId.get(edge.personId))) {
      refused.push({ id: edge.id, reason: 'lead-can-host' });
      continue;
    }
    if ((edge.sourceName || '').trim()) {
      refused.push({ id: edge.id, reason: 'edge-carries-provenance' });
      continue;
    }
    if ((edge.reviewStatus || 'UNREVIEWED') !== 'UNREVIEWED') {
      refused.push({ id: edge.id, reason: 'edge-already-reviewed' });
      continue;
    }
    retire.push(edge);
  }

  return { retire, refused };
}

export function summarizeTraineePiEdgeRefusals(
  refused: ReadonlyArray<{ reason: TraineePiEdgeRefusal }>,
): Record<TraineePiEdgeRefusal, number> {
  const counts: Record<TraineePiEdgeRefusal, number> = {
    'lead-can-host': 0,
    'edge-carries-provenance': 0,
    'edge-already-reviewed': 0,
  };
  for (const entry of refused) counts[entry.reason] += 1;
  return counts;
}

export interface TraineeRosterRow {
  id: string;
  title: string;
  hasAccount: boolean;
  hasAnyRoleEdge: boolean;
}

/**
 * The trainee rows that can be archived: no Yale account behind them and no role
 * edge anywhere, ever.
 *
 * Deliberately narrow. 230 of 398 trainee-titled researchers back a real account, so
 * archiving them would break those people's own access, and 95 appear on a served
 * page as ordinary lab members, which is information a student wants - a postdoc
 * belongs on a lab's member list, they just cannot be its lead (#2880).
 */
export function planTraineeRosterArchive(
  rows: readonly TraineeRosterRow[],
  isTraineeLevelTitle: (title?: string) => boolean,
): { archive: string[]; keptBecause: Record<string, number> } {
  const archive: string[] = [];
  const keptBecause: Record<string, number> = {
    'lead can host': 0,
    'backs a yale account': 0,
    'holds a role edge': 0,
  };
  for (const row of rows) {
    if (!isTraineeLevelTitle(row.title)) keptBecause['lead can host'] += 1;
    else if (row.hasAccount) keptBecause['backs a yale account'] += 1;
    else if (row.hasAnyRoleEdge) keptBecause['holds a role edge'] += 1;
    else archive.push(row.id);
  }
  return { archive, keptBecause };
}
