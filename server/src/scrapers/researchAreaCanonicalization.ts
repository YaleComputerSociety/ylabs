import { TaxonomyTerm } from '../models/taxonomyTerm';
import { slugify } from './utils/scraperHelpers';

export interface ResearchAreaResolverRow {
  name: string;
  aliases?: string[];
}

export interface ResearchAreaPhrase {
  phrase: string;
  tokens: number;
  canonical: string;
}

export interface ResearchAreaResolverIndex {
  exact: Map<string, string>;
  phrases: ResearchAreaPhrase[];
}

export interface ResearchAreaCanonicalizer {
  canonicalizeResearchAreas(raw: unknown): {
    values: string[];
    unmatched: string[];
    dropped: string[];
  };
  matchCanonicalResearchAreas(raw: unknown): string[];
  deriveResearchAreasFromText(text: unknown): string[];
}

/**
 * Curated aliases for scraped variants that will not slug-match a canonical
 * research-area name. Only applied when the canonical target is present in the
 * resolver rows, so a stale alias can never invent an area outside the seeded
 * catalog.
 */
export const RESEARCH_AREA_ALIASES: Record<string, string[]> = {
  'Artificial Intelligence': ['AI'],
  'Machine Learning': ['ML'],
  'Natural Language Processing': ['NLP'],
  'Computer Vision': ['CV'],
  'Human-Computer Interaction': ['HCI', 'Human Computer Interaction'],
  'Large Language Models': ['LLM', 'LLMs'],
  'Environmental Science': ['Environmental Sciences'],
  Neuroscience: ['Neurosciences'],
  'Public Health': ['Population Health'],
  'Cell Biology': ['Cellular Biology'],
  'Developmental Biology': ['Development Biology'],
  'Political Science': ['Politics'],
  'Art History': ['History of Art'],
  'Planetary Science': ['Planetary Sciences'],
  'Materials Science': ['Materials Sciences'],
  'Reproductive Medicine': ['Reproductive Sciences'],
};

function researchAreaLeakageKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[:;.,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scraped section headers, role/status labels, and publication chrome that leak
 * into `researchAreas[]` as extraction artifacts rather than topics (issue #208
 * area slice). Matched leakage is dropped at ingest so it never becomes an area,
 * canonical or raw, and never pollutes the review queue. The set is intentionally
 * conservative - only unambiguous non-topics - so a real area is never dropped.
 */
const RESEARCH_AREA_LEAKAGE_KEYS: ReadonlySet<string> = new Set([
  'research area',
  'research areas',
  'area of research',
  'areas of research',
  'active areas of research',
  'area of interest',
  'areas of interest',
  'area of focus',
  'areas of focus',
  'area of specialization',
  'areas of specialization',
  'area of expertise',
  'areas of expertise',
  'research focus',
  'research interest',
  'research interests',
  'research topics',
  'field of interest',
  'fields of interest',
  'field of study',
  'fields of study',
  'specialization',
  'teaching interest',
  'teaching interests',
  'theorist',
  'experimentalist',
  'observational',
  'observer',
  'emeritus',
  'faculty',
  'researcher',
  'ysm researcher',
  'ysm researchers',
  'principal investigator',
  'publication',
  'publications',
  'citation',
  'citations',
  'concept',
  'concepts',
  'keyword',
  'keywords',
  'keywords and concepts',
  'overview',
  'biography',
  'about',
  'profile',
  'n/a',
  'na',
  'none',
]);

const RESEARCH_AREA_LEAKAGE_PATTERNS: readonly RegExp[] = [
  /^\d+\s*ysm\s+researchers?$/i,
  /^[\d.,]+$/,
];

export function isResearchAreaLabelLeakage(raw: unknown): boolean {
  const key = researchAreaLeakageKey(raw);
  if (!key) return false;
  if (RESEARCH_AREA_LEAKAGE_KEYS.has(key)) return true;
  return RESEARCH_AREA_LEAKAGE_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Single-word canonical area names that are common-English or generic enough to
 * fire non-topically in free-text prose ("state of the art", "literature
 * review", "study design", "family history"). They are kept out of the
 * description phrase scan to protect precision; they still resolve through the
 * exact index when they appear as a whole existing-area or department string.
 * Any single-word canonical name not listed here is a specific technical term
 * (Immunology, Genomics, Bioinformatics, ...) and is safe to derive from prose.
 */
export const AMBIGUOUS_SINGLE_WORD_AREAS: readonly string[] = [
  'Accounting',
  'Aesthetics',
  'Architecture',
  'Art',
  'Auditing',
  'Banking',
  'Cinema',
  'Classics',
  'Composition',
  'Dance',
  'Design',
  'Drama',
  'Economics',
  'Education',
  'Emotion',
  'Ethics',
  'Fiction',
  'Finance',
  'Governance',
  'History',
  'Immigration',
  'Inequality',
  'Investment',
  'Law',
  'Literature',
  'Logic',
  'Longevity',
  'Manufacturing',
  'Medicine',
  'Music',
  'Optimization',
  'Philosophy',
  'Photography',
  'Poetry',
  'Rhetoric',
  'Statistics',
  'Surgery',
  'Sustainability',
  'Theater',
  'Topology',
];

const MULTI_WORD_TOKEN_MINIMUM = 2;

export function researchAreaMatchKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return slugify(raw).replace(/^the-/, '');
}

const AMBIGUOUS_SINGLE_WORD_AREA_KEYS = new Set(
  AMBIGUOUS_SINGLE_WORD_AREAS.map((name) => researchAreaMatchKey(name)),
);

/**
 * Space-delimited, diacritic-stripped scan form padded with single spaces so a
 * canonical phrase only matches on whole-word boundaries when tested with
 * `includes`, never as a substring of a longer token.
 */
function textScanForm(raw: unknown): string {
  if (typeof raw !== 'string') return ' ';
  const normalized = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['‘’]s\b/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${normalized} `;
}

function phraseFromSlug(
  canonical: string,
  value: string,
  allowSingleWord: boolean,
): ResearchAreaPhrase | null {
  const scan = textScanForm(value).trim();
  if (!scan) return null;
  const tokens = scan.split(' ').filter(Boolean).length;
  if (tokens < MULTI_WORD_TOKEN_MINIMUM && !allowSingleWord) return null;
  return { phrase: ` ${scan} `, tokens, canonical };
}

/**
 * Deterministic normalized-key -> canonical research-area index plus a phrase
 * list for description scanning. Earlier rows win on a key collision. Multi-word
 * canonical names and multi-word aliases always join the phrase list. A
 * single-word canonical name joins it only when it is a specific technical term
 * (not in `AMBIGUOUS_SINGLE_WORD_AREAS`), so prose can recover "Immunology" or
 * "Bioinformatics" while a generic word ("art", "law", "history") can only be
 * recovered through the exact index from an existing-area or department string.
 * Single-word aliases (abbreviations like "CV") stay out of the phrase list to
 * avoid colliding with unrelated prose tokens.
 */
export function buildResearchAreaResolverIndex(
  rows: ResearchAreaResolverRow[],
): ResearchAreaResolverIndex {
  const exact = new Map<string, string>();
  const phrases: ResearchAreaPhrase[] = [];
  for (const row of rows) {
    const aliases = [...(row.aliases || []), ...(RESEARCH_AREA_ALIASES[row.name] || [])];
    for (const value of [row.name, ...aliases]) {
      const key = researchAreaMatchKey(value);
      if (key && !exact.has(key)) exact.set(key, row.name);
    }
    const nameAllowsSingleWord = !AMBIGUOUS_SINGLE_WORD_AREA_KEYS.has(
      researchAreaMatchKey(row.name),
    );
    const namePhrase = phraseFromSlug(row.name, row.name, nameAllowsSingleWord);
    if (namePhrase) phrases.push(namePhrase);
    for (const alias of aliases) {
      const aliasPhrase = phraseFromSlug(row.name, alias, false);
      if (aliasPhrase) phrases.push(aliasPhrase);
    }
  }
  phrases.sort((left, right) => right.tokens - left.tokens);
  return { exact, phrases };
}

function toRawList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === 'string');
  if (typeof raw === 'string') return [raw];
  return [];
}

const YSM_RESEARCHER_CHROME_BLOCK =
  /\s*\d*\s*YSM\s+Researchers?\s*View\s*\d*\s*Related\s+Publications?/gi;

function hasYsmResearcherChrome(value: string): boolean {
  return new RegExp(YSM_RESEARCHER_CHROME_BLOCK.source, 'i').test(value);
}

/**
 * A single scraped area value can glue several real topics to Yale School of
 * Medicine profile widget chrome ("<Topic><researcherCount> YSM Researchers View
 * <pubCount> Related Publications<NextTopic>..."). Split on the repeating chrome
 * block to recover each topic, drop a researcher-count run left glued to a topic
 * name, and discard segments that are pure chrome, so a corrupted glued value
 * yields clean topic strings instead of a chrome fragment (issue #487).
 */
export function stripResearchAreaSourceChrome(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const value = raw.replace(/\s+/g, ' ').trim();
  if (!value) return [];
  if (!hasYsmResearcherChrome(value)) return [value];
  return value
    .split(YSM_RESEARCHER_CHROME_BLOCK)
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .map((segment) => segment.replace(/(?<=\p{L})\d{1,4}$/u, '').trim())
    .filter(Boolean);
}

function expandRawResearchAreaEntries(raw: unknown): string[] {
  return toRawList(raw).flatMap((entry) => stripResearchAreaSourceChrome(entry));
}

export function createResearchAreaCanonicalizer(
  index: ResearchAreaResolverIndex,
): ResearchAreaCanonicalizer {
  const resolveExact = (raw: unknown): string | null => {
    const key = researchAreaMatchKey(raw);
    if (!key) return null;
    return index.exact.get(key) || null;
  };

  return {
    canonicalizeResearchAreas(raw) {
      const values: string[] = [];
      const unmatched: string[] = [];
      const dropped: string[] = [];
      const seen = new Set<string>();
      for (const entry of expandRawResearchAreaEntries(raw)) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        if (isResearchAreaLabelLeakage(trimmed)) {
          dropped.push(trimmed);
          continue;
        }
        const hit = resolveExact(trimmed);
        const canonical = hit ?? trimmed;
        if (!hit) unmatched.push(trimmed);
        const dedupeKey = canonical.toLocaleLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        values.push(canonical);
      }
      return { values, unmatched, dropped };
    },
    matchCanonicalResearchAreas(raw) {
      const values: string[] = [];
      const seen = new Set<string>();
      for (const entry of expandRawResearchAreaEntries(raw)) {
        if (isResearchAreaLabelLeakage(entry)) continue;
        const hit = resolveExact(entry);
        if (!hit) continue;
        if (seen.has(hit)) continue;
        seen.add(hit);
        values.push(hit);
      }
      return values;
    },
    deriveResearchAreasFromText(text) {
      const scan = textScanForm(text);
      if (scan.trim().length === 0) return [];
      const values: string[] = [];
      const seen = new Set<string>();
      for (const { phrase, canonical } of index.phrases) {
        if (seen.has(canonical)) continue;
        if (scan.includes(phrase)) {
          seen.add(canonical);
          values.push(canonical);
        }
      }
      return values;
    },
  };
}

