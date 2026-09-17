import { sameOrgUnitMatchKey as sameMatchKey } from '../scrapers/orgUnitCanonicalization';
import type { OrgUnitKind, OrgUnitStatus } from '../models/orgUnit';
import {
  OFFICIAL_DEPARTMENT_INDEX_URL,
  OFFICIAL_DEPARTMENT_RENAMES,
  aliasesAfterAdoptingName,
} from './officialDepartmentNames';

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
  /**
   * `SECTION` when the unit sits below the department altitude, which is how the
   * School of Medicine states most appointments ("Section of General Internal
   * Medicine, Department of Internal Medicine"). Defaults to `DEPARTMENT`.
   */
  kind?: 'DEPARTMENT' | 'SECTION';
}

/** Adopts a published name, demoting the name the row carried to an alias. */
export interface OrgUnitRenameGap {
  action: 'rename-department';
  fromName: string;
  toName: string;
  source: string;
}

/**
 * Drops an alias that names a unit other than its row. Targeted by slug rather
 * than by name because the alias being removed is by definition ambiguous, and
 * an archived row may be the target.
 */
export interface OrgUnitAliasRemovalGap {
  action: 'remove-aliases';
  targetSlug: string;
  aliases: string[];
  source: string;
}

export type OrgUnitCatalogGap =
  | OrgUnitAliasGap
  | OrgUnitDepartmentGap
  | OrgUnitRenameGap
  | OrgUnitAliasRemovalGap;

const ROSTER_CONFIG_SOURCE = 'departmentRosterScraper DEFAULT_DEPT_CONFIGS';
const OFFICIAL_INDEX_SOURCE = `Yale official department index ${OFFICIAL_DEPARTMENT_INDEX_URL}`;
const SURGERY_DIVISIONS_SOURCE =
  'Yale School of Medicine Department of Surgery division list https://medicine.yale.edu/surgery/';
const PEDIATRICS_SECTIONS_SOURCE =
  'Yale School of Medicine Department of Pediatrics section list https://medicine.yale.edu/pediatrics/';
