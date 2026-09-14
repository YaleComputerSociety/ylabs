import { DepartmentCategory, categoryColorKeys } from '../models/department';
import { sameOrgUnitMatchKey as sameName } from '../scrapers/orgUnitCanonicalization';
import {
  OFFICIAL_DEPARTMENT_INDEX_URL,
  OFFICIAL_DEPARTMENT_RENAMES,
  aliasesAfterAdoptingName,
  type OfficialDepartmentRename,
} from './officialDepartmentNames';

const OFFICIAL_INDEX_SOURCE = `Yale official department index ${OFFICIAL_DEPARTMENT_INDEX_URL}`;

/**
 * The `departments` display table supplies each department's label, colour, and
 * abbreviation, and `research.tsx` also uses its `name` and `displayName`
 * verbatim as Meilisearch filter values when it builds a department search
 * target. So this table has to carry the same canonical spelling `org_units`
 * does: a table left behind after the org-unit rename produces a department
 * search target that filters on a string no stored row holds any more.
 *
 * The table is a curated subset of the org chart rather than a mirror of it, so
 * a rename with no matching row is reported as absent rather than blocked.
 */
export interface DepartmentDisplayRow {
  id: string;
  abbreviation: string;
  name: string;
  displayName?: string;
  aliases?: string[];
  isActive?: boolean;
}

export interface DepartmentDisplayRenamePlan {
  action: 'rename';
  targetId: string;
  abbreviation: string;
  fromName: string;
  toName: string;
  displayName: string;
  aliases: string[];
  source: string;
}

export interface DepartmentDisplayAliasRepairPlan {
  action: 'repair-aliases';
  targetId: string;
  abbreviation: string;
  removedAliases: string[];
  aliases: string[];
  source: string;
}

export interface DepartmentDisplayCreatePlan {
  action: 'create';
  abbreviation: string;
  name: string;
  displayName: string;
  categories: DepartmentCategory[];
  primaryCategory: DepartmentCategory;
  colorKey: number;
  aliases: string[];
  source: string;
}

export type DepartmentDisplayPlanRow =
  | DepartmentDisplayRenamePlan
  | DepartmentDisplayAliasRepairPlan
  | DepartmentDisplayCreatePlan;

export interface DepartmentDisplayPlan {
  rows: DepartmentDisplayPlanRow[];
  satisfied: string[];
  absent: string[];
  blocked: { gap: string; reason: string }[];
}

/**
 * A rename the shared official-name table cannot express because the display
 * table spells the unit differently again.
 */
export const DEPARTMENT_DISPLAY_RENAMES: readonly {
  abbreviation: string;
  toName: string;
  source: string;
}[] = [
  {
    // One row stands in for what the index lists as two units, and `org_units`
    // carries as two live rows. Adopting the FAS department's name keeps the
    // HSHM abbreviation with the unit that uses it; the YSM department keeps
    // resolving through the retained alias, so both stored values still find a
    // label and a colour.
    abbreviation: 'HSHM',
    toName: 'History of Science & Medicine',
    source: `${OFFICIAL_INDEX_SOURCE} -> https://hshm.yale.edu/`,
  },
];

export const DEPARTMENT_DISPLAY_ALIAS_REPAIRS: readonly {
  abbreviation: string;
  removeAliases: string[];
  source: string;
}[] = [
  {
    // `["Molecular", "Cellular & Developmental Biology"]` is one department name
    // split on its comma. The bare token "Molecular" matches far more than the
    // department, and the fragment matches nothing.
    abbreviation: 'MCDB',
    removeAliases: ['Molecular', 'Cellular & Developmental Biology'],
    source: 'comma-split alias fragments of a single department name',
  },
];

const SOM_SOURCE =
  'org_units department under School of Management, serving rows the facet already offers (#2711)';
const YSM_SECTION_SOURCE =
  'org_units department under Internal Medicine, serving rows the facet already offers (#2711)';
const PEDIATRICS_SECTION_SOURCE =
  'org_units department under Pediatrics, serving rows the facet already offers (#2711)';

export type DepartmentAdditionProvenance = 'official-index' | 'served-facet';

/**
 * Which justification an addition rests on, and therefore what can vouch for its
 * spelling. A row the published index names is spell-checked against the
 * `departments.txt` snapshot of that index. A row the index does not name rests on
 * `org_units` plus the served corpus instead, so only the department facet can
 * vouch for it, and `planDepartmentDisplayAlignment` checks it there.
 */
export const additionProvenance = (source: string): DepartmentAdditionProvenance =>
  source.startsWith(OFFICIAL_INDEX_SOURCE) ? 'official-index' : 'served-facet';

