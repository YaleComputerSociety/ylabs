import type { ObservedEntityType } from '../models/observation';
import {
  isDepartmentCollectivePageUrl,
  isPersonProfileOrDirectoryUrl,
} from '../utils/researchHomeWebsiteUrl';
import { LLM_AUTHORED_SOURCE_NAMES } from './seedSources';
import { normalizeEvidenceUrl } from './utils/sharedEvidenceUrls';

/**
 * A page many rows cite cannot be the description of any one of them.
 *
 * `labMicrositeDescriptionLLMExtractor` already refuses this, but only for itself
 * (#3162). Measured after that landed, 37 served rows still carried an unowned
 * description, and every one came from a lane the refusal never reached:
 * `dept-faculty-roster` 29 and `ysm-atoz-index` 8 (#3481). So the judgement belongs
 * on the path every lane writes through, next to `isUncitableHostUrl`, rather than
 * copied into each extractor.
 *
 * ## Why the bar is a third citer and not a second
 *
 * Two rows citing one page is usually one subject stored twice: a person's LAB row
 * and their research-area row both cite their lab's site, and both are legitimately
 * described by it. 37 of the 91 unowned rows measured were that shape, and refusing
 * them would withhold a correct description to punish a duplicate-row defect that
 * belongs to dedupe. A third citer is what makes a page institutional: a faculty
 * directory cited by 20 rows cannot be about any of them.
 *
 * Measured against the same corpus, the third-citer bar refuses 31 of the 37
 * post-guard rows, which is all 29 from `dept-faculty-roster` plus 2, and declines
 * the 6 remaining, all of which are the two-row same-subject shape. So it is a
 * refusal with no measured false positive rather than the widest possible net.
 *
 * A person's own profile is exempt for the reason the extractor exempts it: it is
 * cited by that person's several rows and describes all of them.
 */
export const DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS = 2;

export const OWNERSHIP_GUARDED_DESCRIPTION_FIELDS: ReadonlySet<string> = new Set([
  'fullDescription',
  'shortDescription',
  'description',
]);

/**
 * Typed against the model's own union rather than a string literal. The first cut of
 * this guard compared against `'research_entity'`, which no observation carries, so
 * the refusal was inert on every row and typechecked cleanly (#3481).
 */
export const OWNERSHIP_GUARDED_ENTITY_TYPE: ObservedEntityType = 'researchEntity';

export interface DescriptionOwnershipCandidate {
  entityType: string;
  field: string;
  sourceUrl?: unknown;
  /** The name of the row being written, so subject identity covers it too. */
  ownName?: unknown;
}

/** Whether this observation is one the ownership bar applies to at all. */
export function isOwnershipGuardedDescription(candidate: DescriptionOwnershipCandidate): boolean {
  if (candidate.entityType !== OWNERSHIP_GUARDED_ENTITY_TYPE) return false;
  if (!OWNERSHIP_GUARDED_DESCRIPTION_FIELDS.has(candidate.field)) return false;
  const url = normalizeEvidenceUrl(candidate.sourceUrl);
  return url.length > 0 && !isPersonProfileOrDirectoryUrl(url);
}

/**
 * Words that appear in a research row's name without identifying WHOSE row it is, so
 * two rows sharing only these share nothing.
 */
const NON_IDENTIFYING_NAME_TOKEN = new Set([
  'lab',
  'labs',
  'laboratory',
  'laboratories',
  'group',
  'team',
  'center',
  'centre',
  'the',
  'and',
  'research',
  'faculty',
  'yale',
  'program',
  'programme',
  'institute',
  'core',
  'facility',
  'of',
  'for',
  'project',
  'study',
  'studies',
]);

const identifyingNameTokens = (name: unknown): Set<string> =>
  new Set(
    String(name ?? '')
      .toLowerCase()
      .replace(/[^a-z ]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3 && !NON_IDENTIFYING_NAME_TOKEN.has(token)),
  );

/**
 * Whether every row citing a page is the SAME subject stored more than once.
 *
 * This is the question the citer COUNT cannot answer, and getting that wrong shipped a
 * guard that refused a lab's description from its own page. A lab minted once per member
 * has several rows all citing one page - its own - so the count reads as institutional:
 *
 *   medicine.yale.edu/lab/decamilli, 4 citers
 *     "The De Camilli Lab", "De Camilli Lab", "De Camilli Lab", "De Camilli Lab"
 *
 * Measured on Development, 72 of the 217 multi-citer description pages were one subject
 * this way, so the count alone was wrong about a third of them and 234 rows were exposed
 * (#3481).
 *
 * Every pair must share an identifying token. Requiring every pair rather than some pair
 * is deliberate: a page cited by one lab's three rows AND one unrelated row is not about
 * a single subject, and a some-pair test would call it one because two of the three
 * match.
 *
 * A row whose name yields no identifying token cannot be shown to be the same subject as
 * anything, so it makes the set many-subject and the page is refused. That fails toward
 * refusing a description rather than toward serving another row's, which is the side a
 * student is better off on.
 */
