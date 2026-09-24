/**
 * Pure logic for the FRA profile-synthesis lane.
 *
 * A FACULTY_RESEARCH_AREA usually has no lab site, so its only source is the
 * professor's Yale profile page, whose main prose block is a biography. The
 * description extractor requires an exact contiguous substring, so on a page
 * where research is interleaved with credentials the only copyable span is
 * bio-shaped. That is why 464 served FRA descriptions read as person bios: not a
 * ranking bug, a structural limit of copying.
 *
 * A probe of 27 such profile pages found research prose on 27 of 27 while the
 * deterministic extractor produced prose on 0 of 27. The content is present and
 * unreachable by extraction, so this lane synthesizes it instead, reusing
 * `synthesizeCoverageDescription` so the existing overlap and quality gates apply
 * unchanged.
 *
 * Grants cannot serve this cohort: only 12 of the 464 have any grant at all, so
 * the #2191 grant-corpus lane reaches 3% of it.
 */
import { isHighConfidencePersonBio } from '../utils/researchHomeDescriptionSelection';
import {
  isCareerBiographyDescription,
  splitDescriptionSentences as splitSentences,
} from '../utils/careerBiographyDescription';
import { MAX_COVERAGE_SNIPPETS, MAX_COVERAGE_SNIPPET_CHARS } from '../scrapers/coverageSynthesis';
import type { CoverageSnippet } from '../scrapers/coverageSynthesis';
import {
  assertScraperEnvironmentMatchesMongoTarget,
  type ScraperEnvironment,
} from '../scrapers/scraperEnvironment';
import {
  isFileShareOrDocumentUrl,
  isInstitutionalAdvancementUrl,
  isListingOrIndexUrl,
  isSharedPeopleRosterUrl,
} from '../utils/researchHomeWebsiteUrl';
import { normalizeName } from '../scrapers/utils/scraperHelpers';
import {
  personNameTokensFromEntityTitle,
  personPageLeafNameTokens,
} from '../scrapers/utils/personProfileEntityMatch';
import { givenNameTokensAgree } from '../scrapers/utils/piNameMatch';
import { normalizeOfficialProfileDestination } from '../services/leadProfileIdentity';

export const FRA_PROFILE_SYNTHESIS_SOURCE_NAME = 'fra-profile-research-synthesis';

/**
 * Above the grant-corpus lane (0.45) because a professor's own profile page is a
 * better authority on their research than an aggregate of grant abstracts, and
 * below official-profile extraction (0.55) so a genuine verbatim research
 * statement still wins when one exists.
 *
 * Ranking below 0.55 is only survivable because `confidenceResolver` sorts
 * biography `fullDescription` values last - person-voiced prose and career
 * biographies alike, so the cohort this lane selects is demotable - once this lane
 * has recorded a useful research description
 * (`BIO_REPLACING_DESCRIPTION_SOURCES` names it there).
 * Weight alone would leave this lane unable to displace the very biography it
 * exists to replace, since that bio is re-emitted weekly at 0.55.
 */
export const FRA_PROFILE_SYNTHESIS_CONFIDENCE = 0.48;

const YALE_HOST = /(?:^|\.)yale\.edu$/i;

/**
 * The path shapes a Yale site publishes one person's own page at.
 *
 * The bare single-segment arm is the vanity path: `law.yale.edu/<person>`,
 * `art.yale.edu/<person>`, `faculty.som.yale.edu/<person>`. It carries no
 * directory segment at all, which is why a literal `/profile/` match skipped whole
 * schools (#2276), and the three nested arms are the school-specific person paths
 * the roster configs actually cite (`/people/<section>/<person>`,
 * `/<section>/profile/<person>`, `/faculty-research/faculty-directory/<person>`).
 *
 * The prefix vocabulary is enumerated rather than dropped in favour of the identity
 * check alone, because a leaf that names the person also appears on pages that are
 * about something else - a news story, an award announcement, a lab microsite - and
 * none of those is the person's official profile.
 */
const PERSON_PAGE_PATH_SHAPES: readonly RegExp[] = [
  /^\/(?:profile|profiles|people|person|faculty|faculty-directory|directory|bio|bios)\/[^/]+$/i,
  /^\/(?:people|person|faculty|directory)\/[^/]+\/[^/]+$/i,
  /^\/[^/]+\/profile\/[^/]+$/i,
  /^\/(?:directory|faculty-research|research-and-faculty|about|who-we-are)\/(?:faculty|faculty-directory|people|directory)\/[^/]+$/i,
  /^\/[^/]+$/,
];

