import { orgUnitMatchKey } from '../scrapers/orgUnitCanonicalization';
import type { OrgUnitKind } from '../models/orgUnit';

/**
 * A canonical department the curated `DEFAULT_DEPT_CONFIGS` roster map asserts
 * exists but `org_units` does not carry yet, or carries under a name the roster
 * spells differently. `departments[]` is fail-closed against this catalog, so a
 * genuine department missing from it disappears from the browse department facet
 * (#2194); every row here is therefore justified by a checked-in source rather
 * than by recollection of Yale's org chart.
 */
export interface OrgUnitAliasGap {
  action: 'add-aliases';
  targetName: string;
  aliases: string[];
  source: string;
}

export interface OrgUnitDepartmentGap {
  action: 'create-department';
  name: string;
  slug: string;
  parentName: string;
  aliases: string[];
  source: string;
}

export type OrgUnitCatalogGap = OrgUnitAliasGap | OrgUnitDepartmentGap;

const ROSTER_CONFIG_SOURCE = 'departmentRosterScraper DEFAULT_DEPT_CONFIGS';

export const ORG_UNIT_CATALOG_GAPS: readonly OrgUnitCatalogGap[] = [
  {
    action: 'create-department',
    name: 'Social and Behavioral Sciences',
    slug: 'social-and-behavioral-sciences',
    parentName: 'School of Public Health',
    aliases: ['Social and Behavioral Sciences (SBS)'],
    source: `${ROSTER_CONFIG_SOURCE} ysph-social-behavioral-sciences`,
  },
  {
    action: 'add-aliases',
    targetName: 'German Studies',
    aliases: ['Germanic Languages & Literatures'],
    source: `${ROSTER_CONFIG_SOURCE} german`,
  },
  {
    action: 'add-aliases',
    targetName: 'Italian Studies',
    aliases: ['Italian Language and Literature'],
    source: `${ROSTER_CONFIG_SOURCE} italian`,
  },
  {
    action: 'add-aliases',
    targetName: 'History of Science and Medicine',
    aliases: ['History of Science, Medicine & Public Health'],
    source: `${ROSTER_CONFIG_SOURCE} history-science-medicine-public-health`,
  },
  // The Divinity School roster stamps the school-level label "Divinity" as a
  // department. Aliasing it onto the school makes the existing school-is-not-a-
  // department rule (#1384) recognize and drop it instead of publishing it as a
  // fake peer department.
  {
    action: 'add-aliases',
    targetName: 'Divinity School',
    aliases: ['Divinity'],
    source: `${ROSTER_CONFIG_SOURCE} divinity`,
  },
];

export interface ExistingOrgUnitRow {
  id: string;
  name: string;
  slug: string;
  kind: OrgUnitKind;
  aliases?: string[];
}

export interface OrgUnitSeedAliasPlan {
  action: 'add-aliases';
  targetId: string;
  targetName: string;
  addedAliases: string[];
  aliases: string[];
  source: string;
}

export interface OrgUnitSeedCreatePlan {
  action: 'create-department';
  name: string;
  slug: string;
  aliases: string[];
  parentName: string;
  parentId: string;
  source: string;
}

export type OrgUnitSeedPlanRow = OrgUnitSeedAliasPlan | OrgUnitSeedCreatePlan;

export interface OrgUnitSeedPlan {
  rows: OrgUnitSeedPlanRow[];
  satisfied: string[];
  blocked: { gap: string; reason: string }[];
}

const sameMatchKey = (left: string, right: string): boolean =>
  Boolean(orgUnitMatchKey(left)) && orgUnitMatchKey(left) === orgUnitMatchKey(right);

function findByName(rows: ExistingOrgUnitRow[], name: string): ExistingOrgUnitRow | undefined {
  return rows.find((row) => sameMatchKey(row.name, name));
}

function resolvesAlready(
  rows: ExistingOrgUnitRow[],
  value: string,
  kinds: OrgUnitKind[],
): ExistingOrgUnitRow | undefined {
  return rows.find(
    (row) =>
      kinds.includes(row.kind) &&
      [row.name, row.slug, ...(row.aliases || [])].some((candidate) =>
        sameMatchKey(candidate, value),
      ),
  );
}

/**
 * Idempotent plan: an alias already present, or a department row that already
 * exists, is reported as satisfied rather than rewritten, so the script is safe
 * to re-run in every environment.
 */
export function planOrgUnitCatalogGapSeed(
  existing: ExistingOrgUnitRow[],
  gaps: readonly OrgUnitCatalogGap[] = ORG_UNIT_CATALOG_GAPS,
): OrgUnitSeedPlan {
  const rows: OrgUnitSeedPlanRow[] = [];
  const satisfied: string[] = [];
  const blocked: { gap: string; reason: string }[] = [];

  for (const gap of gaps) {
    if (gap.action === 'add-aliases') {
      const target = findByName(existing, gap.targetName);
      if (!target) {
        blocked.push({ gap: gap.targetName, reason: 'target org unit not found' });
        continue;
      }
      const currentAliases = target.aliases || [];
      const addedAliases = gap.aliases.filter(
        (alias) =>
          !sameMatchKey(target.name, alias) &&
          !currentAliases.some((existingAlias) => sameMatchKey(existingAlias, alias)),
      );
      if (addedAliases.length === 0) {
        satisfied.push(`${gap.targetName} aliases`);
        continue;
      }
      rows.push({
        action: 'add-aliases',
        targetId: target.id,
        targetName: target.name,
        addedAliases,
        aliases: [...currentAliases, ...addedAliases],
        source: gap.source,
      });
      continue;
    }

    const collision = resolvesAlready(existing, gap.name, ['DEPARTMENT', 'DIVISION']);
    if (collision) {
      satisfied.push(`${gap.name} (already ${collision.kind} ${collision.name})`);
      continue;
    }
    const parent = findByName(existing, gap.parentName);
    if (!parent) {
      blocked.push({ gap: gap.name, reason: `parent ${gap.parentName} not found` });
      continue;
    }
    if (existing.some((row) => row.slug === gap.slug)) {
      blocked.push({ gap: gap.name, reason: `slug ${gap.slug} already taken` });
      continue;
    }
    rows.push({
      action: 'create-department',
      name: gap.name,
      slug: gap.slug,
      aliases: gap.aliases,
      parentName: parent.name,
      parentId: parent.id,
      source: gap.source,
    });
  }

  return { rows, satisfied, blocked };
}

export function summarizeOrgUnitSeedPlan(plan: OrgUnitSeedPlan): {
  created: number;
  aliasUpdates: number;
  satisfied: number;
  blocked: number;
} {
  return {
    created: plan.rows.filter((row) => row.action === 'create-department').length,
    aliasUpdates: plan.rows.filter((row) => row.action === 'add-aliases').length,
    satisfied: plan.satisfied.length,
    blocked: plan.blocked.length,
  };
}