export function citersAreOneSubject(citerNames: readonly unknown[]): boolean {
  const tokenSets = citerNames.map(identifyingNameTokens);
  if (tokenSets.length < 2) return true;
  for (const tokens of tokenSets) if (tokens.size === 0) return false;
  for (let i = 0; i < tokenSets.length; i += 1) {
    for (let j = i + 1; j < tokenSets.length; j += 1) {
      const shares = [...tokenSets[i]].some((token) => tokenSets[j].has(token));
      if (!shares) return false;
    }
  }
  return true;
}

/**
 * Refuse when the cited page is already the description source for at least
 * `DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS` other entities.
 *
 * `foreignCiters` counts entities other than the one being written, so the caller
 * never has to reason about whether the row being written is included.
 */
export function refusesDescriptionOnSharedPage(
  candidate: DescriptionOwnershipCandidate,
  foreignCiterNames: readonly unknown[],
): boolean {
  if (!isOwnershipGuardedDescription(candidate)) return false;
  if (foreignCiterNames.length < DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS) return false;
  // The row being written is a citer too, so subject identity is decided over the whole
  // set. Passing only the foreign names would let a page cited by one lab's three member
  // rows read as one subject and still refuse the lab itself.
  return !citersAreOneSubject([...foreignCiterNames, candidate.ownName]);
}

/**
 * The distinct cited URLs in a batch that the ownership bar could apply to.
 *
 * Returned normalized, so the count the caller looks up and the value the refusal
 * tests are the same string. A mismatch there is how a guard reads zero citers for a
 * page cited twenty times.
 */
export function ownershipGuardedCitedUrls(
  candidates: readonly DescriptionOwnershipCandidate[],
): string[] {
  const urls = new Set<string>();
  for (const candidate of candidates) {
    if (!isOwnershipGuardedDescription(candidate)) continue;
    urls.add(normalizeEvidenceUrl(candidate.sourceUrl));
  }
  return [...urls];
}

let llmAuthoredSources: ReadonlySet<string> | undefined;
// Built on first use because `seedSources` reaches this module through an import cycle.
const isLlmAuthoredSource = (sourceName: unknown): boolean =>
  (llmAuthoredSources ??= new Set(LLM_AUTHORED_SOURCE_NAMES)).has(String(sourceName ?? ''));

const OWN_NAME_FILLER = new Set([
  'faculty',
  'research',
  'lab',
  'labs',
  'laboratory',
  'the',
  'and',
  'for',
  'of',
  'at',
  'in',
  'on',
  'an',
  'to',
  'by',
  'dr',
  'md',
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
  'professor',
  'yale',
  'center',
  'centre',
  'group',
  'program',
  'programme',
  'project',
  'department',
  'school',
  'institute',
  'medicine',
]);

const ownNameTokens = (ownName: unknown): string[] =>
  String(ownName ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 2 && !OWN_NAME_FILLER.has(token));

const textNamesOwnSubject = (text: unknown, ownName: unknown): boolean => {
  const words = new Set(
    String(text ?? '')
      .toLowerCase()
      .split(/[^a-z]+/),
  );
  return ownNameTokens(ownName).some((token) => words.has(token));
};

/**
 * A language-model description that cites a department's audience, hiring or programme
 * page and does not name the row's own subject narrates the department, a programme or a
 * generic lab onto the row ("The department researches ..."), so it is dropped. Such a
 * page can list each professor's research, which is why text naming the row's own person
 * is kept: measured on Development, every kept case was accurate and every dropped one
 * described the department, a programme or no one. The lanes refuse the page at emit;
 * this reaches what was stored before they did. Scoped to model-written text because a
 * roster lane's own description of a person can legitimately be read off a department page.
 */
export function isLlmDescriptionFromDepartmentCollectivePage(
  observation: { field: string; sourceName?: unknown; sourceUrl?: unknown; value?: unknown },
  ownName?: unknown,
): boolean {
  return (
    OWNERSHIP_GUARDED_DESCRIPTION_FIELDS.has(observation.field) &&
    isLlmAuthoredSource(observation.sourceName) &&
    isDepartmentCollectivePageUrl(observation.sourceUrl) &&
    !textNamesOwnSubject(observation.value, ownName)
  );
}
