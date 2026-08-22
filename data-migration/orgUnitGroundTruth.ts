import type { OrgUnitKind } from '../server/src/models/orgUnit';
import { slugify } from '../server/src/scrapers/utils/scraperHelpers';
import { orgUnitMatchKey } from '../server/src/scrapers/orgUnitCanonicalization';
import { curatedDepartments, decodeHtml, type CuratedDepartment } from './departmentGroundTruth';

export const orgUnitSourceNote = 'data-migration/orgUnitGroundTruth.ts';

export interface OrgUnitSeedRow {
  slug: string;
  name: string;
  kind: OrgUnitKind;
  aliases: string[];
  parentSlug?: string;
  status: 'ACTIVE';
  archived: boolean;
}

interface CuratedSchool {
  slug: string;
  name: string;
  kind: OrgUnitKind;
  aliases?: string[];
}

const YALE_SCHOOL_OF_MEDICINE_SLUG = 'yale-school-of-medicine';

const curatedSchools: CuratedSchool[] = [
  { slug: 'yale-college', name: 'Yale College', kind: 'SCHOOL' },
  {
    slug: 'graduate-school-of-arts-and-sciences',
    name: 'Graduate School of Arts and Sciences',
    kind: 'SCHOOL',
    aliases: ['GSAS', 'Yale Graduate School of Arts and Sciences'],
  },
  {
    slug: 'faculty-of-arts-and-sciences',
    name: 'Faculty of Arts and Sciences',
    kind: 'DIVISION',
    aliases: ['FAS'],
  },
  {
    slug: YALE_SCHOOL_OF_MEDICINE_SLUG,
    name: 'Yale School of Medicine',
    kind: 'SCHOOL',
    aliases: ['YSM', 'School of Medicine'],
  },
  {
    slug: 'yale-school-of-nursing',
    name: 'Yale School of Nursing',
    kind: 'SCHOOL',
    aliases: ['YSN', 'School of Nursing', 'Nursing'],
  },
  {
    slug: 'yale-school-of-public-health',
    name: 'Yale School of Public Health',
    kind: 'SCHOOL',
    aliases: ['YSPH', 'School of Public Health', 'Public Health', 'EPH'],
  },
  {
    slug: 'yale-school-of-the-environment',
    name: 'Yale School of the Environment',
    kind: 'SCHOOL',
    aliases: [
      'YSE',
      'School of the Environment',
      'School of Forestry and Environmental Studies',
      'Forestry and Environmental Studies',
      'F&ES',
    ],
  },
  {
    slug: 'yale-school-of-engineering-and-applied-science',
    name: 'Yale School of Engineering and Applied Science',
    kind: 'SCHOOL',
    aliases: [
      'SEAS',
      'School of Engineering and Applied Science',
      'Engineering and Applied Science',
      'ENAS',
    ],
  },
  {
    slug: 'yale-school-of-management',
    name: 'Yale School of Management',
    kind: 'SCHOOL',
    aliases: ['SOM', 'School of Management', 'Management'],
  },
  {
    slug: 'yale-law-school',
    name: 'Yale Law School',
    kind: 'SCHOOL',
    aliases: ['YLS', 'Law School', 'Law'],
  },
  {
    slug: 'yale-divinity-school',
    name: 'Yale Divinity School',
    kind: 'SCHOOL',
    aliases: ['YDS', 'Divinity School'],
  },
  {
    slug: 'yale-school-of-art',
    name: 'Yale School of Art',
    kind: 'SCHOOL',
    aliases: ['School of Art'],
  },
  {
    slug: 'yale-school-of-architecture',
    name: 'Yale School of Architecture',
    kind: 'SCHOOL',
    aliases: ['School of Architecture'],
  },
  {
    slug: 'david-geffen-school-of-drama',
    name: 'David Geffen School of Drama at Yale',
    kind: 'SCHOOL',
    aliases: ['David Geffen School of Drama', 'Yale School of Drama', 'School of Drama', 'DGSD'],
  },
  {
    slug: 'yale-school-of-music',
    name: 'Yale School of Music',
    kind: 'SCHOOL',
    aliases: ['School of Music'],
  },
  {
    slug: 'institute-of-sacred-music',
    name: 'Yale Institute of Sacred Music',
    kind: 'SCHOOL',
    aliases: ['Institute of Sacred Music', 'ISM'],
  },
  {
    slug: 'jackson-school-of-global-affairs',
    name: 'Jackson School of Global Affairs',
    kind: 'SCHOOL',
    aliases: ['Jackson School', 'Jackson Institute for Global Affairs', 'Jackson Institute'],
  },
];

/**
 * Extra aliases for raw org-unit strings observed in scraped
 * `research_entities.departments` that carry a Yale HR org-code prefix or an
 * all-caps variant, keyed by the canonical school/department name they belong
 * to. Kept here (not in the shared department ground truth) so growing facet
 * coverage never perturbs the department taxonomy used by other surfaces.
 */
const orgUnitAliasOverlay: Record<string, string[]> = {
  'Cellular & Molecular Physiology': ['Physiology'],
  'Therapeutic Radiology': ['RADIATION-DIAGNOSTIC/ONCOLOGY'],
  'Biomedical Engineering': ['EASBME BME Faculty'],
  'Chemical Engineering': ['EASCEE CEE Faculty'],
  'Mechanical Engineering': ['EASMEC MechE Faculty'],
  "Women's, Gender, and Sexuality Studies": ['FASGSS Womens,Gender and Sexuality Studies'],
  Humanities: ['FASHUM Humanities Studies'],
  Linguistics: ['FASLIN Linguistics-Research Unit'],
  'Yale Institute of Sacred Music': ['ISM Institute of Sacred Music'],
};