const parseHttpUrl = (value: unknown): URL | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
};

const pathLeaf = (url: URL): string => {
  const segments = url.pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
};

const pathLeafOf = (value: unknown): string => {
  const url = parseHttpUrl(value);
  return url ? pathLeaf(url) : '';
};

const foldApostrophes = (value: string): string => value.replace(/['’ʼ]/g, '');

/**
 * A Yale page whose path is shaped like one person's own page and which is not a
 * roster, index, faceted listing, directory loader, file download, or fundraising
 * page. Shape is deliberately only half the test: the leaf must also name the
 * person the row is about (`personPageUrlNamesPerson`), because a faculty
 * directory, a section index and a person's profile share these path shapes and a
 * directory page adopted as one person's description is the defect #2385 and #2708
 * each paid for.
 */
export function isOfficialYalePersonPageUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url || !YALE_HOST.test(url.hostname)) return false;
  if (isSharedPeopleRosterUrl(value) || isListingOrIndexUrl(value)) return false;
  if (isFileShareOrDocumentUrl(value) || isInstitutionalAdvancementUrl(value)) return false;
  const pathname = url.pathname.replace(/\/+$/, '');
  return PERSON_PAGE_PATH_SHAPES.some((shape) => shape.test(pathname));
}

/**
 * Whether a person-page URL's leaf names the given person.
 *
 * The hyphenated arm is the rule `profileSlugNamesPerson` states and for the same
 * reasons: surname equality plus a given name that agrees whole or as an
 * enumerated short form, never a first-initial match, because same-surname
 * colleagues really do exist across Yale sites (#468). It is applied here to a leaf
 * that reader cannot see, since a vanity path carries no directory segment for it
 * to key on.
 *
 * The concatenated arm is the School of Art shape (`art.yale.edu/AlexandriaSmith`),
 * where the leaf is the given name and the surname run together with no separator
 * to tokenize on. It requires the whole leaf to equal given plus surname, so it
 * asserts identity rather than a substring coincidence.
 */
export function personPageUrlNamesPerson(value: unknown, personName: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const leaf = foldApostrophes(pathLeaf(url));
  if (!leaf) return false;
  const nameTokens = personNameTokensFromEntityTitle(
    foldApostrophes(normalizeName(typeof personName === 'string' ? personName : '')),
  );
  if (!nameTokens) return false;
  const leafTokens = personPageLeafNameTokens(leaf);
  if (leafTokens) {
    if (leafTokens[leafTokens.length - 1] !== nameTokens[nameTokens.length - 1]) return false;
    return (
      nameTokens.some((token) => givenNameTokensAgree(token, leafTokens[0])) ||
      leafTokens.some((token) => givenNameTokensAgree(token, nameTokens[0]))
    );
  }
  const compactLeaf = leaf.toLowerCase().replace(/[^a-z]/g, '');
  return compactLeaf === `${nameTokens[0]}${nameTokens[nameTokens.length - 1]}`;
}

/**
 * The profile page this lane reads for one entity, or `''` when the entity cites
 * none it can claim.
 *
 * A `/profile/` citation is preferred and is admitted on its shape alone, which is
 * exactly the reach the lane had before #2276: those leaves are routinely opaque
 * netids (`/profile/pf93/`), so requiring identity there would narrow the cohort
 * this lane already serves rather than widen it. Every other shape is admitted only
 * when its leaf names one of the candidate people, since outside the CMS profile
 * namespace nothing else separates a person's page from a directory row.
 */
