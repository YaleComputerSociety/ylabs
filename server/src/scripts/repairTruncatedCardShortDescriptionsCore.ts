import { shortDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import { resolveGroundedCardDescription } from '../utils/groundedCardSynthesis';

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const lacksTerminalPunctuation = (value: string): boolean => {
  const trimmed = value.replace(/[)"'”’\]]+$/u, '');
  return trimmed.length > 0 && !/[.!?…]$/.test(trimmed);
};

export interface TruncatedCardRepairEntityFacts {
  id: string;
  slug?: string;
  name?: string;
  shortDescription?: unknown;
  fullDescription?: unknown;
  researchAreas?: unknown;
}

export interface TruncatedCardRepairPlanRow {
  id: string;
  slug?: string;
  name?: string;
  before: string;
  after: string;
  truncated: boolean;
  changed: boolean;
}

export async function planTruncatedCardRepairRow(
  facts: TruncatedCardRepairEntityFacts,
): Promise<TruncatedCardRepairPlanRow> {
  const before = textValue(facts.shortDescription);
  const full = textValue(facts.fullDescription);
  const base = { id: facts.id, slug: facts.slug, name: facts.name, before };
  const truncated = Boolean(before) && lacksTerminalPunctuation(before);
  if (!truncated) {
    return { ...base, after: before, truncated: false, changed: false };
  }
  const candidate = textValue(
    await resolveGroundedCardDescription({
      fullDescription: full,
      researchAreas: facts.researchAreas,
      synthesize: () => Promise.resolve(''),
    }),
  );
  if (!candidate || candidate === before || !shortDescriptionQuality(candidate, full).isUseful) {
    return { ...base, after: before, truncated: true, changed: false };
  }
  return { ...base, after: candidate, truncated: true, changed: true };
}

export interface TruncatedCardRepairSummary {
  considered: number;
  truncated: number;
  changed: number;
  unresolved: number;
}

export function summarizeTruncatedCardRepair(
  rows: TruncatedCardRepairPlanRow[],
): TruncatedCardRepairSummary {
  let truncated = 0;
  let changed = 0;
  for (const row of rows) {
    if (row.truncated) truncated += 1;
    if (row.changed) changed += 1;
  }
  return {
    considered: rows.length,
    truncated,
    changed,
    unresolved: truncated - changed,
  };
}