/**
 * A department the facet already offers that has no display-table row, so it
 * renders without the colour its neighbours get and no department search target
 * exists for it.
 *
 * Yale's official index cannot source these: it does not enumerate a clinical
 * section, a School of Management department, or the YSPH Social & Behavioral
 * Sciences department. `org_units` does, and each row below serves rows today, so
 * the justification is the catalog plus the served corpus rather than the index.
 *
 * Two consequences of that, both deliberate:
 *
 * Categories are copied from the unit's parent rather than judged fresh - every
 * Internal Medicine and Pediatrics section takes its parent's `Health & Medicine`,
 * and every School of Management department takes the school's `Economics`
 * primary so the five read as one school in the palette. `Social Sciences` is
 * added where the discipline genuinely spans it, following the existing
 * `Health Policy & Management` shape.
 *
 * Abbreviations for the clinical sections are derived from the department name,
 * not published by Yale the way `departments.txt` publishes `ASTR` or `CEE`.
 * `abbreviation` is required and uniquely indexed, so a row cannot exist without
 * one; treat these as display keys rather than as Yale codes, and prefer a
 * published code if one is ever found.
 *
 * Because the index cannot vouch for these spellings, the served department facet
 * has to: `name` reaches the search filter verbatim, so a row spelled even a
 * comma or an ampersand away from the stored facet value renders a label and a
 * colour over a filter that matches nothing. `planDepartmentDisplayAlignment`
 * blocks such a row when the caller supplies `servedFacetValues`.
 */
export const DEPARTMENT_DISPLAY_ADDITIONS: readonly {
  abbreviation: string;
  name: string;
  categories: DepartmentCategory[];
  primaryCategory: DepartmentCategory;
  aliases: string[];
  source: string;
}[] = [
  {
    abbreviation: 'LABM',
    name: 'Laboratory Medicine',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: `${OFFICIAL_INDEX_SOURCE}; org_units carries the department and serves rows under it`,
  },
  {
    abbreviation: 'IDE',
    name: 'International & Development Economics',
    categories: [DepartmentCategory.ECONOMICS, DepartmentCategory.SOCIAL_SCIENCES],
    primaryCategory: DepartmentCategory.ECONOMICS,
    aliases: ['International and Development Economics'],
    source: `${OFFICIAL_INDEX_SOURCE}; org_units carries the department`,
  },
  {
    abbreviation: 'CVMD',
    name: 'Cardiovascular Medicine',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: YSM_SECTION_SOURCE,
  },
  {
    abbreviation: 'DIGD',
    name: 'Digestive Diseases',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: YSM_SECTION_SOURCE,
  },
  {
    abbreviation: 'ENDO',
    name: 'Endocrinology',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: YSM_SECTION_SOURCE,
  },
  {
    abbreviation: 'NEPH',
    name: 'Nephrology',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: YSM_SECTION_SOURCE,
  },
  {
    abbreviation: 'HEMA',
    name: 'Hematology',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: YSM_SECTION_SOURCE,
  },
  {
    abbreviation: 'INFD',
    name: 'Infectious Diseases',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: YSM_SECTION_SOURCE,
  },
  {
    abbreviation: 'PCCS',
    name: 'Pulmonary, Critical Care & Sleep Medicine',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: YSM_SECTION_SOURCE,
  },
  {
    abbreviation: 'MONC',
    name: 'Medical Oncology and Hematology',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: YSM_SECTION_SOURCE,
  },
  {
    abbreviation: 'RAI',
    name: 'Rheumatology, Allergy & Immunology',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: YSM_SECTION_SOURCE,
  },
  {
    abbreviation: 'GERI',
    name: 'Geriatric Medicine',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: YSM_SECTION_SOURCE,
  },
  {
    abbreviation: 'PDNE',
    name: 'Pediatric Nephrology',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: PEDIATRICS_SECTION_SOURCE,
  },
  {
    abbreviation: 'PDEM',
    name: 'Pediatric Emergency Medicine',
    categories: [DepartmentCategory.HEALTH_MEDICINE],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: [],
    source: PEDIATRICS_SECTION_SOURCE,
  },
  {
    abbreviation: 'ACCT',
    name: 'Accounting',
    categories: [DepartmentCategory.ECONOMICS],
    primaryCategory: DepartmentCategory.ECONOMICS,
    aliases: [],
    source: SOM_SOURCE,
  },
  {
    abbreviation: 'FIN',
    name: 'Finance',
    categories: [DepartmentCategory.ECONOMICS],
    primaryCategory: DepartmentCategory.ECONOMICS,
    aliases: [],
    source: SOM_SOURCE,
  },
  {
    abbreviation: 'MKTG',
    name: 'Marketing',
    categories: [DepartmentCategory.ECONOMICS, DepartmentCategory.SOCIAL_SCIENCES],
    primaryCategory: DepartmentCategory.ECONOMICS,
    aliases: [],
    source: SOM_SOURCE,
  },
  {
    abbreviation: 'OPRN',
    name: 'Operations',
    categories: [DepartmentCategory.ECONOMICS, DepartmentCategory.SOCIAL_SCIENCES],
    primaryCategory: DepartmentCategory.ECONOMICS,
    aliases: ['Operations Management'],
    source: SOM_SOURCE,
  },
  {
    abbreviation: 'OB',
    name: 'Organizational Behavior',
    categories: [DepartmentCategory.ECONOMICS, DepartmentCategory.SOCIAL_SCIENCES],
    primaryCategory: DepartmentCategory.ECONOMICS,
    aliases: ['Organisational Behavior'],
    source: SOM_SOURCE,
  },
  {
    abbreviation: 'SBS',
    name: 'Social and Behavioral Sciences',
    categories: [DepartmentCategory.HEALTH_MEDICINE, DepartmentCategory.SOCIAL_SCIENCES],
    primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
    aliases: ['Social and Behavioral Sciences (SBS)'],
    source:
      'org_units department under School of Public Health, serving rows the facet already offers (#2711)',
  },
];