export function selectFraProfileUrl(
  sourceUrls: unknown,
  personNames: readonly unknown[] = [],
): string {
  const urls = (Array.isArray(sourceUrls) ? sourceUrls : []).filter(
    (url): url is string => typeof url === 'string',
  );
  const cmsProfileUrl = urls.find((url) => /\/profile\//i.test(url));
  if (cmsProfileUrl) return cmsProfileUrl;
  return (
    urls.find(
      (url) =>
        isOfficialYalePersonPageUrl(url) &&
        personNames.some((personName) => personPageUrlNamesPerson(url, personName)),
    ) ?? ''
  );
}

/**
 * One resolved lead of a FACULTY_RESEARCH_AREA, with the official Yale profile
 * pages the corpus has already resolved onto that person.
 */
export interface FraProfileSynthesisLead {
  name: string;
  netid: string;
  officialProfileUrls: readonly string[];
}

/**
 * Whether a lead's official profile URL is corroborated as that lead's own page.
 *
 * The role edge is deliberately not taken as sufficient. A `YALE_OFFICIAL` link can
 * itself have been bound to a same-surname colleague (#1935), and a research
 * description harvested onto the wrong person is worse than no description, so the
 * URL has to name the lead as well as belong to them on record.
 *
 * The netid arm exists because a CMS profile leaf is routinely an opaque netid
 * (`/profile/pf93/`) that the name check cannot read. An opaque leaf is admitted
 * only when it equals the lead's own netid, which is a stronger identity claim than
 * a name match rather than a weaker one; a leaf that is neither name-shaped nor the
 * lead's netid names nobody this lane can verify and is refused.
 */
export function leadProfileUrlNamesLead(url: unknown, lead: FraProfileSynthesisLead): boolean {
  if (personPageUrlNamesPerson(url, lead.name)) return true;
  const netid = lead.netid.trim().toLowerCase();
  return Boolean(netid) && pathLeafOf(url).toLowerCase() === netid;
}

/**
 * Whether two person names name the same person, under the same rule
 * `personPageUrlNamesPerson` applies to a URL leaf: surname equality plus a given
 * name that agrees whole or as an enumerated short form, never a first-initial
 * match. Applied name to name so a row's own title can be asked whether it is about
 * a particular lead.
 */
export function personNamesAgree(a: unknown, b: unknown): boolean {
  const left = personNameTokensFromEntityTitle(
    foldApostrophes(normalizeName(typeof a === 'string' ? a : '')),
  );
  const right = personNameTokensFromEntityTitle(
    foldApostrophes(normalizeName(typeof b === 'string' ? b : '')),
  );
  if (!left?.length || !right?.length) return false;
  if (left[left.length - 1] !== right[right.length - 1]) return false;
  return (
    left.some((token) => givenNameTokensAgree(token, right[0])) ||
    right.some((token) => givenNameTokensAgree(token, left[0]))
  );
}

/**
 * The official profile pages a row's resolved leads carry that the row does not
 * already cite.
 *
 * A cross-appointed professor's research prose often lives on a second official
 * host while the row's own citation is a bare departmental contact stub, so this
 * lane's reach was bounded by what a row happens to cite rather than by what the
 * corpus already knows about its lead (#1937). Measured on Development, 166 live
 * FRA rows with an empty description carry such a page.
 *
 * Candidates already cited are dropped rather than re-probed: the row's own
 * citation is selected first by `selectFraProfileUrl`, so admitting it twice would
 * only spend a second fetch and a second LLM call on the same page.
 *
 * Only a lead the row's own title names is admitted, and a row whose title names
 * nobody admits none. A role edge says the person leads the row, not that the row is
 * about them, so on a multi-lead row the edge alone would let a co-director's page be
 * harvested as this person's research. The row's title is the authority on whose
 * research area it is, and requiring it costs 4 of the 191 Development rows that
 * offer a lead page while closing the case where those 4 name somebody else.
 */
export function selectLeadProfileUrls(
  leads: readonly FraProfileSynthesisLead[],
  citedSourceUrls: unknown,
  entityTitles: readonly unknown[],
): string[] {
  const seen = new Set(
    (Array.isArray(citedSourceUrls) ? citedSourceUrls : [])
      .map((url) => normalizeOfficialProfileDestination(typeof url === 'string' ? url : ''))
      .filter(Boolean),
  );
  const selected: string[] = [];
  for (const lead of leads) {
    if (!entityTitles.some((title) => personNamesAgree(title, lead.name))) continue;
    for (const url of lead.officialProfileUrls) {
      const destination = normalizeOfficialProfileDestination(url);
      if (!destination || seen.has(destination)) continue;
      if (!isOfficialYalePersonPageUrl(url) || !leadProfileUrlNamesLead(url, lead)) continue;
      seen.add(destination);
      selected.push(url.trim());
    }
  }
  return selected;
}

export const PROFILE_FETCH_FAILED_NOTE = 'profile fetch failed';

/**
 * How far one candidate page got, so the lane and the A/B harness rank exhausted
 * candidates by the same rule instead of two copies that drift.
 *
 * Progress, not novelty: a page that carried prose and failed a gate says why nothing
 * was written, a page with no prose says less, and a page that never loaded says
 * nothing at all. Ranking by "first thing that is not a fetch failure" reports a
 * no-prose page ahead of a real gate rejection, which drops that rejection out of the
 * harness's scored denominator and prints a guardrail rate higher than the truth.
 */
export function profilePageProgressRank(probe: { snippets: number; fetchFailed: boolean }): number {
  return probe.snippets * 2 + (probe.fetchFailed ? 0 : 1);
}

const RESEARCH_SENTENCE =
  /\b(we\s|our\s|research|stud(?:y|ies|ying)|investigat|explor|examin|focus(?:es|ed)?\s+on|interested\s+in|develop|mechanism|analy[sz])/i;

/**
 * Credential and career sentences are dropped from the snippets rather than left
 * for the model to ignore. Feeding them in is how a synthesis run reproduces the
 * bio it exists to replace.
 */
const CAREER_SENTENCE =
  /\b(?:received|earned|obtained|completed)\s+(?:his|her|their|a|an)\b|\bjoined\s+(?:the\s+)?Yale\b|\bbefore\s+(?:coming|joining)\b|\bB\.?A\.?\b|\bM\.?D\.?\b|\bPh\.?D\.?\b|\bresidency\b|\bfellowship\s+at\b|\bwas\s+(?:appointed|named)\b|\bis\s+the\s+recipient\b|\bwas\s+awarded\b/i;

/**
 * Site navigation flattens into the page text as long runs of link labels, and a
 * run of them can otherwise clear the sentence-length floor and reach the model
 * as if it were prose.
 */
const NAV_CHROME_RUN =
  /\b(?:YSM Home|INFORMATION FOR|Find People|Organization Charts|Chair Searches|Leadership Searches|Departments & Centers|Volunteer to Help|Donate Blood|Skip to (?:main|content))\b/i;

/**
 * A Yale profile page's own furniture, flattened into the page text as sentences that
 * clear every other filter.
 *
 * Sibling of `NAV_CHROME_RUN` rather than a new predicate elsewhere, because this is the
 * same question at the same layer: is this sentence the page talking about itself. Each
 * marker is a verbatim template, not a vocabulary guess: the publications-timeline
 * heading, the empty research-topics template, the Yale Medicine appointment call to
 * action, the browser notice, and the publication-record labels that precede a title
 * list or a glued MeSH keyword run.
 *
 * Measured over the lane's own in-scope rows: 78 reached the synthesizer, and reading
 * every leading snippet, about 32 led on this furniture, 22 on career, awards or
 * teaching history, and 6 on a bibliography or recording list, leaving about 18 on real
 * research prose. Refusing furniture at the SENTENCE level rather than the snippet level
 * is what keeps a page that mixes the two, a research sentence followed by the
 * publications timeline, from losing its research sentence as well (#1878).
 */
const PROFILE_FURNITURE_RUN =
  /\b(?:Publications Timeline|A big-picture view of|Research topics .{1,80} is interested in exploring|View this doctor's clinical profile|View Doctor Profile|Peer-Reviewed Original Research|MeSH Keywords|Altmetric|Your browser is antiquated|Back to Top|Get In Touch|Copy Link|Voluntary rank details)\b/i;

const MIN_SENTENCE_CHARS = 60;
const MAX_SENTENCE_CHARS = 600;

/**
 * One snippet is enough to attempt synthesis.
 *
 * Requiring two looked prudent, since both residual bio-shaped outputs in the
 * A/B came from one-snippet pages. But a dry run showed the threshold skipping
 * 6 of 12 entities, most of which had synthesized cleanly, so it discarded more
 * good coverage than bad output. The precise control is the post-synthesis check
 * that rejects text still reading as a biography, which catches the same two
 * cases without penalising a thin page that summarises well. Keep the specific
 * gate, not the proxy.
 */
export const MIN_SNIPPETS_TO_SYNTHESIZE = 1;

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const PRONOUN_SUBJECT = 'he|she|they|his|her|their|him|hers|theirs';

export { isCareerBiographyDescription, splitSentences };

/**
 * A URL is never research prose, so the research-sentence vocabulary is tested
 * against the sentence with URLs removed.
 *
 * Reading the URL is how a browser-upgrade banner became a research snippet: the
 * `explor` stem matches inside `internet-explorer`, so
 * "You can update your IE here: https://support.microsoft.com/.../internet-explorer-downloads"
 * cleared every filter. It was the SOLE snippet handed to the synthesizer on 88 of the
 * 100 rows the lane reported as a synthesizer refusal, each costing a page fetch and an
 * LLM call to discover that the page carries no research prose (#1878).
 */
const withoutUrls = (sentence: string): string => sentence.replace(/https?:\/\/\S+/gi, ' ');

export function profileResearchSentences(pageText: string): string[] {
  return splitSentences(textValue(pageText))
    .map((sentence) => textValue(sentence))
    .filter(
      (sentence) =>
        sentence.length >= MIN_SENTENCE_CHARS &&
        sentence.length <= MAX_SENTENCE_CHARS &&
        RESEARCH_SENTENCE.test(withoutUrls(sentence)) &&
        !CAREER_SENTENCE.test(sentence) &&
        !NAV_CHROME_RUN.test(sentence) &&
        !PROFILE_FURNITURE_RUN.test(sentence),
    );
}

/**
 * Grouped into paragraph-sized snippets so the synthesizer sees connected
 * reasoning rather than a bag of disconnected clauses.
 */
export function profileResearchSnippets(
  pageText: string,
  sourceUrl: string,
  sourceName: string = FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
): CoverageSnippet[] {
  const sentences = profileResearchSentences(pageText);
  const snippets: CoverageSnippet[] = [];
  let buffer: string[] = [];
  const flush = (): void => {
    if (!buffer.length) return;
    snippets.push({ text: buffer.join(' '), sourceUrl, sourceName });
    buffer = [];
  };
  for (const sentence of sentences) {
    if (snippets.length >= MAX_COVERAGE_SNIPPETS) break;
    if ([...buffer, sentence].join(' ').length > MAX_COVERAGE_SNIPPET_CHARS && buffer.length) {
      flush();
    }
    buffer.push(sentence);
  }
  if (snippets.length < MAX_COVERAGE_SNIPPETS) flush();
  return snippets;
}

/**
 * Retained for the OUTPUT check only: a synthesized description must not read as
 * person prose at all. Do not use this to select entities to rewrite.
 */
export function isBioShapedFacultyDescription(value: unknown): boolean {
  const text = textValue(value);
  return text ? isHighConfidencePersonBio(text) : false;
}

/**
 * Deliberately an allowlist of research-activity verbs rather than any verb. A
 * general pattern would also rewrite a biographical clause ("She is a professor
 * of history") into a sentence that reads like a research claim, which is worse
 * than leaving the pronoun in place: the bio check downstream can still reject
 * the whole description, but it cannot un-launder a bio disguised as research.
 */
const RESEARCH_ACTIVITY_VERB =
  'investigates?|studies|study|examines?|explores?|researches?|analy[sz]es?|develops?|focuses|centers?|centres?|works|directs?|co-directs?|leads?|collaborates?|combines?|applies|employs|uses|builds?|designs?|models?|maintains?|oversees';

const PRONOUN_LEAD = new RegExp(
  `^(?:he|she|they|his|her|their)\\s+(${RESEARCH_ACTIVITY_VERB})\\b`,
  'i',
);

// The possessive form shares the verb allowlist rather than carrying a narrower
// copy of it: "Her group leads a national consortium" is the same orphan pronoun
// as "She leads ...", and a verb missing from only one of the two lists left the
// dangling subject in place (#2200).
const PRONOUN_POSSESSIVE_LEAD = new RegExp(
  `^(?:his|her|their)\\s+(?:research|work|lab|laboratory|group|team|program|programme|project)\\s+(${RESEARCH_ACTIVITY_VERB})\\b`,
  'i',
);

const RESIDUAL_PRONOUN_LEAD = new RegExp(`^(?:${PRONOUN_SUBJECT})\\b`, 'i');
const RESIDUAL_PRONOUN_AFTER_STOP = new RegExp(`(?<=[.!?])\\s+(?:${PRONOUN_SUBJECT})\\b`, 'i');

function repairSentencePronounLead(sentence: string): string {
  const possessive = sentence.match(PRONOUN_POSSESSIVE_LEAD);
  if (possessive) {
    return capitalize(`${possessive[1]} ${sentence.slice(possessive[0].length).trim()}`);
  }
  const lead = sentence.match(PRONOUN_LEAD);
  if (!lead) return sentence;
  return capitalize(`${lead[1]} ${sentence.slice(lead[0].length).trim()}`);
}

/**
 * A synthesized description that says "She investigates ..." has no antecedent on
 * a research card, which is the #1871 orphan-pronoun defect. The subject is
 * dropped rather than replaced with a name, matching how the rest of the corpus
 * reads ("Investigates ...", "Studies ..."), and this runs before the bio check
 * so a clean description is not rejected for its opening word alone.
 *
 * Every sentence is repaired, not just the first. Repairing only the lead left
 * "Investigates how ... . She directs a community-academic partnership ..." on a
 * real entity: the opening read correctly while the dangling pronoun simply moved
 * out of view of the check.
 */
export function repairPronounLead(value: unknown): string {
  const text = textValue(value);
  if (!text) return '';
  return splitSentences(text)
    .map((sentence) => repairSentencePronounLead(sentence))
    .filter(Boolean)
    .join(' ');
}

/**
 * The verb allowlist is deliberately incomplete, so repair cannot be the only
 * defence: any sentence still opening with a pronoun after repair is a dangling
 * reference on a research card, and `isHighConfidencePersonBio` only anchors that
 * check at the start of the whole description. The lane fails closed on this
 * rather than widening the allowlist into laundering a biography as research.
 *
 * Scanned over the raw text as well as the split sentences so this defence does
 * not silently depend on the splitter being perfect: a sentence boundary the
 * splitter misses must still fail closed rather than pass the dangling pronoun
 * through.
 */
export function hasResidualPronounLead(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  if (RESIDUAL_PRONOUN_AFTER_STOP.test(text)) return true;
  return splitSentences(text).some((sentence) => RESIDUAL_PRONOUN_LEAD.test(sentence));
}

function capitalize(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
}

export interface FraProfileSynthesisArgs {
  apply: boolean;
  confirm: boolean;
  limit: number;
  slugs: string[];
  output?: string;
}

export function parseFraProfileSynthesisArgs(argv: string[]): FraProfileSynthesisArgs {
  const args: FraProfileSynthesisArgs = { apply: false, confirm: false, limit: 0, slugs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--confirm-fra-profile-synthesis') args.confirm = true;
    else if (arg === '--limit') {
      const raw = argv[index + 1];
      index += 1;
      if (!raw || !/^\d+$/.test(raw)) throw new Error('--limit must be a non-negative integer');
      args.limit = Number(raw);
    } else if (arg === '--slug') {
      const raw = argv[index + 1];
      index += 1;
      if (!raw || raw.startsWith('--')) throw new Error('--slug requires a value');
      args.slugs.push(raw);
    } else if (arg === '--output') {
      const raw = argv[index + 1];
      index += 1;
      if (!raw || raw.startsWith('--')) throw new Error('--output requires a path');
      args.output = raw;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag ${arg}`);
    }
  }
  return args;
}

export interface FraProfileSynthesisApplyTarget {
  environment: ScraperEnvironment;
  dbLabel: string;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Gated on the resolved environment plus the environment's configured database
 * name, never on the `dbLabel` text. That label is `${hostname}/${db}`, so a
 * substring match on it passes for a cluster host merely containing
 * "development" while pointing at Production, and fails for a Development
 * database renamed through SCRAPER_DEVELOPMENT_DB_NAME.
 */
export function assertFraProfileSynthesisApplyAllowed(
  args: FraProfileSynthesisArgs,
  target: FraProfileSynthesisApplyTarget,
): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(
      'research-entity:fra-profile-synthesis --apply requires --confirm-fra-profile-synthesis',
    );
  }
  if (target.environment !== 'development') {
    throw new Error(
      `research-entity:fra-profile-synthesis --apply is restricted to the Development environment (saw ${target.environment} targeting ${target.dbLabel})`,
    );
  }
  assertScraperEnvironmentMatchesMongoTarget({
    environment: target.environment,
    mongoUrl: target.mongoUrl,
    env: target.env,
  });
}