const HR_DIRECTORY_SOURCE =
  'Yale HR/directory org string observed on researchers whose research home carries no department';

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
  ...OFFICIAL_DEPARTMENT_RENAMES.map(
    (rename): OrgUnitRenameGap => ({
      action: 'rename-department',
      fromName: rename.priorName,
      toName: rename.officialName,
      source: rename.linkedUnit
        ? `${OFFICIAL_INDEX_SOURCE} -> ${rename.linkedUnit}`
        : OFFICIAL_INDEX_SOURCE,
    }),
  ),
  // The index links "Environment" to environment.yale.edu, the School of the
  // Environment, not to the FAS Environmental Studies programme the alias sits
  // on today. Moving it onto the school lets the school-is-not-a-department rule
  // (#1384) drop the label instead of publishing a school as a fake peer
  // department, the same treatment "Divinity" already gets above.
  {
    action: 'remove-aliases',
    targetSlug: 'environmental-studies',
    aliases: ['Environment'],
    source: `${OFFICIAL_INDEX_SOURCE} -> https://environment.yale.edu/`,
  },
  {
    action: 'add-aliases',
    targetName: 'School of the Environment',
    aliases: ['Environment'],
    source: `${OFFICIAL_INDEX_SOURCE} -> https://environment.yale.edu/`,
  },
  // Both aliases name a live row of their own - the FAS department at
  // hshm.yale.edu and the YSM department at medicine.yale.edu/histmed - so on an
  // archived row they are dead weight that makes any tool loading the whole
  // catalog resolve those two names by insertion order. The serve-time
  // canonicalizer already excludes archived and INACTIVE rows, so removing them
  // changes no served value.
  {
    action: 'remove-aliases',
    targetSlug: 'history-of-science-medicine-and-public-health',
    aliases: ['History of Science & Medicine', 'History of Medicine'],
    source: `${OFFICIAL_INDEX_SOURCE} lists both units separately`,
  },
  // School of Medicine sections, from each department's own published division
  // list. A YSM appointment is usually stated at the section, so a missing
  // section row is why a served row carries a school and no department at all:
  // the lead's own home department resolves to nothing and the #2802 inheritance
  // fails closed.
  {
    action: 'create-department',
    kind: 'SECTION',
    name: 'Surgical Oncology',
    slug: 'surgical-oncology',
    parentName: 'Surgery',
    aliases: [],
    source: `${SURGERY_DIVISIONS_SOURCE}`,
  },
  {
    action: 'create-department',
    kind: 'SECTION',
    name: 'Plastic & Reconstructive Surgery',
    slug: 'plastic-and-reconstructive-surgery',
    parentName: 'Surgery',
    aliases: [],
    source: `${SURGERY_DIVISIONS_SOURCE}`,
  },
  {
    action: 'create-department',
    kind: 'SECTION',
    name: 'Thoracic Surgery',
    slug: 'thoracic-surgery',
    parentName: 'Surgery',
    aliases: [],
    source: `${SURGERY_DIVISIONS_SOURCE}`,
  },
  {
    action: 'create-department',
    kind: 'SECTION',
    name: 'Colon & Rectal Surgery',
    slug: 'colon-and-rectal-surgery',
    parentName: 'Surgery',
    // The corpus states this section as "Colorectal Surgery"; the division list
    // publishes "Colon & Rectal Surgery", so the published name is canonical and
    // the corpus spelling is the alias.
    aliases: ['Colorectal Surgery'],
    source: `${SURGERY_DIVISIONS_SOURCE}`,
  },
  {
    action: 'create-department',
    kind: 'SECTION',
    name: 'General Internal Medicine',
    slug: 'general-internal-medicine',
    parentName: 'Internal Medicine',
    aliases: [],
    source: 'Yale School of Medicine https://medicine.yale.edu/intmed/genmed/',
  },
  {
    action: 'create-department',
    kind: 'SECTION',
    name: 'General Pediatrics',
    slug: 'general-pediatrics',
    parentName: 'Pediatrics',
    aliases: [],
    source: `${PEDIATRICS_SECTIONS_SOURCE}`,
  },
  {
    action: 'create-department',
    kind: 'SECTION',
    // Pediatrics publishes this section as "Hematology and Oncology", but the
    // catalog already disambiguates its Pediatrics sections from the Internal
    // Medicine sections of the same name ("Pediatric Nephrology", "Pediatric
    // Emergency Medicine"), and an unprefixed alias here would let an Internal
    // Medicine hematologist resolve to the Pediatrics section.
    name: 'Pediatric Hematology & Oncology',
    slug: 'pediatric-hematology-and-oncology',
    parentName: 'Pediatrics',
    aliases: [],
    source: `${PEDIATRICS_SECTIONS_SOURCE}`,
  },
  // Yale HR strings, kept verbatim rather than taught to the denoiser. #2500
  // measured that stripping a leading all-caps token by rule was wrong every
  // time it fired, and a bare alias would be worse here: "Cardiology" names an
  // Internal Medicine section AND a Pediatrics one, so only the coded string
  // says which. The code is the disambiguator, so it stays in the alias.
  {
    action: 'add-aliases',
    targetName: 'Medical Oncology and Hematology',
    aliases: ['MEDCCC Medical Oncology'],
    source: HR_DIRECTORY_SOURCE,
  },
  {
    action: 'add-aliases',
    targetName: 'Cardiovascular Medicine',
    aliases: ['MEDINT Cardiology'],
    source: HR_DIRECTORY_SOURCE,
  },
  {
    action: 'add-aliases',
    targetName: 'Endocrinology',
    aliases: ['MEDINT Endocrinology Other'],
    source: HR_DIRECTORY_SOURCE,
  },
  {
    action: 'add-aliases',
    targetName: 'Emergency Medicine',
    aliases: ['MEDEME Emergency Medicine - All'],
    source: HR_DIRECTORY_SOURCE,
  },
  {
    action: 'add-aliases',
    targetName: 'Biomedical Informatics & Data Science',
    aliases: ['MEDBMI Biomedical Informatics & Data Science'],
    source: HR_DIRECTORY_SOURCE,
  },
  {
    action: 'add-aliases',
    targetName: 'Comparative Medicine',
    aliases: ['CPMD - Comparative Medicine'],
    source: HR_DIRECTORY_SOURCE,
  },
  {
    action: 'add-aliases',
    targetName: 'Urology',
    aliases: ['MEDURO Urology - All'],
    source: HR_DIRECTORY_SOURCE,
  },
  {
    action: 'add-aliases',
    targetName: 'Therapeutic Radiology/Radiation Oncology',
    aliases: ['MEDTRA Therapeutic Radiology'],
    source: HR_DIRECTORY_SOURCE,
  },
  {
    action: 'add-aliases',
    targetName: 'Radiology & Biomedical Imaging',
    aliases: ['R&BI - Radiology & Biomedical Imaging', 'MEDDRA Radiology'],
    source: HR_DIRECTORY_SOURCE,
  },
  {
    action: 'add-aliases',
    targetName: 'Neurosurgery',
    aliases: ['MEDNSG Neurosurgery - All', 'NRSG - Neurosurgery'],
    source: HR_DIRECTORY_SOURCE,
  },
  {
    action: 'add-aliases',
    targetName: 'Neurology',
    aliases: ['MEDNEU Neurology - All'],
    source: HR_DIRECTORY_SOURCE,
  },
  {
    action: 'add-aliases',
    targetName: 'Obstetrics, Gynecology & Reproductive Sciences',
    aliases: ['OBGN - Obstetrics, Gynecology & Reproductive Sciences'],
    source: HR_DIRECTORY_SOURCE,
  },
  {
    action: 'add-aliases',
    targetName: 'Chronic Disease Epidemiology',
    aliases: ['SPHDPT Chronic Disease Epidemiology (CDE)'],
    source: HR_DIRECTORY_SOURCE,
  },
];

