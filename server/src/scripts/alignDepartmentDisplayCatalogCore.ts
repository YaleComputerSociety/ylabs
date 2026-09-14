import { DepartmentCategory, categoryColorKeys } from '../models/department';
import {
  OFFICIAL_DEPARTMENT_INDEX_URL,
  OFFICIAL_DEPARTMENT_RENAMES,
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

/** Index entries with no display-table row, so a served department has no label or colour. */
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
];

export const displayNameFor = (abbreviation: string, name: string): string =>
  `${abbreviation} - ${name}`;

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const sameName = (left: string, right: string): boolean =>
  Boolean(normalize(left)) && normalize(left) === normalize(right);

function renameRow(
  row: DepartmentDisplayRow,
  toName: string,
  source: string,
): DepartmentDisplayRenamePlan {
  const aliases = [...(row.aliases || []).filter((alias) => !sameName(alias, toName)), row.name];
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
  } = {},
): DepartmentDisplayPlan {
  const officialRenames = spec.officialRenames ?? OFFICIAL_DEPARTMENT_RENAMES;
  const displayRenames = spec.displayRenames ?? DEPARTMENT_DISPLAY_RENAMES;
  const aliasRepairs = spec.aliasRepairs ?? DEPARTMENT_DISPLAY_ALIAS_REPAIRS;
  const additions = spec.additions ?? DEPARTMENT_DISPLAY_ADDITIONS;

  const rows: DepartmentDisplayPlanRow[] = [];
  const satisfied: string[] = [];
  const absent: string[] = [];
  const blocked: { gap: string; reason: string }[] = [];
  const working = existing.map((row) => ({ ...row, aliases: [...(row.aliases || [])] }));
  const active = (): DepartmentDisplayRow[] => working.filter((row) => row.isActive !== false);

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
    const alreadyAdopted = active().find((row) => row.name === rename.officialName);
    if (alreadyAdopted) {
      satisfied.push(`${rename.officialName} already named`);
      continue;
    }
    const target = active().find((row) => sameName(row.name, rename.priorName));
    if (!target) {
      absent.push(rename.officialName);
      continue;
    }
    const source = rename.linkedUnit
      ? `${OFFICIAL_INDEX_SOURCE} -> ${rename.linkedUnit}`
      : OFFICIAL_INDEX_SOURCE;
    rows.push(renameRow(target, rename.officialName, source));
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
    const resolvable = active().find(
      (row) =>
        sameName(row.name, addition.name) ||
        (row.aliases || []).some((alias) => sameName(alias, addition.name)),
    );
    if (resolvable) {
      satisfied.push(`${addition.name} (already ${resolvable.abbreviation})`);
      continue;
    }
    working.push({
      id: `pending:${addition.abbreviation}`,
      abbreviation: addition.abbreviation,
      name: addition.name,
      aliases: [...addition.aliases],
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