function mergeOverlayAliases(rows: OrgUnitSeedRow[], schoolKeys: Set<string>): void {
  for (const row of rows) {
    const extra = orgUnitAliasOverlay[row.name];
    if (!extra) continue;
    const nameKey = orgUnitMatchKey(row.name);
    const existingKeys = new Set(row.aliases.map((alias) => orgUnitMatchKey(alias)));
    const isSchool = row.kind === 'SCHOOL' || row.kind === 'DIVISION';
    for (const alias of uniqueByKey(extra)) {
      const key = orgUnitMatchKey(alias);
      if (!key || key === nameKey || existingKeys.has(key)) continue;
      if (!isSchool && schoolKeys.has(key)) continue;
      row.aliases.push(alias);
      existingKeys.add(key);
    }
  }
}

function uniqueByKey(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = decodeHtml(value || '');
    if (!cleaned) continue;
    const key = orgUnitMatchKey(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function departmentParentSlug(dept: CuratedDepartment): string | undefined {
  if (dept.ysmDepartmentName) return YALE_SCHOOL_OF_MEDICINE_SLUG;
  return undefined;
}

/**
 * The curated Yale school and department ground truth as OrgUnit seed rows.
 * Schools are curated directly; departments reuse the maintained department
 * ground truth so the two lists never drift. Department rows that actually name
 * a school (for example the Public Health department shell) are dropped so a
 * scraped value resolves to a single canonical OrgUnit.
 */
export function buildOrgUnitSeedRows(): OrgUnitSeedRow[] {
  const schoolRows: OrgUnitSeedRow[] = curatedSchools.map((school) => ({
    slug: school.slug,
    name: decodeHtml(school.name),
    kind: school.kind,
    aliases: uniqueByKey(school.aliases || []).filter(
      (alias) => orgUnitMatchKey(alias) !== orgUnitMatchKey(school.name),
    ),
    status: 'ACTIVE',
    archived: false,
  }));

  const schoolKeys = new Set<string>();
  for (const row of schoolRows) {
    schoolKeys.add(orgUnitMatchKey(row.name));
    schoolKeys.add(row.slug);
    for (const alias of row.aliases) schoolKeys.add(orgUnitMatchKey(alias));
  }

  const departmentRows: OrgUnitSeedRow[] = [];
  for (const dept of curatedDepartments) {
    const nameKey = orgUnitMatchKey(dept.name);
    if (schoolKeys.has(nameKey)) continue;
    const aliases = uniqueByKey([dept.abbreviation, ...(dept.aliases || [])]).filter((alias) => {
      const key = orgUnitMatchKey(alias);
      return key !== nameKey && !schoolKeys.has(key);
    });
    departmentRows.push({
      slug: slugify(dept.name),
      name: decodeHtml(dept.name),
      kind: 'DEPARTMENT',
      aliases,
      parentSlug: departmentParentSlug(dept),
      status: 'ACTIVE',
      archived: false,
    });
  }

  const allRows = [...schoolRows, ...departmentRows];
  mergeOverlayAliases(allRows, schoolKeys);
  return allRows;
}

export function validateOrgUnitRows(rows: OrgUnitSeedRow[]): string[] {
  const errors: string[] = [];
  const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const bySlug = new Map<string, string>();
  const keyToSlug = new Map<string, string>();

  for (const row of rows) {
    if (!row.name) errors.push(`${row.slug}: missing name`);
    if (!row.slug || !slugPattern.test(row.slug) || row.slug.length > 160) {
      errors.push(`${row.name}: invalid slug "${row.slug}"`);
    }
    if (bySlug.has(row.slug)) {
      errors.push(`${row.slug}: duplicate slug also used by ${bySlug.get(row.slug)}`);
    }
    bySlug.set(row.slug, row.name);

    if (row.aliases.length > 20) errors.push(`${row.slug}: more than 20 aliases`);
    const nameKey = orgUnitMatchKey(row.name);
    const aliasKeys = new Set<string>();
    for (const alias of row.aliases) {
      const aliasKey = orgUnitMatchKey(alias);
      if (!aliasKey) continue;
      if (aliasKey === nameKey) errors.push(`${row.slug}: alias duplicates name "${alias}"`);
      if (aliasKeys.has(aliasKey)) errors.push(`${row.slug}: duplicate alias "${alias}"`);
      aliasKeys.add(aliasKey);
    }

    for (const key of [nameKey, ...aliasKeys]) {
      const owner = keyToSlug.get(key);
      if (owner && owner !== row.slug) {
        errors.push(`resolver-key collision "${key}" shared by ${owner} and ${row.slug}`);
      }
      keyToSlug.set(key, row.slug);
    }
  }

  const slugs = new Set(rows.map((row) => row.slug));
  for (const row of rows) {
    if (row.parentSlug && !slugs.has(row.parentSlug)) {
      errors.push(`${row.slug}: parentSlug "${row.parentSlug}" is not a seeded OrgUnit`);
    }
  }

  return errors;
}
