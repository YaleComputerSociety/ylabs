/**
 * Canonicalizes free-text department strings (from scrapers) against the Department collection.
 * Maintains an in-memory cache of canonical names + aliases; bypasses fuzzy matching when an exact
 * or alias match is found. Suggests new aliases when a fuzzy match is high-confidence.
 */
import { Department } from '../models/department';

interface DepartmentRow {
  _id: any;
  name: string;
  displayName: string;
  abbreviation: string;
  aliases: string[];
}

export interface CanonicalDepartmentListResult {
  departments: string[];
  unresolved: string[];
  ignored: string[];
}

export interface CanonicalProfileDepartmentsInput {
  primaryDepartment?: unknown;
  secondaryDepartments?: unknown;
  departments?: unknown;
}

export interface CanonicalProfileDepartmentsResult {
  primaryDepartment: string;
  secondaryDepartments: string[];
  departments: string[];
  unresolved: string[];
  ignored: string[];
}

interface CanonicalizeResult {
  canonical: string | null;
  matchType: 'exact' | 'alias' | 'fuzzy' | 'none';
  confidence: number;
  suggestedAlias?: string;
}

const cache: {
  byNormalized: Map<string, DepartmentRow>;
  all: DepartmentRow[];
  loadedAt: number | null;
} = {
  byNormalized: new Map(),
  all: [],
  loadedAt: null,
};

const CACHE_TTL_MS = 5 * 60 * 1000;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[&]/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const BROAD_UNIT_KEYS = new Set(
  [
    'Yale School of Medicine',
    'MED School of Medicine',
    'EAS School of Engineering and Applied Science',
    'ENV Yale School of the Environment',
    'ENVOTH Other Units',
    'FAS Other FAS and Academic Departments',
    'MAC MacMillan Center',
    'SPH School of Public Health',
    'Yale School of Public Health',
    'School of Public Health',
    'School of Medicine',
    'Medicine',
    'ART School of Art',
    'Graduate School of Arts & Sci',
    'Graduate School of Arts and Sciences',
    'Graduate School',
  ].map(normalize),
);

const SOURCE_UNIT_ABBREVIATION_ALIASES = new Map<string, string>(
  Object.entries({
    'NUR School of Nursing': 'NURS',
    'LAW School of Law': 'LAW',
    'ARC School of Architecture': 'ARCH',
    'SCM School of Music': 'MUSI',
    'EASCEE CEE Faculty': 'CEE',
    'EASMEC MechE Faculty': 'MENG',
    'EASECE ECE Faculty': 'ECE',
    'EASBME BME Faculty': 'BENG',
    'EASAPH Applied Physics Faculty': 'APHY',
    'EASAPP Administration': 'APHY',
    'EASAPP Research Unit': 'APHY',
    'EASACM ACM Administration': 'AMTH',
    'EASCPS Computer Science': 'CPSC',
    'EASCSE Computer Science Faculty': 'CPSC',
    'Electrical Engineering': 'ECE',
    'Mechanical Engineering': 'MENG',
    'Materials Science': 'MENG',
    'Applied & Computational Mathematics': 'AMTH',
    'FASMAT Program in Applied Math': 'AMTH',
    'Environmental Studies': 'EVST',
    'International and Development Economics': 'ECON',
    'Judaic Studies': 'JDST',
    'African American Studies': 'AFAM',
    'Theater Studies': 'TDPS',
    'Therapeutic Radiology': 'TRAD',
    'History of Medicine': 'HSHM',
    'Law School': 'LAW',
    'JAC Jackson School of Global Affairs': 'GLBL',
    'School of Global Affairs': 'GLBL',
    'JACTEA Jackson Teaching': 'GLBL',
    'ARTSCH School of Art - All School': 'ART',
    'FASANT Anthropology': 'ANTH',
    'FASECO Economics': 'ECON',
    'FASEPS Research Unit': 'EPS',
    'FASMCD MCDB': 'MCDB',
    'FASPLS Political Science': 'PLSC',
    'FASPSC Political Science': 'PLSC',
    'FASPSY Department Administration': 'PSYC',
    'FASPSY Psychology': 'PSYC',
    'JACOPC Artificial Intelligence, Emerging Tech & Power Program': 'GLBL',
    'JACOPC Brady-Johnson Program in Grand Strategy': 'GLBL',
    'MACAFR Council On African Studies': 'AFST',
    'MACEAS Council On East Asian Studies': 'EAST',
    'MACLAS Council On Latin American and Iberian Studies': 'LAST',
    'MACMES Council On Middle East Studies': 'MMES',
    'MACSA South Asian Studies Council': 'SAST',
    'MACSAS Council on South Asian Studies': 'SAST',
    'MACEUR Council on European Studies': 'RSEE',
    'MACMID Council on Middle East Studies': 'MMES',
    'MACLAT Council On Latin American Studies': 'LAST',
    'MACREEES European Studies Council': 'RSEE',
    'MACREEES Program in Russian, East European and Eurasian Studies': 'RSEE',
    'SOM School of Management': 'MGT',
    'School of Management': 'MGT',
    'SOMRES Research and Teaching Unit': 'MGT',
  }).map(([raw, abbreviation]) => [normalize(raw), abbreviation]),
);