export const displayNameFor = (abbreviation: string, name: string): string =>
  `${abbreviation} - ${name}`;

function renameRow(
  row: DepartmentDisplayRow,
  toName: string,
  source: string,
): DepartmentDisplayRenamePlan {
  const aliases = aliasesAfterAdoptingName(row.aliases || [], row.name, toName);
  const fromName = row.name;
  row.name = toName;
  row.aliases = aliases;
  return {
    action: 'rename',
    targetId: row.id,
    abbreviation: row.abbreviation,
    fromName,
    toName,
    displayName: displayNameFor(row.abbreviation, toName),
    aliases,
    source,
  };
}

/**
 * Idempotent plan. Renames run before additions so an index entry that only
 * looked missing under its stale name is not created a second time.
 */
export function planDepartmentDisplayAlignment(
  existing: DepartmentDisplayRow[],
  spec: {
    officialRenames?: readonly OfficialDepartmentRename[];
    displayRenames?: typeof DEPARTMENT_DISPLAY_RENAMES;
    aliasRepairs?: typeof DEPARTMENT_DISPLAY_ALIAS_REPAIRS;
    additions?: typeof DEPARTMENT_DISPLAY_ADDITIONS;
    servedFacetValues?: readonly string[];
  } = {},
): DepartmentDisplayPlan {
  const officialRenames = spec.officialRenames ?? OFFICIAL_DEPARTMENT_RENAMES;
  const displayRenames = spec.displayRenames ?? DEPARTMENT_DISPLAY_RENAMES;
  const aliasRepairs = spec.aliasRepairs ?? DEPARTMENT_DISPLAY_ALIAS_REPAIRS;
  const additions = spec.additions ?? DEPARTMENT_DISPLAY_ADDITIONS;
  const servedFacetValues = spec.servedFacetValues;

  const rows: DepartmentDisplayPlanRow[] = [];
  const satisfied: string[] = [];
  const absent: string[] = [];
  const blocked: { gap: string; reason: string }[] = [];
  const working = existing.map((row) => ({ ...row, aliases: [...(row.aliases || [])] }));
  // `configService` serves `isActive: true`, which in Mongo excludes a legacy row
  // that has no such field at all, so a row this planner treats as active has to
  // clear the same bar or the plan reports a rename nobody can read.
  const active = (): DepartmentDisplayRow[] => working.filter((row) => row.isActive === true);

  for (const gap of displayRenames) {
    const target = working.find((row) => row.abbreviation === gap.abbreviation);
    if (!target) {
      absent.push(`${gap.abbreviation} (${gap.toName})`);
      continue;
    }
    if (target.name === gap.toName) {
      satisfied.push(`${gap.abbreviation} already named ${gap.toName}`);
      continue;
    }
    rows.push(renameRow(target, gap.toName, gap.source));
  }

  for (const rename of officialRenames) {
    const drifted = active().find(
      (row) => sameName(row.name, rename.priorName) && row.name !== rename.officialName,
    );
    const adopter = active().find((row) => row.name === rename.officialName);
    if (adopter && drifted) {
      // Two served rows for one published name: renaming either would leave the
      // other's search target filtering on a name no stored row holds, and which
      // row wins is a product call rather than this script's to make.
      blocked.push({
        gap: rename.officialName,
        reason: `${adopter.abbreviation} already carries that name while ${drifted.abbreviation} still carries ${rename.priorName}`,
      });
      continue;
    }
    if (adopter) {
      satisfied.push(`${rename.officialName} already named`);
      continue;
    }
    if (!drifted) {
      absent.push(rename.officialName);
      continue;
    }
    const source = rename.linkedUnit
      ? `${OFFICIAL_INDEX_SOURCE} -> ${rename.linkedUnit}`
      : OFFICIAL_INDEX_SOURCE;
    rows.push(renameRow(drifted, rename.officialName, source));
  }

  for (const repair of aliasRepairs) {
    const target = working.find((row) => row.abbreviation === repair.abbreviation);
    if (!target) {
      absent.push(`${repair.abbreviation} aliases`);
      continue;
    }
    const currentAliases = target.aliases || [];
    const removedAliases = currentAliases.filter((alias) =>
      repair.removeAliases.some((doomed) => sameName(alias, doomed)),
    );
    if (removedAliases.length === 0) {
      satisfied.push(`${repair.abbreviation} aliases`);
      continue;
    }
    const aliases = currentAliases.filter((alias) => !removedAliases.includes(alias));
    target.aliases = aliases;
    rows.push({
      action: 'repair-aliases',
      targetId: target.id,
      abbreviation: target.abbreviation,
      removedAliases,
      aliases,
      source: repair.source,
    });
  }

  for (const addition of additions) {
    const abbreviationHolder = working.find((row) => row.abbreviation === addition.abbreviation);
    // Satisfied beats blocked when the holder is the row a previous run created,
    // otherwise the second run reports its own work as a collision.
    if (abbreviationHolder && !sameName(abbreviationHolder.name, addition.name)) {
      blocked.push({
        gap: addition.name,
        reason: `abbreviation ${addition.abbreviation} already taken`,
      });
      continue;
    }
    // `abbreviation` is uniquely indexed across the whole collection, so an
    // inactive holder still makes the insert impossible; planning a create would
    // throw partway through an apply that has already written earlier rows.
    if (abbreviationHolder && abbreviationHolder.isActive !== true) {
      blocked.push({
        gap: addition.name,
        reason: `abbreviation ${addition.abbreviation} held by an inactive row`,
      });
      continue;
    }
    const resolvable = active().find(
      (row) =>
        sameName(row.name, addition.name) ||
        (row.aliases || []).some((alias) => sameName(alias, addition.name)),
    );
    if (resolvable) {
      satisfied.push(`${addition.name} (already ${resolvable.abbreviation})`);
      continue;
    }
    // A row the published index does not name is justified only by the facet
    // serving it, and `research.tsx` filters on `name` verbatim, so an alias
    // cannot rescue a spelling the corpus does not hold: the row would render a
    // label and a colour over a department filter that matches nothing.
    if (servedFacetValues && additionProvenance(addition.source) === 'served-facet') {
      const servedSpelling = servedFacetValues.find((value) => sameName(value, addition.name));
      if (servedSpelling !== addition.name) {
        blocked.push({
          gap: addition.name,
          reason: servedSpelling
            ? `the department facet serves it as ${servedSpelling}, which research.tsx filters on verbatim`
            : 'no served entity carries that department facet value',
        });
        continue;
      }
    }
    working.push({
      id: `pending:${addition.abbreviation}`,
      abbreviation: addition.abbreviation,
      name: addition.name,
      aliases: [...addition.aliases],
      isActive: true,
    });
    rows.push({
      action: 'create',
      abbreviation: addition.abbreviation,
      name: addition.name,
      displayName: displayNameFor(addition.abbreviation, addition.name),
      categories: [...addition.categories],
      primaryCategory: addition.primaryCategory,
      colorKey: categoryColorKeys[addition.primaryCategory],
      aliases: [...addition.aliases],
      source: addition.source,
    });
  }

  return { rows, satisfied, absent, blocked };
}

export function summarizeDepartmentDisplayPlan(plan: DepartmentDisplayPlan): {
  renamed: number;
  aliasRepairs: number;
  created: number;
  satisfied: number;
  absent: number;
  blocked: number;
} {
  return {
    renamed: plan.rows.filter((row) => row.action === 'rename').length,
    aliasRepairs: plan.rows.filter((row) => row.action === 'repair-aliases').length,
    created: plan.rows.filter((row) => row.action === 'create').length,
    satisfied: plan.satisfied.length,
    absent: plan.absent.length,
    blocked: plan.blocked.length,
  };
}
