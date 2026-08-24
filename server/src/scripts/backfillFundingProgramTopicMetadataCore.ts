import { applyResearchEntityOrgUnitCanonicalization } from '../scrapers/orgUnitCanonicalization';
import { applyResearchEntityResearchAreaCanonicalization } from '../scrapers/researchAreaCanonicalization';
import { deriveFundingProgramTopic } from '../scrapers/fundingProgramTopicDerivation';

export interface FundingProgramTopicBackfillEntity {
  id: string;
  slug?: string;
  name?: string;
  fullDescription?: string;
  school?: unknown;
  departments?: unknown;
  researchAreas?: unknown;
}

export interface FundingProgramTopicBackfillPlanRow {
  id: string;
  slug?: string;
  name?: string;
  update: Record<string, unknown>;
  changed: boolean;
}

export interface FundingProgramTopicBackfillSummary {
  scanned: number;
  changed: number;
  departmentsAdded: number;
  researchAreasAdded: number;
  unmapped: number;
}

function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Plans a departments/researchAreas backfill for a single FELLOWSHIP_PROGRAM
 * or RA_PROGRAM entity that has neither field set (issue #1700). Reuses the
 * same curated derivation and canonicalization pipeline the materializer
 * applies at write time, so a re-scrape and this one-off backfill can never
 * disagree on the same entity. Entities with an existing non-empty
 * departments or researchAreas value are left untouched, and entities whose
 * name/description does not name a known sponsor/department are reported as
 * unmapped rather than forced to a guessed value.
 */
export async function planFundingProgramTopicBackfillRow(
  entity: FundingProgramTopicBackfillEntity,
): Promise<FundingProgramTopicBackfillPlanRow> {
  const row: FundingProgramTopicBackfillPlanRow = {
    id: entity.id,
    slug: entity.slug,
    name: entity.name,
    update: {},
    changed: false,
  };
  if (isNonEmptyArray(entity.departments) || isNonEmptyArray(entity.researchAreas)) return row;

  const topic = deriveFundingProgramTopic(entity.name, entity.fullDescription);
  if (!topic.department && !topic.researchArea) return row;

  const set: Record<string, unknown> = {};
  if (topic.department) set.departments = [topic.department];
  if (topic.researchArea) set.researchAreas = [topic.researchArea];

  await applyResearchEntityOrgUnitCanonicalization(
    set,
    { school: entity.school, departments: entity.departments },
    [],
  );
  await applyResearchEntityResearchAreaCanonicalization(set, set.departments);

  if (isNonEmptyArray(set.departments)) row.update.departments = set.departments;
  if (isNonEmptyArray(set.researchAreas)) row.update.researchAreas = set.researchAreas;
  if (isNonEmptyArray(set.schools)) row.update.schools = set.schools;
  if (typeof set.school === 'string' && set.school) row.update.school = set.school;

  row.changed = Object.keys(row.update).length > 0;
  return row;
}

export function summarizeFundingProgramTopicBackfill(
  rows: FundingProgramTopicBackfillPlanRow[],
): FundingProgramTopicBackfillSummary {
  const changed = rows.filter((row) => row.changed);
  return {
    scanned: rows.length,
    changed: changed.length,
    departmentsAdded: changed.filter((row) => 'departments' in row.update).length,
    researchAreasAdded: changed.filter((row) => 'researchAreas' in row.update).length,
    unmapped: rows.length - changed.length,
  };
}
