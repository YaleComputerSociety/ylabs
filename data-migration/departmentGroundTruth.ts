export enum DepartmentCategory {
  COMPUTING_AI = 'Computing & AI',
  LIFE_SCIENCES = 'Life Sciences',
  PHYSICAL_SCIENCES = 'Physical Sciences & Engineering',
  HEALTH_MEDICINE = 'Health & Medicine',
  SOCIAL_SCIENCES = 'Social Sciences',
  HUMANITIES_ARTS = 'Humanities & Arts',
  ENVIRONMENTAL = 'Environmental Sciences',
  ECONOMICS = 'Economics',
  MATHEMATICS = 'Mathematics',
}

export enum DepartmentCodeSystem {
  YCPS_SUBJECT = 'ycps_subject',
  YSM_DEPARTMENT = 'ysm_department',
  YSM_ACRONYM = 'ysm_acronym',
  APP_LOCAL = 'app_local',
}

export const departmentSourceUrls = {
  ycpsSubjectAbbreviations: 'https://catalog.yale.edu/ycps/subject-abbreviations/',
  ysmDepartments: 'https://medicine.yale.edu/about/departments/',
  ysmAcronyms: 'https://medicine.yale.edu/ysm/about/a-to-z-index/abbreviations',
} as const;

export const categoryColorKeys: Record<DepartmentCategory, number> = {
  [DepartmentCategory.COMPUTING_AI]: 0,
  [DepartmentCategory.LIFE_SCIENCES]: 1,
  [DepartmentCategory.PHYSICAL_SCIENCES]: 2,
  [DepartmentCategory.HEALTH_MEDICINE]: 3,
  [DepartmentCategory.SOCIAL_SCIENCES]: 4,
  [DepartmentCategory.HUMANITIES_ARTS]: 5,
  [DepartmentCategory.ENVIRONMENTAL]: 6,
  [DepartmentCategory.ECONOMICS]: 7,
  [DepartmentCategory.MATHEMATICS]: 8,
};

export interface DepartmentSourceRecord {
  sourceKey: keyof typeof departmentSourceUrls | 'app_overlay';
  sourceUrl: string;
  matchedName: string;
  matchedCode?: string;
  codeSystem: DepartmentCodeSystem;
}

export interface DepartmentSeedRow {
  abbreviation: string;
  name: string;
  displayName: string;
  categories: DepartmentCategory[];
  primaryCategory: DepartmentCategory;
  colorKey: number;
  aliases: string[];
  sourceRecords: DepartmentSourceRecord[];
  codeSystem: DepartmentCodeSystem;
  isActive: boolean;
}

export interface ParsedYcpsSubject {
  code: string;
  name: string;
}

export interface ParsedYsmAcronym {
  code: string;
  expansion: string;
  aliases: string[];
}

export interface GroundTruthBuildResult {
  departments: DepartmentSeedRow[];
  sourceCounts: {
    ycpsSubjects: number;
    ysmDepartments: number;
    ysmAcronyms: number;
  };
  localOnlyRows: DepartmentSeedRow[];
}

export type HtmlFetch = (url: string) => Promise<{ text(): Promise<string> }>;

interface CuratedDepartment {
  abbreviation: string;
  name: string;
  categories: DepartmentCategory[];
  aliases?: string[];
  ycpsCode?: string;
  ycpsCodes?: string[];
  ysmDepartmentName?: string;
  ysmAcronymCodes?: string[];
  codeSystemPreference?: DepartmentCodeSystem;
}

