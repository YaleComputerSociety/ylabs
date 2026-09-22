import {
  endsWithChipSentenceStop,
  isSentenceShapedChip,
  sanitizeMethodChipLabel,
  stripChipSentenceStop,
} from '../utils/researchAreaLabelHygiene';

export const CHIP_REPAIR_FIELDS = [
  'researchAreas',
  'topics',
  'researchInterests',
  'methods',
] as const;
export type ChipRepairField = (typeof CHIP_REPAIR_FIELDS)[number];

export interface ChipListPlan {
  repaired: string[];
  refused: string[];
  trimmed: Array<{ before: string; after: string }>;
  changed: boolean;
}

const repairChip = (chip: string): string =>
  isSentenceShapedChip(chip) ? '' : stripChipSentenceStop(chip);

/**
 * `methods` and the research-area chip families share the sentence-shape rules but
 * not their denoisers, so each list is repaired through the sanitizer its own serve
 * path runs (#2553).
 */
const repairChipForField = (field: ChipRepairField, chip: string): string =>
  field === 'methods' ? sanitizeMethodChipLabel(chip) : repairChip(chip);

export function planChipList(field: ChipRepairField, values: unknown): ChipListPlan {
  const plan: ChipListPlan = { repaired: [], refused: [], trimmed: [], changed: false };
  if (!Array.isArray(values)) return plan;
  for (const raw of values) {
    if (typeof raw !== 'string') {
      plan.repaired.push(String(raw ?? ''));
      continue;
    }
    const collapsed = raw.replace(/\s+/g, ' ').trim();
    if (isSentenceShapedChip(collapsed)) {
      plan.refused.push(collapsed);
      plan.changed = true;
      continue;
    }
    const after = repairChipForField(field, collapsed);
    if (!after) {
      plan.refused.push(collapsed);
      plan.changed = true;
      continue;
    }
    if (after !== raw) {
      plan.changed = true;
      if (endsWithChipSentenceStop(collapsed)) plan.trimmed.push({ before: collapsed, after });
    }
    plan.repaired.push(after);
  }
  return plan;
}

export interface ChipRepairCounts {
  chipsRefused: number;
  chipsTrimmed: number;
  listsChanged: number;
  listsEmptied: number;
}

export const emptyChipRepairCounts = (): ChipRepairCounts => ({
  chipsRefused: 0,
  chipsTrimmed: 0,
  listsChanged: 0,
  listsEmptied: 0,
});

export function accumulateChipRepairCounts(counts: ChipRepairCounts, plan: ChipListPlan): void {
  if (!plan.changed) return;
  counts.chipsRefused += plan.refused.length;
  counts.chipsTrimmed += plan.trimmed.length;
  counts.listsChanged += 1;
  if (plan.repaired.length === 0) counts.listsEmptied += 1;
}
