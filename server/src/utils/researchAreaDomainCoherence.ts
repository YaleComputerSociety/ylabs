import { AMBIGUOUS_SINGLE_WORD_AREAS } from '../scrapers/researchAreaCanonicalization';

/**
 * #1407's second graft mechanism: a `researchAreas[]` chip with no
 * `fieldProvenance.researchAreas` entry at all - a synthesized topic cluster
 * that was never tied to any source observation - so there is no provenance
 * trail an identity-merge guard (`personProfileEntityMatch`) could reconcile it
 * against. This is a coherence check, not a source check: a chip is dropped
 * only when the entity's own sourced text (name/departments/description) shares
 * no significant vocabulary with it at all, which is the same bar the #1407
 * audit used to separate unambiguous full-grafts (Fischel/Vargas/Hinton, all
 * chips alien) from genuine interdisciplinary scholars (Kraus, one arguably
 * off-field chip out of five - deliberately left alone by the manual drain in
 * PR #1593). A chip with any provenance is left untouched here regardless of
 * topic distance; that is #1407's first (identity-merge) mechanism's territory.
 */

const MIN_SIGNIFICANT_TOKEN_LENGTH = 4;
const FUZZY_TOKEN_PREFIX_LENGTH = 5;
const MIN_CONTEXT_TOKENS = 3;

const COHERENCE_STOPWORDS: ReadonlySet<string> = new Set([
  'about',
  'across',
  'address',
  'addresses',
  'addressing',
  'additionally',
  'after',
  'among',
  'areas',
  'contemporary',
  'context',
  'contexts',
  'department',
  'departments',
  'examine',
  'examines',
  'examining',
  'explore',
  'explores',
  'exploring',
  'faculty',
  'field',
  'fields',
  'focus',
  'focuses',
  'focusing',
  'from',
  'general',
  'group',
  'groups',
  'historical',
  'impact',
  'impacted',
  'impacts',
  'institute',
  'institutes',
  'interest',
  'interests',
  'investigate',
  'investigates',
  'investigating',
  'issue',
  'issues',
  'laboratory',
  'laboratories',
  'other',
  'particularly',
  'practice',
  'practices',
  'program',
  'programs',
  'related',
  'research',
  'researches',
  'researching',
  'science',
  'sciences',
  'study',
  'studied',
  'studies',
  'studying',
  'their',
  'theme',
  'themes',
  'theory',
  'theories',
  'these',
  'through',
  'topic',
  'topics',
  'which',
  'with',
  'work',
  'working',
  'works',
  'yale',
]);

const AMBIGUOUS_SINGLE_WORD_AREA_KEYS: ReadonlySet<string> = new Set(
  AMBIGUOUS_SINGLE_WORD_AREAS.map((area) => area.toLowerCase()),
);

function fuzzyToken(token: string): string {
  return token.slice(0, FUZZY_TOKEN_PREFIX_LENGTH);
}

function flattenTextSource(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenTextSource).join(' ');
  return '';
}

function significantTokens(...sources: unknown[]): Set<string> {
  const tokens = flattenTextSource(sources)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length >= MIN_SIGNIFICANT_TOKEN_LENGTH && !COHERENCE_STOPWORDS.has(token));
  return new Set(tokens.map(fuzzyToken));
}

function hasOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const token of a) {
    if (b.has(token)) return true;
  }
  return false;
}

export interface ResearchAreaCoherenceContext {
  name?: unknown;
  displayName?: unknown;
  departments?: unknown;
  shortDescription?: unknown;
  fullDescription?: unknown;
}

/**
 * `fieldProvenance` is a Mongoose `Map` of field name to provenance record;
 * `.lean()` reads (and the plain objects this repo passes around at serve
 * time) surface it as a plain object, so a direct key lookup is enough. Absent
 * or explicitly cleared counts as unsourced - only an actual recorded entry
 * counts as provenance.
 */
export function hasResearchAreaProvenance(fieldProvenance: unknown): boolean {
  if (!fieldProvenance || typeof fieldProvenance !== 'object') return false;
  const entry = (fieldProvenance as Record<string, unknown>).researchAreas;
  return entry !== undefined && entry !== null;
}

/**
 * Drops a `researchAreas` chip only when it has no `fieldProvenance` backing
 * and shares no significant (stopword-filtered, prefix-5 fuzzy) token with the
 * entity's own name, departments, or descriptions. Requires at least a handful
 * of the entity's own significant tokens before judging anything, so a sparse
 * entity with too little text to corroborate against is left untouched rather
 * than having every chip judged unreachable. A chip that canonicalizes to a
 * generic single-word area name (`Law`, `History`, `Medicine`, ...) is always
 * kept - those are too ambiguous to fairly judge by vocabulary overlap alone,
 * the same reason the canonicalizer excludes them from its own prose scan.
 * Returns the input array unchanged (same reference) when nothing is dropped.
 */
export function dropDomainIncoherentUnsourcedResearchAreas(
  areas: readonly string[],
  fieldProvenance: unknown,
  context: ResearchAreaCoherenceContext,
): string[] {
  if (areas.length === 0) return areas as string[];
  if (hasResearchAreaProvenance(fieldProvenance)) return areas as string[];

  const contextTokens = significantTokens(
    context.name,
    context.displayName,
    context.departments,
    context.shortDescription,
    context.fullDescription,
  );
  if (contextTokens.size < MIN_CONTEXT_TOKENS) return areas as string[];

  let changed = false;
  const kept: string[] = [];
  for (const area of areas) {
    if (typeof area !== 'string') {
      kept.push(area);
      continue;
    }
    if (AMBIGUOUS_SINGLE_WORD_AREA_KEYS.has(area.trim().toLowerCase())) {
      kept.push(area);
      continue;
    }
    const areaTokens = significantTokens(area);
    if (areaTokens.size === 0 || hasOverlap(areaTokens, contextTokens)) {
      kept.push(area);
      continue;
    }
    changed = true;
  }
  return changed ? kept : (areas as string[]);
}
