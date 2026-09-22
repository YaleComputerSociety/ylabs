import {
  personNameNoiseShapes,
  sanitizePersonName,
  type PersonNameNoiseShape,
} from '../utils/personNameHygiene';

export interface PersonNameRow {
  id: string;
  displayName: string;
}

export interface PersonNameRewrite {
  id: string;
  from: string;
  to: string;
  shapes: PersonNameNoiseShape[];
}

export type PersonNameRefusal = 'already-clean' | 'not-a-name' | 'would-empty-the-name';

export interface PersonNameRepairPlan {
  rewrite: PersonNameRewrite[];
  refused: Array<{ id: string; reason: PersonNameRefusal }>;
}

/**
 * Plans the stored-name rewrites for the served-name hygiene repair.
 *
 * Fails closed in the one direction that matters: a value the sanitizer reads as
 * an identifier rather than a name is REFUSED, not blanked. Nothing can recover a
 * name from `<surname>_<given>`, and a lead with no name is a worse page than a
 * lead named by a slug (#2385), so those rows are counted and reported for a lane
 * that can find a real name rather than repaired here.
 */
export function planPersonNameRepair(rows: readonly PersonNameRow[]): PersonNameRepairPlan {
  const rewrite: PersonNameRewrite[] = [];
  const refused: Array<{ id: string; reason: PersonNameRefusal }> = [];

  for (const row of rows) {
    const shapes = personNameNoiseShapes(row.displayName);
    if (shapes.length === 0) {
      refused.push({ id: row.id, reason: 'already-clean' });
      continue;
    }
    if (shapes.includes('non-name-identifier')) {
      refused.push({ id: row.id, reason: 'not-a-name' });
      continue;
    }
    const cleaned = sanitizePersonName(row.displayName);
    if (!cleaned) {
      refused.push({ id: row.id, reason: 'would-empty-the-name' });
      continue;
    }
    if (cleaned === row.displayName.trim()) {
      refused.push({ id: row.id, reason: 'already-clean' });
      continue;
    }
    rewrite.push({ id: row.id, from: row.displayName, to: cleaned, shapes });
  }

  return { rewrite, refused };
}

export function summarizePersonNameRefusals(
  refused: ReadonlyArray<{ reason: PersonNameRefusal }>,
): Record<PersonNameRefusal, number> {
  const counts: Record<PersonNameRefusal, number> = {
    'already-clean': 0,
    'not-a-name': 0,
    'would-empty-the-name': 0,
  };
  for (const entry of refused) counts[entry.reason] += 1;
  return counts;
}

export function summarizePersonNameShapes(
  rewrite: ReadonlyArray<PersonNameRewrite>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rewrite) {
    for (const shape of row.shapes) counts[shape] = (counts[shape] || 0) + 1;
  }
  return counts;
}