export interface ExistingOrgUnitRow {
  id: string;
  name: string;
  slug: string;
  kind: OrgUnitKind;
  aliases?: string[];
  archived?: boolean;
  status?: OrgUnitStatus;
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
  kind: 'DEPARTMENT' | 'SECTION';
}

export interface OrgUnitSeedRenamePlan {
  action: 'rename-department';
  targetId: string;
  fromName: string;
  toName: string;
  aliases: string[];
  source: string;
}

export interface OrgUnitSeedAliasRemovalPlan {
  action: 'remove-aliases';
  targetId: string;
  targetSlug: string;
  targetName: string;
  removedAliases: string[];
  aliases: string[];
  source: string;
}

export type OrgUnitSeedPlanRow =
  | OrgUnitSeedAliasPlan
  | OrgUnitSeedCreatePlan
  | OrgUnitSeedRenamePlan
  | OrgUnitSeedAliasRemovalPlan;

export interface OrgUnitSeedPlan {
  rows: OrgUnitSeedPlanRow[];
  satisfied: string[];
  blocked: { gap: string; reason: string }[];
}

function findByName(rows: ExistingOrgUnitRow[], name: string): ExistingOrgUnitRow | undefined {
  return rows.find((row) => sameMatchKey(row.name, name));
}

/**
 * Resolves an alias target by name first, then by slug or alias. The fallback is
 * what keeps an alias gap idempotent across a rename: once a row adopts its
 * official name, the name the gap was written against survives only as an alias.
 */