const SOURCE_UNIT_PREFIX_ABBREVIATION_ALIASES: Array<[string, string]> = Object.entries({
  LAWFAC: 'LAW',
  LAWCEN: 'LAW',
  LAWLSO: 'LAW',
  LAWLDR: 'LAW',
  LAWADM: 'LAW',
  JACBLC: 'GLBL',
  JACTEA: 'GLBL',
  JACDOF: 'GLBL',
  JACADM: 'GLBL',
  JACGHI: 'GLBL',
  JACWFP: 'GLBL',
  JACOPC: 'GLBL',
  SOMRES: 'MGT',
  SOMEDU: 'MGT',
  SOMADM: 'MGT',
  NURADM: 'NURS',
  NURPRO: 'NURS',
  LAWFAF: 'LAW',
  ARCSCH: 'ARCH',
  SCMMUS: 'MUSI',
  FASENG: 'ENGL',
  FASTHE: 'TDPS',
  FASHIS: 'HIST',
  FASEAL: 'EALL',
  FASCHM: 'CHEM',
  FASMUS: 'MUSI',
  FASSPP: 'SPAN/PORT',
  FASSOC: 'SOCY',
  FASPHY: 'PHYS',
  FASMAT: 'MATH',
  FASNEL: 'NELC',
  FASEEB: 'EEB',
  FASPHI: 'PHIL',
  FASFRE: 'FREN',
  FASHOA: 'HSAR',
  FASRST: 'RLST',
  FASLIN: 'LING',
  FASHUM: 'HUMS',
  FASCLA: 'CLSS',
  FASGER: 'GMAN',
  FASAMS: 'AMST',
  FASSLA: 'SLAV',
  FASITA: 'ITAL',
  FASGSS: 'WGSS',
  FASAST: 'ASTR',
  FASSTA: 'S&DS',
  FASFIL: 'FILM',
  FASERM: 'ER&M',
  FASCLI: 'CPLT',
  FASJUD: 'JDST',
  FASAAS: 'AFAM',
  FASEPS: 'EPS',
  FASECO: 'ECON',
  FASMCD: 'MCDB',
  ENVCEN: 'EVST',
  'SPHDPT Environmental Health Sciences': 'EHS',
  'SPHDPT Biostatistics': 'BIS',
  'SPHDPT Epidemiology of Microbial Diseases': 'EMD',
  'SPHDPT Health Policy and Management': 'HPM',
  'SPHDPT Chronic Disease Epidemiology': 'CDE',
  MEDPSY: 'PSYT',
  MEDINT: 'INMD',
  MEDDRA: 'R&BI',
  MEDGEN: 'GENE',
  MEDEME: 'EM',
  MEDNSC: 'NSCI',
  MEDIMU: 'IBIO',
  MEDANE: 'ANES',
  MEDDER: 'DERM',
  MEDMBB: 'MB&B',
  MEDCSC: 'CHLD',
  MEDOBG: 'OBGN',
  MEDTRA: 'TRAD',
  MEDURO: 'URLG',
  MEDMPA: 'MBP',
  MEDCEL: 'CBIO',
  MEDCMP: 'C&MP',
  MEDPAT: 'PATH',
  MEDCOM: 'CPMD',
  MEDPHA: 'PHAR',
  MEDORT: 'OPRH',
  MEDNSG: 'NRSG',
  MEDSUR: 'SURG',
  MEDPED: 'PEDT',
  MEDNEU: 'NRLG',
  MEDOPT: 'OPVS',
  MEDBMI: 'BIDS',
  MEDHIS: 'HSHM',
}).map(([rawPrefix, abbreviation]) => [normalize(rawPrefix), abbreviation]);