let cachedCanonicalizer: ResearchAreaCanonicalizer | null = null;

export function resetResearchAreaCanonicalizerCache(): void {
  cachedCanonicalizer = null;
}

export function setResearchAreaCanonicalizerForTesting(
  canonicalizer: ResearchAreaCanonicalizer | null,
): void {
  cachedCanonicalizer = canonicalizer;
}

async function buildCanonicalizerFromDatabase(): Promise<ResearchAreaCanonicalizer> {
  const rows = await TaxonomyTerm.find({
    reviewStatus: 'APPROVED',
    status: 'ACTIVE',
    archived: false,
  })
    .select({ label: 1, aliases: 1 })
    .lean<Array<{ label: string; aliases?: string[] }>>();
  return createResearchAreaCanonicalizer(
    buildResearchAreaResolverIndex(rows.map((row) => ({ name: row.label, aliases: row.aliases }))),
  );
}

export async function getResearchAreaCanonicalizer(): Promise<ResearchAreaCanonicalizer> {
  if (!cachedCanonicalizer) {
    cachedCanonicalizer = await buildCanonicalizerFromDatabase();
  }
  return cachedCanonicalizer;
}

/**
 * Canonicalizes a research-entity materialization `$set` in place: scraper-label
 * leakage is dropped, the surviving `researchAreas[]` strings are rewritten to
 * their canonical `TaxonomyTerm` names when they resolve against an approved term
 * and left as their raw trimmed values otherwise, deduped. Never throws - a
 * canonicalization failure or an unseeded/empty approved `taxonomy_terms`
 * registry leaves the raw scraped values untouched so materialization keeps
 * working (fail closed to raw, never guess-collapse distinct topics).
 */
export async function applyResearchEntityResearchAreaCanonicalization(
  set: Record<string, unknown>,
): Promise<{ unmatchedResearchAreas: string[]; droppedResearchAreas: string[] }> {
  const result: { unmatchedResearchAreas: string[]; droppedResearchAreas: string[] } = {
    unmatchedResearchAreas: [],
    droppedResearchAreas: [],
  };
  if (!Object.prototype.hasOwnProperty.call(set, 'researchAreas')) return result;
  if (!Array.isArray(set.researchAreas)) return result;

  try {
    const canonicalizer = await getResearchAreaCanonicalizer();
    const canonical = canonicalizer.canonicalizeResearchAreas(set.researchAreas);
    set.researchAreas = canonical.values;
    result.unmatchedResearchAreas = canonical.unmatched;
    result.droppedResearchAreas = canonical.dropped;
  } catch {
    return result;
  }

  return result;
}
