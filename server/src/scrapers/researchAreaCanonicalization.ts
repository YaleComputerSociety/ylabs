import { ResearchArea } from '../models/researchArea';
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
  canonicalizeResearchAreas(raw: unknown): { values: string[]; unmatched: string[] };
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
      const seen = new Set<string>();
      for (const entry of toRawList(raw)) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        const hit = resolveExact(trimmed);
        const canonical = hit ?? trimmed;
        if (!hit) unmatched.push(trimmed);
        const dedupeKey = canonical.toLocaleLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        values.push(canonical);
      }
      return { values, unmatched };
    },
    matchCanonicalResearchAreas(raw) {
      const values: string[] = [];
      const seen = new Set<string>();
      for (const entry of toRawList(raw)) {
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
  const rows = await ResearchArea.find({}).select({ name: 1 }).lean<Array<{ name: string }>>();
  return createResearchAreaCanonicalizer(
    buildResearchAreaResolverIndex(rows.map((row) => ({ name: row.name }))),
  );
}

export async function getResearchAreaCanonicalizer(): Promise<ResearchAreaCanonicalizer> {
  if (!cachedCanonicalizer) {
    cachedCanonicalizer = await buildCanonicalizerFromDatabase();
  }
  return cachedCanonicalizer;
}

/**
 * Canonicalizes a research-entity materialization `$set` in place: the
 * `researchAreas[]` strings are rewritten to their canonical catalog names when
 * they resolve and left as their raw trimmed values otherwise, deduped. Never
 * throws - a canonicalization failure or an unseeded `research_areas` collection
 * leaves the raw scraped values untouched so materialization keeps working.
 */
export async function applyResearchEntityResearchAreaCanonicalization(
  set: Record<string, unknown>,
): Promise<{ unmatchedResearchAreas: string[] }> {
  const result: { unmatchedResearchAreas: string[] } = { unmatchedResearchAreas: [] };
  if (!Object.prototype.hasOwnProperty.call(set, 'researchAreas')) return result;
  if (!Array.isArray(set.researchAreas)) return result;

  try {
    const canonicalizer = await getResearchAreaCanonicalizer();
    const canonical = canonicalizer.canonicalizeResearchAreas(set.researchAreas);
    set.researchAreas = canonical.values;
    result.unmatchedResearchAreas = canonical.unmatched;
  } catch {
    return result;
  }

  return result;
}