const SOURCE_UNIT_IGNORED_PREFIXES = [
  'DRA',
  'DIV',
  'ISM',
  'YCO',
  'YHP',
  'ATH',
  'PRV',
  'RES',
  'LIB',
  'SLS',
  'UUG',
  'GRA',
  'EEI',
  'PRE',
  'CBA',
  'Laboratory Medicine',
  'MEDCCC',
  'MEDLAB',
  'SPHDPT Social and Behavioral Sciences',
  'MACSEA',
  'MACADM',
  'MACAGR',
  'MACPRG',
  'MACGLC',
  'MACIPE',
  'MEDKEC',
  'MEDCCI',
  'MEDACP',
  'MEDCEN',
  'MEDDEA',
  'SPHADM',
  'EASCEN',
  'EASCTI',
  'FASCOG',
  'FASWHC',
  'FASEPE',
  'FASLSC',
  'FASFDA',
  'ENVACC',
  'Yale Summer Session',
].map(normalize);

async function loadCache(force = false): Promise<void> {
  if (!force && cache.loadedAt && Date.now() - cache.loadedAt < CACHE_TTL_MS) return;
  const rows = await Department.find({}).lean<DepartmentRow[]>();
  cache.all = rows;
  cache.byNormalized.clear();
  for (const row of rows) {
    cache.byNormalized.set(normalize(row.name), row);
    cache.byNormalized.set(normalize(row.displayName), row);
    cache.byNormalized.set(normalize(row.abbreviation), row);
    for (const alias of row.aliases || []) {
      cache.byNormalized.set(normalize(alias), row);
    }
  }
  cache.loadedAt = Date.now();
}

function buildDepartmentRowLookup(rows: DepartmentRow[]): Map<string, DepartmentRow> {
  const byNormalized = new Map<string, DepartmentRow>();
  for (const row of rows) {
    byNormalized.set(normalize(row.name), row);
    byNormalized.set(normalize(row.displayName), row);
    byNormalized.set(normalize(row.abbreviation), row);
    for (const alias of row.aliases || []) {
      byNormalized.set(normalize(alias), row);
    }
  }
  return byNormalized;
}

function addDepartment(
  departments: string[],
  seen: Set<string>,
  row: DepartmentRow,
): void {
  const key = normalize(row.name);
  if (seen.has(key)) return;
  seen.add(key);
  departments.push(row.name);
}

export function canonicalizeDepartmentListFromRows(
  rawDepartments: unknown,
  rows: DepartmentRow[],
): CanonicalDepartmentListResult {
  const byNormalized = buildDepartmentRowLookup(rows);
  const departments: string[] = [];
  const unresolved: string[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  const values = Array.isArray(rawDepartments)
    ? rawDepartments
    : rawDepartments === undefined || rawDepartments === null
      ? []
      : [rawDepartments];

  for (const raw of values) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;
    const key = normalize(value);
    const aliasAbbreviation = SOURCE_UNIT_ABBREVIATION_ALIASES.get(key);
    const aliasRow = aliasAbbreviation ? byNormalized.get(normalize(aliasAbbreviation)) : undefined;
    if (aliasRow) {
      addDepartment(departments, seen, aliasRow);
      continue;
    }
    const prefixAliasAbbreviation = SOURCE_UNIT_PREFIX_ABBREVIATION_ALIASES.find(([prefix]) =>
      key.startsWith(prefix),
    )?.[1];
    const prefixAliasRow = prefixAliasAbbreviation
      ? byNormalized.get(normalize(prefixAliasAbbreviation))
      : undefined;
    if (prefixAliasRow) {
      addDepartment(departments, seen, prefixAliasRow);
      continue;
    }
    if (BROAD_UNIT_KEYS.has(key)) {
      if (!ignored.includes(value)) ignored.push(value);
      continue;
    }
    if (SOURCE_UNIT_IGNORED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      if (!ignored.includes(value)) ignored.push(value);
      continue;
    }
    const direct = byNormalized.get(key);
    if (direct) {
      addDepartment(departments, seen, direct);
      continue;
    }
    if (!unresolved.includes(value)) unresolved.push(value);
  }

  return { departments, unresolved, ignored };
}