function findByAnyName(rows: ExistingOrgUnitRow[], value: string): ExistingOrgUnitRow | undefined {
  return (
    findByName(rows, value) ??
    rows.find((row) =>
      [row.slug, ...(row.aliases || [])].some((candidate) => sameMatchKey(candidate, value)),
    )
  );
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
 * Idempotent plan: an alias already present, a name already adopted, or a
 * department row that already exists, is reported as satisfied rather than
 * rewritten, so the script is safe to re-run in every environment.
 *
 * Gaps are planned in list order against a working copy that carries each
 * planned edit forward, so a later gap sees the catalog the earlier gaps leave
 * behind. That is what lets an alias removal and a rename onto the freed name
 * both land in one pass; reordering the list can therefore change the plan.
 */
export function planOrgUnitCatalogGapSeed(
  existing: ExistingOrgUnitRow[],
  gaps: readonly OrgUnitCatalogGap[] = ORG_UNIT_CATALOG_GAPS,
): OrgUnitSeedPlan {
  const rows: OrgUnitSeedPlanRow[] = [];
  const satisfied: string[] = [];
  const blocked: { gap: string; reason: string }[] = [];
  const working = existing.map((row) => ({ ...row, aliases: [...(row.aliases || [])] }));
  const live = (): ExistingOrgUnitRow[] =>
    working.filter((row) => row.archived !== true && row.status !== 'INACTIVE');
  // A row this run is still going to create has no id to update, so a later gap
  // that lands on it is reported rather than planned as an update nothing can
  // apply. Its edit belongs in the create gap itself.
  const pendingCreateIds = new Set<string>();
  const pendingReason = (target: ExistingOrgUnitRow): string =>
    `${target.slug} is created by this run, so fold the change into its create gap`;

  for (const gap of gaps) {
    if (gap.action === 'remove-aliases') {
      const target = working.find((row) => row.slug === gap.targetSlug);
      if (!target) {
        blocked.push({ gap: gap.targetSlug, reason: 'target org unit not found' });
        continue;
      }
      if (pendingCreateIds.has(target.id)) {
        blocked.push({ gap: gap.targetSlug, reason: pendingReason(target) });
        continue;
      }
      const currentAliases = target.aliases || [];
      const removedAliases = currentAliases.filter((alias) =>
        gap.aliases.some((doomed) => sameMatchKey(alias, doomed)),
      );
      if (removedAliases.length === 0) {
        satisfied.push(`${gap.targetSlug} alias removal`);
        continue;
      }
      const aliases = currentAliases.filter((alias) => !removedAliases.includes(alias));
      target.aliases = aliases;
      rows.push({
        action: 'remove-aliases',
        targetId: target.id,
        targetSlug: target.slug,
        targetName: target.name,
        removedAliases,
        aliases,
        source: gap.source,
      });
      continue;
    }

    if (gap.action === 'rename-department') {
      // A row already renamed no longer answers to `fromName` by name, only by
      // the alias the rename left behind. Matching `toName` alone would instead
      // pick up an unrelated row that happens to carry the published name.
      const target =
        findByName(live(), gap.fromName) ??
        live().find(
          (row) =>
            row.name === gap.toName &&
            (row.aliases || []).some((alias) => sameMatchKey(alias, gap.fromName)),
        );
      if (!target) {
        blocked.push({ gap: gap.toName, reason: `${gap.fromName} not found` });
        continue;
      }
      if (pendingCreateIds.has(target.id)) {
        blocked.push({ gap: gap.toName, reason: pendingReason(target) });
        continue;
      }
      if (target.name === gap.toName) {
        // A same-key duplicate can leave one row already published and another
        // still serving the stale label, and `findByName` picks between them by
        // iteration order, so reporting satisfied here would hide the drifted row
        // behind whichever row Mongo happened to return first.
        const drifted = live().find(
          (row) =>
            row.id !== target.id && row.name !== gap.toName && sameMatchKey(row.name, gap.fromName),
        );
        if (drifted) {
          blocked.push({
            gap: gap.toName,
            reason: `${target.slug} already carries that name while ${drifted.slug} still carries ${drifted.name}`,
          });
          continue;
        }
        satisfied.push(`${gap.toName} (already named)`);
        continue;
      }
      const collision = live().find(
        (row) => row.id !== target.id && sameMatchKey(row.name, gap.toName),
      );
      if (collision) {
        blocked.push({
          gap: gap.toName,
          reason: `${collision.slug} already carries that name`,
        });
        continue;
      }
      const aliases = aliasesAfterAdoptingName(target.aliases || [], target.name, gap.toName);
      const fromName = target.name;
      target.name = gap.toName;
      target.aliases = aliases;
      rows.push({
        action: 'rename-department',
        targetId: target.id,
        fromName,
        toName: gap.toName,
        aliases,
        source: gap.source,
      });
      continue;
    }

    if (gap.action === 'add-aliases') {
      const target = findByAnyName(live(), gap.targetName);
      if (!target) {
        blocked.push({ gap: gap.targetName, reason: 'target org unit not found' });
        continue;
      }
      if (pendingCreateIds.has(target.id)) {
        blocked.push({ gap: gap.targetName, reason: pendingReason(target) });
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
      const aliases = [...currentAliases, ...addedAliases];
      target.aliases = aliases;
      rows.push({
        action: 'add-aliases',
        targetId: target.id,
        targetName: target.name,
        addedAliases,
        aliases,
        source: gap.source,
      });
      continue;
    }

    const collision = resolvesAlready(live(), gap.name, ['DEPARTMENT', 'SECTION', 'DIVISION']);
    if (collision) {
      satisfied.push(`${gap.name} (already ${collision.kind} ${collision.name})`);
      continue;
    }
    const parent = findByName(live(), gap.parentName);
    if (!parent) {
      blocked.push({ gap: gap.name, reason: `parent ${gap.parentName} not found` });
      continue;
    }
    if (working.some((row) => row.slug === gap.slug)) {
      blocked.push({ gap: gap.name, reason: `slug ${gap.slug} already taken` });
      continue;
    }
    const pendingId = `pending:${gap.slug}`;
    pendingCreateIds.add(pendingId);
    working.push({
      id: pendingId,
      name: gap.name,
      slug: gap.slug,
      kind: gap.kind ?? 'DEPARTMENT',
      aliases: [...gap.aliases],
    });
    rows.push({
      action: 'create-department',
      name: gap.name,
      slug: gap.slug,
      aliases: gap.aliases,
      parentName: parent.name,
      parentId: parent.id,
      source: gap.source,
      kind: gap.kind ?? 'DEPARTMENT',
    });
  }

  return { rows, satisfied, blocked };
}

export function summarizeOrgUnitSeedPlan(plan: OrgUnitSeedPlan): {
  created: number;
  aliasUpdates: number;
  aliasRemovals: number;
  renames: number;
  satisfied: number;
  blocked: number;
} {
  return {
    created: plan.rows.filter((row) => row.action === 'create-department').length,
    aliasUpdates: plan.rows.filter((row) => row.action === 'add-aliases').length,
    aliasRemovals: plan.rows.filter((row) => row.action === 'remove-aliases').length,
    renames: plan.rows.filter((row) => row.action === 'rename-department').length,
    satisfied: plan.satisfied.length,
    blocked: plan.blocked.length,
  };
}
