import {
  buildResearchAreasCardSummary,
  isVacuousGenericFocusSummary,
} from '../utils/researchEntityDescriptionQuality';

export interface VacuousFocusRepairEntityFacts {
  id: string;
  slug?: string;
  name?: string;
  shortDescription?: unknown;
  researchAreas?: unknown;
}

export interface VacuousFocusRepairPlanRow {
  id: string;
  slug?: string;
  name?: string;
  before: string;
  after: string;
  changed: boolean;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function planVacuousFocusRepairRow(
  facts: VacuousFocusRepairEntityFacts,
): VacuousFocusRepairPlanRow {
  const before = textValue(facts.shortDescription);
  const base = { id: facts.id, slug: facts.slug, name: facts.name, before };
  if (!isVacuousGenericFocusSummary(before)) {
    return { ...base, after: before, changed: false };
  }
  const after = buildResearchAreasCardSummary(facts.researchAreas);
  if (!after || after === before) {
    return { ...base, after: before, changed: false };
  }
  return { ...base, after, changed: true };
}

export interface VacuousFocusRepairSummary {
  considered: number;
  vacuous: number;
  changed: number;
  unresolved: number;
}

export function summarizeVacuousFocusRepair(
  rows: VacuousFocusRepairPlanRow[],
): VacuousFocusRepairSummary {
  let vacuous = 0;
  let changed = 0;
  for (const row of rows) {
    if (isVacuousGenericFocusSummary(row.before)) vacuous += 1;
    if (row.changed) changed += 1;
  }
  return {
    considered: rows.length,
    vacuous,
    changed,
    unresolved: vacuous - changed,
  };
}