export async function canonicalizeDepartmentList(
  rawDepartments: unknown,
): Promise<CanonicalDepartmentListResult> {
  await loadCache();
  return canonicalizeDepartmentListFromRows(rawDepartments, cache.all);
}

function displayNamesForCanonicalNames(
  canonicalNames: string[],
  rows: DepartmentRow[],
): string[] {
  const byName = new Map(
    rows.map((row) => [normalize(row.name), row.displayName || row.name]),
  );
  return canonicalNames.map((name) => byName.get(normalize(name)) || name);
}

export function canonicalizeProfileDepartmentsFromRows(
  input: CanonicalProfileDepartmentsInput,
  rows: DepartmentRow[],
): CanonicalProfileDepartmentsResult {
  const rawPrimary =
    typeof input.primaryDepartment === 'string' ? input.primaryDepartment.trim() : '';
  const rawSecondary = Array.isArray(input.secondaryDepartments)
    ? input.secondaryDepartments
    : [];
  const rawDepartments = Array.isArray(input.departments) ? input.departments : [];
  const canonical = canonicalizeDepartmentListFromRows(
    [rawPrimary, ...rawSecondary, ...rawDepartments].filter(Boolean),
    rows,
  );
  const departments = displayNamesForCanonicalNames(canonical.departments, rows);

  return {
    primaryDepartment: departments[0] || '',
    secondaryDepartments: departments.slice(1),
    departments,
    unresolved: canonical.unresolved,
    ignored: canonical.ignored,
  };
}

export async function canonicalizeProfileDepartments(
  input: CanonicalProfileDepartmentsInput,
): Promise<CanonicalProfileDepartmentsResult> {
  await loadCache();
  return canonicalizeProfileDepartmentsFromRows(input, cache.all);
}

function tokenJaccard(a: string, b: string): number {
  const at = new Set(a.split(' ').filter(Boolean));
  const bt = new Set(b.split(' ').filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter++;
  return inter / (at.size + bt.size - inter);
}

export async function canonicalizeDepartment(raw: string): Promise<CanonicalizeResult> {
  if (!raw || !raw.trim()) {
    return { canonical: null, matchType: 'none', confidence: 0 };
  }
  await loadCache();
  const norm = normalize(raw);
  const direct = cache.byNormalized.get(norm);
  if (direct) {
    return { canonical: direct.name, matchType: 'exact', confidence: 1.0 };
  }
  let best: { row: DepartmentRow; score: number } | null = null;
  for (const row of cache.all) {
    const score = Math.max(
      tokenJaccard(norm, normalize(row.name)),
      tokenJaccard(norm, normalize(row.displayName)),
    );
    if (!best || score > best.score) best = { row, score };
  }
  if (best && best.score >= 0.7) {
    return {
      canonical: best.row.name,
      matchType: 'fuzzy',
      confidence: best.score,
      suggestedAlias: raw,
    };
  }
  return { canonical: null, matchType: 'none', confidence: 0 };
}

export async function registerDepartmentAlias(canonicalName: string, alias: string): Promise<void> {
  await Department.updateOne({ name: canonicalName }, { $addToSet: { aliases: alias } });
  await loadCache(true);
}

export function clearDepartmentResolverCache(): void {
  cache.loadedAt = null;
  cache.byNormalized.clear();
  cache.all = [];
}