const curatedDepartments: CuratedDepartment[] = [
  { abbreviation: 'AFST', name: 'African Studies', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'AMST', name: 'American Studies', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'ANES', name: 'Anesthesiology', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Anesthesiology' },
  { abbreviation: 'ANTH', name: 'Anthropology', categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'AMTH', name: 'Applied Mathematics', categories: [DepartmentCategory.MATHEMATICS] },
  { abbreviation: 'APHY', name: 'Applied Physics', categories: [DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: 'ARCG', name: 'Archaeological Studies', categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'ARCH', name: 'Architecture', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'ART', name: 'Art', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'ASTR', name: 'Astronomy & Astrophysics', aliases: ['Astronomy'], categories: [DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: 'BIOL', name: 'Biology', aliases: ['Biological & Biomedical Sciences', 'Biological and Biomedical Sciences', 'BBS'], categories: [DepartmentCategory.LIFE_SCIENCES, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: 'BENG', name: 'Biomedical Engineering', aliases: ['BME'], categories: [DepartmentCategory.PHYSICAL_SCIENCES, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: 'BIDS', name: 'Biomedical Informatics & Data Science', aliases: ['Biomedical Informatics and Data Science'], categories: [DepartmentCategory.COMPUTING_AI, DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Biomedical Informatics & Data Science' },
  { abbreviation: 'BIS', name: 'Biostatistics', categories: [DepartmentCategory.MATHEMATICS, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: 'BLST', name: 'Black Studies', aliases: ['AFAM', 'African American Studies'], categories: [DepartmentCategory.HUMANITIES_ARTS, DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'CBIO', name: 'Cell Biology', categories: [DepartmentCategory.LIFE_SCIENCES], ysmDepartmentName: 'Cell Biology' },
  { abbreviation: 'C&MP', name: 'Cellular & Molecular Physiology', aliases: ['Cellular and Molecular Physiology'], categories: [DepartmentCategory.LIFE_SCIENCES, DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Cellular & Molecular Physiology' },
  { abbreviation: 'CENG', name: 'Chemical Engineering', aliases: ['CEE', 'Chemical & Environmental Engineering', 'Chemical and Environmental Engineering'], categories: [DepartmentCategory.PHYSICAL_SCIENCES, DepartmentCategory.ENVIRONMENTAL] },
  { abbreviation: 'CHEM', name: 'Chemistry', categories: [DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: 'CHLD', name: 'Child Study Center', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Child Study Center' },
  { abbreviation: 'CDE', name: 'Chronic Disease Epidemiology', categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: 'CLSS', name: 'Classics', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'CGSC', name: 'Cognitive Science', categories: [DepartmentCategory.COMPUTING_AI, DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'CPLT', name: 'Comparative Literature', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'CPMD', name: 'Comparative Medicine', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Comparative Medicine' },
  { abbreviation: 'CB&B', name: 'Computational Biology & Biomedical Informatics', aliases: ['Computational Biology and Bioinformatics'], categories: [DepartmentCategory.COMPUTING_AI, DepartmentCategory.LIFE_SCIENCES] },
  { abbreviation: 'CPSC', name: 'Computer Science', categories: [DepartmentCategory.COMPUTING_AI] },
  { abbreviation: 'DERM', name: 'Dermatology', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Dermatology' },
  { abbreviation: 'EMST', name: 'Early Modern Studies', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'EPS', name: 'Earth and Planetary Sciences', aliases: ['Earth & Planetary Sciences', 'Geology and Geophysics'], categories: [DepartmentCategory.ENVIRONMENTAL, DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: 'EALL', name: 'East Asian Languages and Literatures', aliases: ['East Asian Languages & Literatures'], categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'EAST', name: 'East Asian Studies', categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'EEB', name: 'Ecology and Evolutionary Biology', aliases: ['Ecology & Evolutionary Biology', 'E&EB'], categories: [DepartmentCategory.LIFE_SCIENCES, DepartmentCategory.ENVIRONMENTAL] },
  { abbreviation: 'ECON', name: 'Economics', categories: [DepartmentCategory.ECONOMICS] },
  { abbreviation: 'ECE', name: 'Electrical Engineering', aliases: ['Electrical & Computer Engineering', 'Electrical and Computer Engineering', 'EENG'], categories: [DepartmentCategory.COMPUTING_AI, DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: 'EM', name: 'Emergency Medicine', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Emergency Medicine', ysmAcronymCodes: ['EM'] },
  { abbreviation: 'ENAS', name: 'Engineering and Applied Science', aliases: ['Engineering & Applied Science'], categories: [DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: 'ENGL', name: 'English Language and Literature', aliases: ['English Language & Literature', 'English'], categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'EVST', name: 'Environmental Studies', aliases: ['Environment'], categories: [DepartmentCategory.ENVIRONMENTAL] },
  { abbreviation: 'EHS', name: 'Environmental Health Sciences', categories: [DepartmentCategory.ENVIRONMENTAL, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: 'EMD', name: 'Epidemiology of Microbial Diseases', categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: 'ER&M', name: 'Ethnicity, Race, and Migration', aliases: ['Ethnicity, Race, & Migration'], categories: [DepartmentCategory.HUMANITIES_ARTS, DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'RSEE', name: 'Russian, East European, and Eurasian Studies', aliases: ['European & Russian Studies', 'European and Russian Studies'], categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'EXPA', name: 'Experimental Pathology', categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: 'FILM', name: 'Film and Media Studies', aliases: ['Film & Media Studies'], categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'F&ES', name: 'Forestry', aliases: ['Forestry and Environmental Studies'], categories: [DepartmentCategory.ENVIRONMENTAL] },
  { abbreviation: 'FREN', name: 'French', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'GENE', name: 'Genetics', categories: [DepartmentCategory.LIFE_SCIENCES, DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Genetics' },
  { abbreviation: 'GMAN', name: 'German Studies', aliases: ['German'], categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'GLBL', name: 'Global Affairs', categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'HCM', name: 'Health Care Management', categories: [DepartmentCategory.HEALTH_MEDICINE, DepartmentCategory.ECONOMICS] },
  { abbreviation: 'HPM', name: 'Health Policy & Management', aliases: ['Health Policy and Management'], categories: [DepartmentCategory.HEALTH_MEDICINE, DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'HELN', name: 'Modern Greek', aliases: ['Hellenic Studies', 'MGRK'], categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'HIST', name: 'History', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'HSAR', name: 'History of Art', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'HSHM', name: 'History of Science, Medicine, and Public Health', aliases: ['History of Science & Medicine', 'History of Science and Medicine', 'History of Medicine'], categories: [DepartmentCategory.HUMANITIES_ARTS], ysmDepartmentName: 'History of Medicine' },
  { abbreviation: 'HUMS', name: 'Humanities', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'IBIO', name: 'Immunobiology', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Immunobiology' },
  { abbreviation: 'INMD', name: 'Internal Medicine', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Internal Medicine' },
  { abbreviation: 'IMED', name: 'Investigative Medicine', categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: 'ITAL', name: 'Italian Studies', aliases: ['Italian'], categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'JDST', name: 'Jewish Studies', aliases: ['Judaic Studies'], categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'LAST', name: 'Latin American Studies', categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'LAW', name: 'Law', categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'LING', name: 'Linguistics', categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'MGT', name: 'Management', categories: [DepartmentCategory.ECONOMICS] },
  { abbreviation: 'MATH', name: 'Mathematics', categories: [DepartmentCategory.MATHEMATICS] },
  { abbreviation: 'MENG', name: 'Mechanical Engineering', aliases: ['Mechanical Engineering & Materials Science', 'Mechanical Engineering and Materials Science'], categories: [DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: 'MDVL', name: 'Medieval Studies', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'MBIO', name: 'Microbiology', categories: [DepartmentCategory.LIFE_SCIENCES] },
  { abbreviation: 'MBP', name: 'Microbial Pathogenesis', categories: [DepartmentCategory.HEALTH_MEDICINE, DepartmentCategory.LIFE_SCIENCES], ysmDepartmentName: 'Microbial Pathogenesis' },
  { abbreviation: 'MMES', name: 'Modern Middle East Studies', categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'MB&B', name: 'Molecular Biophysics and Biochemistry', aliases: ['Molecular Biophysics & Biochemistry'], categories: [DepartmentCategory.LIFE_SCIENCES, DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Molecular Biophysics and Biochemistry' },
  { abbreviation: 'MCDB', name: 'Molecular, Cellular, and Developmental Biology', aliases: ['Molecular, Cellular & Developmental Biology'], categories: [DepartmentCategory.LIFE_SCIENCES] },
  { abbreviation: 'MUSI', name: 'Music', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'NELC', name: 'Near Eastern Languages and Civilizations', aliases: ['Near Eastern Languages & Civilizations'], categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'NRLG', name: 'Neurology', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Neurology' },
  { abbreviation: 'NRSG', name: 'Neurosurgery', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Neurosurgery' },
  { abbreviation: 'NSCI', name: 'Neuroscience', categories: [DepartmentCategory.LIFE_SCIENCES, DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Neuroscience' },
  { abbreviation: 'NURS', name: 'Nursing', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmAcronymCodes: ['YSN'] },
  { abbreviation: 'OBGN', name: 'Obstetrics, Gynecology & Reproductive Sciences', aliases: ['Obstetrics, Gynecology and Reproductive Sciences'], categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Obstetrics, Gynecology & Reproductive Sciences' },
  { abbreviation: 'OPVS', name: 'Ophthalmology', aliases: ['Ophthalmology & Visual Science', 'Ophthalmology and Visual Science'], categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Ophthalmology' },
  { abbreviation: 'OPRH', name: 'Orthopaedics & Rehabilitation', aliases: ['Orthopaedics and Rehabilitation'], categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Orthopaedics & Rehabilitation' },
  { abbreviation: 'PATH', name: 'Pathology', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Pathology' },
  { abbreviation: 'PEDT', name: 'Pediatrics', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Pediatrics' },
  { abbreviation: 'PHAR', name: 'Pharmacology', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Pharmacology' },
  { abbreviation: 'PHIL', name: 'Philosophy', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'PHYS', name: 'Physics', categories: [DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: 'PLSC', name: 'Political Science', categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'PSYT', name: 'Psychiatry', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Psychiatry' },
  { abbreviation: 'PSYC', name: 'Psychology', categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'EPH', name: 'Public Health', aliases: ['YSPH', 'Yale School of Public Health', 'Epidemiology & Public Health'], categories: [DepartmentCategory.HEALTH_MEDICINE], ysmAcronymCodes: ['EPH', 'YSPH'], codeSystemPreference: DepartmentCodeSystem.YSM_ACRONYM },
  { abbreviation: 'R&BI', name: 'Radiology & Biomedical Imaging', aliases: ['Radiology and Biomedical Imaging'], categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Radiology & Biomedical Imaging' },
  { abbreviation: 'RLST', name: 'Religious Studies', categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'SLAV', name: 'Slavic Languages and Literatures', aliases: ['Slavic Languages & Literatures'], categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'SOCY', name: 'Sociology', categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'SAST', name: 'South Asian Studies', categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'SPAN', name: 'Spanish', aliases: ['SPAN/PORT', 'Spanish & Portuguese', 'Spanish and Portuguese', 'Portuguese', 'PORT'], categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'S&DS', name: 'Statistics and Data Science', aliases: ['Statistics & Data Science', 'Statistics'], categories: [DepartmentCategory.MATHEMATICS, DepartmentCategory.COMPUTING_AI] },
  { abbreviation: 'SURG', name: 'Surgery', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Surgery' },
  { abbreviation: 'TDPS', name: 'Theater, Dance, and Performance Studies', aliases: ['Theater, Dance, & Performance Studies', 'Theater Studies', 'THST'], categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: 'TRAD', name: 'Therapeutic Radiology', aliases: ['Therapeutic Radiology/Radiation Oncology'], categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Therapeutic Radiology' },
  { abbreviation: 'URLG', name: 'Urology', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmDepartmentName: 'Urology' },
  { abbreviation: 'WGSS', name: "Women's, Gender, and Sexuality Studies", aliases: ["Women's, Gender, & Sexuality Studies"], categories: [DepartmentCategory.HUMANITIES_ARTS, DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: 'YSM', name: 'Yale School of Medicine', categories: [DepartmentCategory.HEALTH_MEDICINE], ysmAcronymCodes: ['YSM'], codeSystemPreference: DepartmentCodeSystem.YSM_ACRONYM },
];

const SPACE_RE = /\s+/g;

export function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&ndash;|&#8211;/g, '-')
    .replace(/&mdash;|&#8212;/g, '-')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .replace(SPACE_RE, ' ')
    .trim();
}

export function normalizeDepartmentKey(value: string): string {
  return decodeHtml(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(previously|also)\b.*$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(SPACE_RE, ' ')
    .trim();
}

function normalizeCode(value: string): string {
  return decodeHtml(value).trim().toUpperCase();
}

function withoutPreviously(value: string): string {
  return decodeHtml(value).replace(/\s*\((?:previously|formerly)[^)]+\)\s*$/i, '').trim();
}

function unique(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = decodeHtml(value);
    if (!trimmed) continue;
    const key = normalizeDepartmentKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function parseYcpsSubjectAbbreviations(html: string): ParsedYcpsSubject[] {
  const rows: ParsedYcpsSubject[] = [];
  const rowRe = /<tr\b[^>]*>\s*<td\b[^>]*class="column0"[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*class="column1"[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html)) !== null) {
    const code = normalizeCode(match[1]);
    const name = withoutPreviously(match[2]);
    if (!code || !name || code === 'CODE') continue;
    rows.push({ code, name });
  }
  return rows;
}

export function parseYsmDepartments(html: string): string[] {
  const labels = new Set<string>();
  const labelRe = /<span\b[^>]*class="link__label"[^>]*>([\s\S]*?)<\/span>/gi;
  let match: RegExpExecArray | null;
  while ((match = labelRe.exec(html)) !== null) {
    const label = decodeHtml(match[1]);
    if (!label || /department leadership/i.test(label)) continue;
    labels.add(label);
  }
  return Array.from(labels);
}

export function parseYsmAcronyms(html: string): ParsedYsmAcronym[] {
  const rows: ParsedYsmAcronym[] = [];
  const itemRe = /<strong\b[^>]*class="arx-bold-text"[^>]*>\s*([^<]+?)\s*<\/strong>\s*\(([^)]*?)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(html)) !== null) {
    const code = normalizeCode(match[1]);
    const expansion = decodeHtml(match[2]);
    if (!code || !expansion) continue;
    const aliases = expansion
      .split(/\s*,\s*(?:also\s+)?/i)
      .map((part) => part.trim())
      .filter(Boolean);
    rows.push({ code, expansion, aliases });
  }
  return rows;
}

function sourceRecord(
  sourceKey: DepartmentSourceRecord['sourceKey'],
  matchedName: string,
  codeSystem: DepartmentCodeSystem,
  matchedCode?: string,
): DepartmentSourceRecord {
  return {
    sourceKey,
    sourceUrl: sourceKey === 'app_overlay' ? 'data-migration/departmentGroundTruth.ts' : departmentSourceUrls[sourceKey],
    matchedName,
    matchedCode,
    codeSystem,
  };
}

function mapByCode<T extends { code: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [normalizeCode(row.code), row]));
}

function mapByName(rows: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) map.set(normalizeDepartmentKey(row), row);
  return map;
}

function mapYcpsByName(rows: ParsedYcpsSubject[]): Map<string, ParsedYcpsSubject[]> {
  const map = new Map<string, ParsedYcpsSubject[]>();
  for (const row of rows) {
    const key = normalizeDepartmentKey(row.name);
    const existing = map.get(key) || [];
    existing.push(row);
    map.set(key, existing);
  }
  return map;
}

function findByAnyName(map: Map<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const hit = map.get(normalizeDepartmentKey(name));
    if (hit) return hit;
  }
  return undefined;
}

function addSourceRecord(
  records: DepartmentSourceRecord[],
  seen: Set<string>,
  record: DepartmentSourceRecord,
): void {
  const key = [
    record.sourceKey,
    record.codeSystem,
    normalizeDepartmentKey(record.matchedName),
    normalizeCode(record.matchedCode || ''),
  ].join('|');
  if (seen.has(key)) return;
  seen.add(key);
  records.push(record);
}

function chooseCodeSystem(
  curated: CuratedDepartment,
  records: DepartmentSourceRecord[],
): DepartmentCodeSystem {
  if (curated.codeSystemPreference) return curated.codeSystemPreference;
  if (records.some((record) => record.codeSystem === DepartmentCodeSystem.YCPS_SUBJECT)) {
    return DepartmentCodeSystem.YCPS_SUBJECT;
  }
  if (records.some((record) => record.codeSystem === DepartmentCodeSystem.YSM_ACRONYM)) {
    return DepartmentCodeSystem.YSM_ACRONYM;
  }
  if (records.some((record) => record.codeSystem === DepartmentCodeSystem.YSM_DEPARTMENT)) {
    return DepartmentCodeSystem.YSM_DEPARTMENT;
  }
  return DepartmentCodeSystem.APP_LOCAL;
}

function buildRowsFromSources(args: {
  ycpsSubjects: ParsedYcpsSubject[];
  ysmDepartments: string[];
  ysmAcronyms: ParsedYsmAcronym[];
}): DepartmentSeedRow[] {
  const ycpsByCode = mapByCode(args.ycpsSubjects);
  const ycpsByName = mapYcpsByName(args.ycpsSubjects);
  const ysmDeptByName = mapByName(args.ysmDepartments);
  const acronymByCode = mapByCode(args.ysmAcronyms);

  return curatedDepartments.map((curated) => {
    const aliasCandidates = new Set<string>(curated.aliases || []);
    const records: DepartmentSourceRecord[] = [];
    const seenRecords = new Set<string>();
    const ycpsMatches = new Map<string, ParsedYcpsSubject>();
    const ycpsCodeCandidates = unique([
      curated.abbreviation,
      curated.ycpsCode || '',
      ...(curated.ycpsCodes || []),
      ...(curated.aliases || []),
    ]);

    for (const code of ycpsCodeCandidates) {
      const ycps = ycpsByCode.get(normalizeCode(code));
      if (ycps) ycpsMatches.set(normalizeCode(ycps.code), ycps);
    }

    for (const name of unique([curated.name, ...(curated.aliases || [])])) {
      for (const ycps of ycpsByName.get(normalizeDepartmentKey(name)) || []) {
        ycpsMatches.set(normalizeCode(ycps.code), ycps);
      }
    }

    for (const ycps of ycpsMatches.values()) {
      addSourceRecord(
        records,
        seenRecords,
        sourceRecord('ycpsSubjectAbbreviations', ycps.name, DepartmentCodeSystem.YCPS_SUBJECT, ycps.code),
      );
      aliasCandidates.add(ycps.name);
      if (normalizeCode(ycps.code) !== normalizeCode(curated.abbreviation)) {
        aliasCandidates.add(ycps.code);
      }
    }

    const ysmDepartment = findByAnyName(ysmDeptByName, [
      curated.ysmDepartmentName || '',
      curated.name,
      ...(curated.aliases || []),
    ]);
    if (ysmDepartment) {
      addSourceRecord(
        records,
        seenRecords,
        sourceRecord('ysmDepartments', ysmDepartment, DepartmentCodeSystem.YSM_DEPARTMENT),
      );
      aliasCandidates.add(ysmDepartment);
    }

    const acronymCodes = unique([curated.abbreviation, ...(curated.ysmAcronymCodes || [])]);
    for (const code of acronymCodes) {
      const acronym = acronymByCode.get(normalizeCode(code));
      if (!acronym) continue;
      addSourceRecord(
        records,
        seenRecords,
        sourceRecord('ysmAcronyms', acronym.expansion, DepartmentCodeSystem.YSM_ACRONYM, acronym.code),
      );
      aliasCandidates.add(acronym.code);
      for (const alias of acronym.aliases) aliasCandidates.add(alias);
    }

    if (records.length === 0) {
      addSourceRecord(
        records,
        seenRecords,
        sourceRecord('app_overlay', curated.name, DepartmentCodeSystem.APP_LOCAL, curated.abbreviation),
      );
    }

    const codeSystem = chooseCodeSystem(curated, records);
    const aliases = unique(aliasCandidates).filter(
      (alias) =>
        normalizeDepartmentKey(alias) !== normalizeDepartmentKey(curated.name) &&
        normalizeDepartmentKey(alias) !== normalizeDepartmentKey(curated.abbreviation),
    );

    return {
      abbreviation: normalizeCode(curated.abbreviation),
      name: decodeHtml(curated.name),
      displayName: `${normalizeCode(curated.abbreviation)} - ${decodeHtml(curated.name)}`,
      categories: curated.categories,
      primaryCategory: curated.categories[0],
      colorKey: categoryColorKeys[curated.categories[0]],
      aliases,
      sourceRecords: records,
      codeSystem,
      isActive: true,
    };
  });
}

export function validateDepartmentRows(rows: DepartmentSeedRow[]): string[] {
  const errors: string[] = [];
  const byAbbreviation = new Map<string, string>();
  const byName = new Map<string, string>();
  const validCategories = new Set<string>(Object.values(DepartmentCategory));
  const validCodeSystems = new Set<string>(Object.values(DepartmentCodeSystem));

  for (const row of rows) {
    if (!row.abbreviation) errors.push(`${row.name}: missing abbreviation`);
    if (!row.name) errors.push(`${row.abbreviation}: missing name`);
    if (row.displayName !== `${row.abbreviation} - ${row.name}`) {
      errors.push(`${row.abbreviation}: displayName must be "${row.abbreviation} - ${row.name}"`);
    }
    if (!row.categories.length) errors.push(`${row.abbreviation}: missing categories`);
    for (const category of row.categories) {
      if (!validCategories.has(category)) errors.push(`${row.abbreviation}: invalid category "${category}"`);
    }
    if (!validCategories.has(row.primaryCategory)) {
      errors.push(`${row.abbreviation}: invalid primaryCategory "${row.primaryCategory}"`);
    }
    if (row.primaryCategory !== row.categories[0]) {
      errors.push(`${row.abbreviation}: primaryCategory must be first category`);
    }
    if (row.colorKey !== categoryColorKeys[row.primaryCategory]) {
      errors.push(`${row.abbreviation}: colorKey does not match primaryCategory`);
    }
    if (!row.sourceRecords.length) errors.push(`${row.abbreviation}: missing sourceRecords`);
    for (const record of row.sourceRecords) {
      if (!record.sourceKey) errors.push(`${row.abbreviation}: sourceRecord missing sourceKey`);
      if (!record.sourceUrl) errors.push(`${row.abbreviation}: sourceRecord missing sourceUrl`);
      if (!record.matchedName) errors.push(`${row.abbreviation}: sourceRecord missing matchedName`);
      if (!validCodeSystems.has(record.codeSystem)) {
        errors.push(`${row.abbreviation}: sourceRecord has invalid codeSystem "${record.codeSystem}"`);
      }
    }
    if (row.codeSystem !== DepartmentCodeSystem.APP_LOCAL && row.sourceRecords.every((record) => record.codeSystem === DepartmentCodeSystem.APP_LOCAL)) {
      errors.push(`${row.abbreviation}: non-local codeSystem needs official source evidence`);
    }

    const abbreviationKey = normalizeCode(row.abbreviation);
    if (byAbbreviation.has(abbreviationKey)) {
      errors.push(`${row.abbreviation}: duplicate abbreviation also used by ${byAbbreviation.get(abbreviationKey)}`);
    }
    byAbbreviation.set(abbreviationKey, row.name);

    const nameKey = normalizeDepartmentKey(row.name);
    if (byName.has(nameKey)) {
      errors.push(`${row.name}: duplicate name also used by ${byName.get(nameKey)}`);
    }
    byName.set(nameKey, row.abbreviation);

    const aliasKeys = new Map<string, string>();
    for (const alias of row.aliases || []) {
      const aliasKey = normalizeDepartmentKey(alias);
      if (!aliasKey) continue;
      if (aliasKey === nameKey || aliasKey === normalizeDepartmentKey(row.displayName) || aliasKey === normalizeDepartmentKey(row.abbreviation)) {
        errors.push(`${row.abbreviation}: alias duplicates primary identity "${alias}"`);
      }
      if (aliasKeys.has(aliasKey)) {
        errors.push(`${row.abbreviation}: duplicate alias "${alias}" also represented by "${aliasKeys.get(aliasKey)}"`);
      }
      aliasKeys.set(aliasKey, alias);
    }
  }

  return errors;
}

function validateSourceCounts(args: {
  ycpsSubjects: ParsedYcpsSubject[];
  ysmDepartments: string[];
  ysmAcronyms: ParsedYsmAcronym[];
}): string[] {
  const errors: string[] = [];
  if (args.ycpsSubjects.length === 0) {
    errors.push('YCPS subject abbreviation parser returned zero rows');
  }
  if (args.ysmDepartments.length === 0) {
    errors.push('YSM Departments & Centers parser returned zero rows');
  }
  if (args.ysmAcronyms.length === 0) {
    errors.push('YSM abbreviations parser returned zero rows');
  }
  return errors;
}

function defaultFetch(): HtmlFetch {
  const fn = (globalThis as any).fetch;
  if (typeof fn !== 'function') {
    throw new Error('Global fetch is unavailable; run this script with Node 20+.');
  }
  return fn.bind(globalThis) as HtmlFetch;
}

export async function buildDepartmentGroundTruth(fetchHtml: HtmlFetch = defaultFetch()): Promise<GroundTruthBuildResult> {
  const [ycpsHtml, ysmDepartmentsHtml, ysmAcronymsHtml] = await Promise.all([
    fetchHtml(departmentSourceUrls.ycpsSubjectAbbreviations).then((res) => res.text()),
    fetchHtml(departmentSourceUrls.ysmDepartments).then((res) => res.text()),
    fetchHtml(departmentSourceUrls.ysmAcronyms).then((res) => res.text()),
  ]);

  const ycpsSubjects = parseYcpsSubjectAbbreviations(ycpsHtml);
  const ysmDepartments = parseYsmDepartments(ysmDepartmentsHtml);
  const ysmAcronyms = parseYsmAcronyms(ysmAcronymsHtml);
  const sourceErrors = validateSourceCounts({ ycpsSubjects, ysmDepartments, ysmAcronyms });
  if (sourceErrors.length > 0) {
    throw new Error(`Department source parsing failed:\n${sourceErrors.join('\n')}`);
  }

  const departments = buildRowsFromSources({ ycpsSubjects, ysmDepartments, ysmAcronyms });
  const errors = validateDepartmentRows(departments);

  if (errors.length > 0) {
    throw new Error(`Department ground truth validation failed:\n${errors.join('\n')}`);
  }

  return {
    departments,
    sourceCounts: {
      ycpsSubjects: ycpsSubjects.length,
      ysmDepartments: ysmDepartments.length,
      ysmAcronyms: ysmAcronyms.length,
    },
    localOnlyRows: departments.filter((row) => row.codeSystem === DepartmentCodeSystem.APP_LOCAL),
  };
}

function comparableRow(row: Partial<DepartmentSeedRow>): Record<string, unknown> {
  return {
    abbreviation: row.abbreviation,
    name: row.name,
    displayName: row.displayName,
    categories: row.categories || [],
    primaryCategory: row.primaryCategory,
    colorKey: row.colorKey,
    aliases: row.aliases || [],
    sourceRecords: row.sourceRecords || [],
    codeSystem: row.codeSystem || DepartmentCodeSystem.APP_LOCAL,
    isActive: row.isActive !== false,
  };
}

export interface DepartmentDiff {
  creates: DepartmentSeedRow[];
  updates: Array<{ before: any; after: DepartmentSeedRow }>;
  deactivates: any[];
  unchanged: DepartmentSeedRow[];
}

export function diffDepartmentRows(existingRows: any[], targetRows: DepartmentSeedRow[]): DepartmentDiff {
  const existingByAbbr = new Map(existingRows.map((row) => [normalizeCode(row.abbreviation || ''), row]));
  const targetByAbbr = new Map(targetRows.map((row) => [normalizeCode(row.abbreviation), row]));
  const diff: DepartmentDiff = {
    creates: [],
    updates: [],
    deactivates: [],
    unchanged: [],
  };

  for (const target of targetRows) {
    const existing = existingByAbbr.get(normalizeCode(target.abbreviation));
    if (!existing) {
      diff.creates.push(target);
      continue;
    }

    if (JSON.stringify(comparableRow(existing)) === JSON.stringify(comparableRow(target))) {
      diff.unchanged.push(target);
    } else {
      diff.updates.push({ before: existing, after: target });
    }
  }

  for (const existing of existingRows) {
    if (existing?.isActive === false) continue;
    const key = normalizeCode(existing.abbreviation || '');
    if (key && !targetByAbbr.has(key)) diff.deactivates.push(existing);
  }

  return diff;
}

export function buildResolverKeys(rows: Array<Pick<DepartmentSeedRow, 'abbreviation' | 'name' | 'displayName' | 'aliases'>>): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const value of [row.abbreviation, row.name, row.displayName, ...(row.aliases || [])]) {
      if (value) keys.add(normalizeDepartmentKey(value));
    }

    const codeCandidates = [row.abbreviation, ...(row.aliases || [])].filter(isDepartmentCodeLike);
    const labelCandidates = [row.name, ...(row.aliases || [])].filter(
      (value) => value && !isDepartmentCodeLike(value),
    );
    for (const code of codeCandidates) {
      for (const label of labelCandidates) {
        keys.add(normalizeDepartmentKey(`${code} - ${label}`));
      }
    }
  }
  return keys;
}

function isDepartmentCodeLike(value: string | undefined): value is string {
  const trimmed = decodeHtml(value || '');
  if (!trimmed || trimmed.length > 16) return false;
  return /^[A-Z0-9&/ -]+$/.test(trimmed) && /[A-Z]/.test(trimmed);
}
