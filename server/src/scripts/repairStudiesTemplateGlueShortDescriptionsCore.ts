import { isStudiesTemplateGlueMalformed } from '../utils/descriptionHygiene';
import { shortDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import { resolveGroundedCardDescription } from '../utils/groundedCardSynthesis';

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export interface StudiesTemplateGlueRepairEntityFacts {
  id: string;
  slug?: string;
  name?: string;
  shortDescription?: unknown;
  fullDescription?: unknown;
  researchAreas?: unknown;
}

export interface StudiesTemplateGlueRepairPlanRow {
  id: string;
  slug?: string;
  name?: string;
  before: string;
  after: string;
  malformed: boolean;
  changed: boolean;
}

export async function planStudiesTemplateGlueRepairRow(
  facts: StudiesTemplateGlueRepairEntityFacts,
): Promise<StudiesTemplateGlueRepairPlanRow> {
  const before = textValue(facts.shortDescription);
  const full = textValue(facts.fullDescription);
  const base = { id: facts.id, slug: facts.slug, name: facts.name, before };
  const malformed = Boolean(before) && isStudiesTemplateGlueMalformed(before);
  if (!malformed) {
    return { ...base, after: before, malformed: false, changed: false };
  }
  const candidate = textValue(
    await resolveGroundedCardDescription({
      fullDescription: full,
      researchAreas: facts.researchAreas,
      synthesize: () => Promise.resolve(''),
    }),
  );
  if (!candidate || candidate === before || !shortDescriptionQuality(candidate, full).isUseful) {
    return { ...base, after: before, malformed: true, changed: false };
  }
  return { ...base, after: candidate, malformed: true, changed: true };
}

export interface StudiesTemplateGlueRepairSummary {
  considered: number;
  malformed: number;
  changed: number;
  unresolved: number;
}

export function summarizeStudiesTemplateGlueRepair(
  rows: StudiesTemplateGlueRepairPlanRow[],
): StudiesTemplateGlueRepairSummary {
  let malformed = 0;
  let changed = 0;
  for (const row of rows) {
    if (row.malformed) malformed += 1;
    if (row.changed) changed += 1;
  }
  return {
    considered: rows.length,
    malformed,
    changed,
    unresolved: malformed - changed,
  };
}
