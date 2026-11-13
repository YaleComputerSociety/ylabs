import { isPersonResearchRow } from '../utils/researchStatementPassage';
import { storedPageTextByUrl } from '../scrapers/utils/nonYaleMicrositeDescriptionScreen';
import { normalizeEvidenceUrl } from '../scrapers/utils/sharedEvidenceUrls';
import {
  descriptionPageNamesRowLead,
  isUnderOwnWebsite,
} from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import { withoutNamesakePersonPageDescriptions } from '../scrapers/utils/namesakePersonPageDescriptions';
import type { ResearchEntityIdentity } from '../scrapers/utils/personProfileEntityMatch';
import { SOURCE_CONTENT_HASH_FIELD } from '../scrapers/contentHashGate';
import {
  SEARCH_INDEX_WRITES_DEFERRED,
  SEARCH_INDEX_WRITES_VARIABLE,
} from '../utils/searchIndexWrites';
import {
  COVERAGE_SNIPPET_FIELDS,
  MAX_COVERAGE_SNIPPETS,
  gatherCoverageSnippets,
  isCoverageSynthesisLlmFailure,
  type CoverageObservationLike,
  type EvidencePageAdmission,
  type CoverageSnippet,
  type CoverageSynthesisDecision,
  type StoredPageTextLookup,
} from '../scrapers/coverageSynthesis';
import { currentResearchPageTextObservation } from '../scrapers/researchPageTopicsDerivation';
import {
  RESEARCH_PAGE_TEXT_FIELD,
  RESEARCH_PAGE_TEXT_SOURCE,
} from '../scrapers/utils/researchPageText';
import { getSourceCoverage } from '../scrapers/sourceCoverageRegistry';
import { refusedResolverObservations } from '../utils/researchEntityFieldValueRefusals';
import { fullDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import { buildGrantCorpusSnippets } from './grantCorpusSynthesisCore';
import { isOfficialYalePersonPageUrl } from './fraProfileSynthesisCore';

export interface CoverageSynthesisArgs {
  apply: boolean;
  confirm: boolean;
  limit: number;
  all: boolean;
  rederiveCards: boolean;
  concurrency: number;
  slugs: string[];
  skipIndexSync: boolean;
  ignoreEvidenceHash: boolean;
  reinstateRetiredBodies: boolean;
  retireUnsupportedRefusedBodies: boolean;
  evaluate: boolean;
  validateOnly: boolean;
  printWriterPrompt: boolean;
  synthesizeCards: boolean;
  cacheOnly: boolean;
  supersedeDraft: boolean;
  deferMaterializeForRuns: string[];
  slugsFile?: string;
  captureEvidence?: string;
  captureCardRequests?: string;
  evidenceFile?: string;
  importDerivations?: string;
  output?: string;
  reason?: string;
  decidedBy?: string;
}

export const DEFAULT_COVERAGE_SYNTHESIS_LIMIT = 25;
export const DEFAULT_COVERAGE_SYNTHESIS_CONCURRENCY = 4;
const MAX_COVERAGE_SYNTHESIS_CONCURRENCY = 8;

const VALUE_FLAGS = {
  '--limit': 'limit',
  '--concurrency': 'concurrency',
  '--slugs': 'slugs',
  '--slugs-file': 'slugsFile',
  '--capture-evidence': 'captureEvidence',
  '--capture-card-requests': 'captureCardRequests',
  '--evidence-file': 'evidenceFile',
  '--import-derivations': 'importDerivations',
  '--output': 'output',
  '--reason': 'reason',
  '--decided-by': 'decidedBy',
  '--defer-materialize-for-runs': 'deferMaterializeForRuns',
} as const;

type ValueFlag = keyof typeof VALUE_FLAGS;

const isValueFlag = (token: string): token is ValueFlag => Object.hasOwn(VALUE_FLAGS, token);

export function parseSlugList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((slug) => slug.trim())
    .filter(Boolean);
}

/** `--defer-materialize-for-runs`: scrape run ids, each a 24-hex ObjectId. */
export function parseRunIdList(value: string): string[] {
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const invalid = ids.filter((id) => !/^[0-9a-f]{24}$/i.test(id));
  if (ids.length === 0 || invalid.length > 0) {
    throw new Error(
      `--defer-materialize-for-runs expects comma-separated 24-hex run ids (got ${invalid.length > 0 ? invalid.join(', ') : 'none'})`,
    );
  }
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

export function parseCoverageSynthesisArgs(argv: string[]): CoverageSynthesisArgs {
  const args: CoverageSynthesisArgs = {
    apply: false,
    confirm: false,
    limit: DEFAULT_COVERAGE_SYNTHESIS_LIMIT,
    all: false,
    rederiveCards: false,
    concurrency: DEFAULT_COVERAGE_SYNTHESIS_CONCURRENCY,
    slugs: [],
    skipIndexSync: false,
    ignoreEvidenceHash: false,
    reinstateRetiredBodies: false,
    retireUnsupportedRefusedBodies: false,
    evaluate: false,
    validateOnly: false,
    printWriterPrompt: false,
    synthesizeCards: false,
    cacheOnly: false,
    supersedeDraft: false,
    deferMaterializeForRuns: [],
  };
  const setValue = (flag: ValueFlag, value: string) => {
    const key = VALUE_FLAGS[flag];
    if (key === 'limit') args.limit = Number(value);
    else if (key === 'concurrency') args.concurrency = Number(value);
    else if (key === 'slugs') args.slugs = parseSlugList(value);
    else if (key === 'deferMaterializeForRuns')
      args.deferMaterializeForRuns = parseRunIdList(value);
    else args[key] = value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const equals = token.indexOf('=');
    const flag = equals > 0 ? token.slice(0, equals) : token;
    if (isValueFlag(flag)) {
      if (equals > 0) setValue(flag, token.slice(equals + 1));
      else {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--'))
          throw new Error(`${flag} requires a value`);
        setValue(flag, value);
        index += 1;
      }
    } else if (token === '--apply') args.apply = true;
    else if (token === '--dry-run') args.apply = false;
    else if (token === '--confirm-coverage-synthesis') args.confirm = true;
    else if (token === '--all') args.all = true;
    else if (token === '--rederive-cards') args.rederiveCards = true;
    else if (token === '--skip-index-sync') args.skipIndexSync = true;
    else if (token === '--ignore-evidence-hash') args.ignoreEvidenceHash = true;
    else if (token === '--reinstate-retired-bodies') args.reinstateRetiredBodies = true;
    else if (token === '--retire-unsupported-refused-bodies') {
      args.retireUnsupportedRefusedBodies = true;
    } else if (token === '--evaluate') args.evaluate = true;
    else if (token === '--validate-only') args.validateOnly = true;
    else if (token === '--print-writer-prompt') args.printWriterPrompt = true;
    else if (token === '--synthesize-cards') args.synthesizeCards = true;
    else if (token === '--cache-only') args.cacheOnly = true;
    else if (token === '--supersede-draft') args.supersedeDraft = true;
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0)
    args.limit = DEFAULT_COVERAGE_SYNTHESIS_LIMIT;
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    args.concurrency = DEFAULT_COVERAGE_SYNTHESIS_CONCURRENCY;
  }
  args.concurrency = Math.min(MAX_COVERAGE_SYNTHESIS_CONCURRENCY, Math.floor(args.concurrency));
  return args;
}

export type CoverageSynthesisMode =
  | 'print-writer-prompt'
  | 'capture-evidence'
  | 'import-derivations'
  | 'supersede-draft'
  | 'evaluate'
  | 'synthesize-cards'
  | 'write';

export type CardPassMode = 'capture-evidence' | 'import-derivations' | 'evaluate' | 'plan';

/**
 * The card pass reuses the writer's read-only flags: `--capture-evidence` freezes the bodies
 * materialization would ask a card for, `--evidence-file` reads them, `--evaluate` drafts
 * through the card cache, and `--import-derivations` judges external cards; with none of them
 * it only plans. It never writes an observation or a field.
 */
export function cardPassModeOf(args: CoverageSynthesisArgs): CardPassMode {
  if (args.captureEvidence) return 'capture-evidence';
  if (args.importDerivations) return 'import-derivations';
  if (args.evaluate) return 'evaluate';
  return 'plan';
}

function assertCardPassArgs(args: CoverageSynthesisArgs): void {
  const refused = [
    args.apply ? '--apply' : null,
    args.all ? '--all' : null,
    args.rederiveCards ? '--rederive-cards' : null,
    args.reinstateRetiredBodies ? '--reinstate-retired-bodies' : null,
  ].filter(Boolean);
  if (refused.length > 0) {
    throw new Error(
      `research-entity:coverage-synthesis --synthesize-cards is refused with ${refused.join(', ')}`,
    );
  }
  const chosen = [args.captureEvidence, args.importDerivations, args.evaluate].filter(Boolean);
  if (chosen.length > 1) {
    throw new Error(
      'research-entity:coverage-synthesis --synthesize-cards: choose one of --capture-evidence, --import-derivations, --evaluate',
    );
  }
  if (args.validateOnly && !args.importDerivations) {
    throw new Error(
      'research-entity:coverage-synthesis --validate-only requires --import-derivations',
    );
  }
  if (args.captureEvidence && args.evidenceFile) {
    throw new Error(
      'research-entity:coverage-synthesis --capture-evidence reads the database, not --evidence-file',
    );
  }
  if (args.slugs.length === 0 && !args.slugsFile && !args.evidenceFile) {
    throw new Error(
      'research-entity:coverage-synthesis --synthesize-cards requires --slugs, --slugs-file or --evidence-file',
    );
  }
}

/**
 * The one path that replaces a stored writer draft, so it names exactly one row and
 * records who decided and why; there is no bulk form by design (#5934).
 */
function assertSupersedeDraftArgs(args: CoverageSynthesisArgs): void {
  const refused = [
    args.all ? '--all' : null,
    args.slugsFile ? '--slugs-file' : null,
    args.evaluate ? '--evaluate' : null,
    args.captureEvidence ? '--capture-evidence' : null,
    args.captureCardRequests ? '--capture-card-requests' : null,
    args.validateOnly ? '--validate-only' : null,
    args.synthesizeCards ? '--synthesize-cards' : null,
    args.printWriterPrompt ? '--print-writer-prompt' : null,
    args.rederiveCards ? '--rederive-cards' : null,
    args.reinstateRetiredBodies ? '--reinstate-retired-bodies' : null,
  ].filter(Boolean);
  if (refused.length > 0) {
    throw new Error(
      `research-entity:coverage-synthesis --supersede-draft is refused with ${refused.join(', ')}`,
    );
  }
  if (new Set(args.slugs).size !== 1) {
    throw new Error(
      'research-entity:coverage-synthesis --supersede-draft requires exactly one --slugs=<slug>',
    );
  }
  if (!args.importDerivations) {
    throw new Error(
      'research-entity:coverage-synthesis --supersede-draft requires --import-derivations',
    );
  }
  if (!args.reason?.trim() || !args.decidedBy?.trim()) {
    throw new Error(
      'research-entity:coverage-synthesis --supersede-draft requires --reason and --decided-by',
    );
  }
}

export function coverageSynthesisModeOf(args: CoverageSynthesisArgs): CoverageSynthesisMode {
  if (args.supersedeDraft) {
    assertSupersedeDraftArgs(args);
    return 'supersede-draft';
  }
  if (args.printWriterPrompt) return 'print-writer-prompt';
  if (args.synthesizeCards) {
    assertCardPassArgs(args);
    return 'synthesize-cards';
  }
  const readOnlyModes = [
    args.captureEvidence ? 'capture-evidence' : null,
    args.importDerivations ? 'import-derivations' : null,
    args.evaluate ? 'evaluate' : null,
  ].filter((mode): mode is Exclude<CoverageSynthesisMode, 'write' | 'print-writer-prompt'> =>
    Boolean(mode),
  );
  if (readOnlyModes.length > 1) {
    throw new Error(
      `research-entity:coverage-synthesis: choose one of ${readOnlyModes.join(', ')}`,
    );
  }
  if (args.validateOnly && readOnlyModes[0] !== 'import-derivations') {
    throw new Error(
      'research-entity:coverage-synthesis --validate-only requires --import-derivations',
    );
  }
  if (args.evidenceFile && !['evaluate', 'import-derivations'].includes(readOnlyModes[0] ?? '')) {
    throw new Error(
      'research-entity:coverage-synthesis --evidence-file is read only by --evaluate or --import-derivations',
    );
  }
  const mode = readOnlyModes[0];
  if (!mode) {
    if (args.slugsFile) {
      throw new Error(
        'research-entity:coverage-synthesis --slugs-file is read only by --evaluate or --capture-evidence',
      );
    }
    if (args.captureCardRequests && args.apply) {
      throw new Error(
        'research-entity:coverage-synthesis --capture-card-requests is a dry-run read and is refused with --apply',
      );
    }
    return 'write';
  }
  const refused = [
    args.apply ? '--apply' : null,
    args.all ? '--all' : null,
    args.rederiveCards ? '--rederive-cards' : null,
    args.reinstateRetiredBodies ? '--reinstate-retired-bodies' : null,
  ].filter(Boolean);
  if (refused.length > 0) {
    throw new Error(
      `research-entity:coverage-synthesis --${mode} is refused with ${refused.join(', ')}`,
    );
  }
  const named = args.slugs.length > 0 || Boolean(args.slugsFile);
  if (mode === 'evaluate' && !named && !args.evidenceFile) {
    throw new Error(
      'research-entity:coverage-synthesis --evaluate requires --slugs, --slugs-file or --evidence-file',
    );
  }
  if (mode === 'capture-evidence' && !named) {
    throw new Error(
      'research-entity:coverage-synthesis --capture-evidence requires --slugs or --slugs-file',
    );
  }
  return mode;
}

export function assertWriterCacheModeAllowed(
  mode: CoverageSynthesisMode,
  dbLabel: string,
  args?: Pick<
    CoverageSynthesisArgs,
    'evaluate' | 'importDerivations' | 'validateOnly' | 'captureEvidence'
  > &
    Partial<Pick<CoverageSynthesisArgs, 'apply'>>,
): { writesDevelopmentCache: boolean } {
  const writesCardCache =
    mode === 'synthesize-cards' &&
    Boolean(args?.evaluate || (args?.importDerivations && !args.validateOnly));
  const writesWriterCache = ['evaluate', 'import-derivations', 'supersede-draft'].includes(mode);
  if (!writesWriterCache && !writesCardCache) {
    return { writesDevelopmentCache: false };
  }
  if (!/\/development$/i.test(dbLabel)) {
    throw new Error(
      `research-entity:coverage-synthesis --${mode} is restricted to a Development database (got ${dbLabel})`,
    );
  }
  if (mode === 'supersede-draft') return { writesDevelopmentCache: Boolean(args?.apply) };
  return { writesDevelopmentCache: !(mode === 'import-derivations' && args?.validateOnly) };
}

/**
 * `--ignore-evidence-hash` re-judges rows whose evidence is unchanged, so it pays for a
 * call the evidence hash exists to save. It is refused with `--all` and allowed only on a
 * named `--slugs` set, which bounds the spend to rows an operator chose to re-judge.
 */
export function assertIgnoreEvidenceHashScoped(args: CoverageSynthesisArgs): void {
  if (args.retireUnsupportedRefusedBodies && args.reinstateRetiredBodies) {
    throw new Error(
      'research-entity:coverage-synthesis --retire-unsupported-refused-bodies is refused with --reinstate-retired-bodies',
    );
  }
  if (args.reinstateRetiredBodies && args.slugs.length === 0) {
    throw new Error(
      'research-entity:coverage-synthesis --reinstate-retired-bodies requires --slugs=<slug,...>',
    );
  }
  if (!args.ignoreEvidenceHash) return;
  if (args.all) {
    throw new Error(
      'research-entity:coverage-synthesis --ignore-evidence-hash is refused with --all; name the rows with --slugs',
    );
  }
  if (args.slugs.length === 0) {
    throw new Error(
      'research-entity:coverage-synthesis --ignore-evidence-hash requires --slugs=<slug,...>',
    );
  }
}

/**
 * The stored evidence hash the writer compares against, or none when the operator asked
 * to re-judge a named set regardless of it.
 */
export function writerStoredHashFor(
  args: Pick<CoverageSynthesisArgs, 'ignoreEvidenceHash'>,
  storedHash: string | undefined,
): string | undefined {
  return args.ignoreEvidenceHash ? undefined : storedHash;
}

export function assertCoverageSynthesisApplyAllowed(
  args: CoverageSynthesisArgs,
  dbLabel: string,
): void {
  assertIgnoreEvidenceHashScoped(args);
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(
      'research-entity:coverage-synthesis apply requires --confirm-coverage-synthesis (writes low-confidence LLM descriptions)',
    );
  }
  if (!/\/development$/i.test(dbLabel)) {
    throw new Error(
      `research-entity:coverage-synthesis apply is restricted to a Development database (got ${dbLabel})`,
    );
  }
}

const observationText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export type WriterEvidenceRank = 0 | 1 | 2 | 3 | 4;

const urlHostAndPath = (value: unknown): { host: string; path: string } | undefined => {
  try {
    const url = new URL(String(value ?? ''));
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    return host ? { host, path: url.pathname.replace(/\/+$/, '') } : undefined;
  } catch {
    return undefined;
  }
};

/** Whether a page sits under the row's own site: same host, and under its path. */
export function isOnOwnResearchSite(sourceUrl: unknown, websiteUrl: unknown): boolean {
  const site = urlHostAndPath(websiteUrl);
  const page = urlHostAndPath(sourceUrl);
  if (!site || !page || page.host !== site.host) return false;
  return !site.path || page.path === site.path || page.path.startsWith(`${site.path}/`);
}

const hasCategory = (sourceName: unknown, category: string): boolean =>
  Boolean(
    getSourceCoverage(String(sourceName ?? ''))?.evidenceCategories.some(
      (entry) => entry === category,
    ),
  );

export function isGrantEvidenceSource(sourceName: unknown): boolean {
  return (
    hasCategory(sourceName, 'FUNDING_ACTIVITY') &&
    !hasCategory(sourceName, 'LAB_WEBSITE') &&
    !hasCategory(sourceName, 'OFFICIAL_PROFILE')
  );
}

export const isResearchPageTextEvidence = (
  obs: Pick<CoverageObservationLike, 'sourceName'> & { field?: string },
): boolean =>
  obs.field === RESEARCH_PAGE_TEXT_FIELD && obs.sourceName === RESEARCH_PAGE_TEXT_SOURCE;

/**
 * Which kind of page a piece of evidence is (#4867, #5537): 0 the research text of the
 * row's own pages, 1 the row's own research site, 2 an official profile, 3 any other page,
 * 4 a grant record. The row's own site is decided by the cited URL rather than the lane,
 * because a lane that reads many kinds of page cannot say which one a value came from, and
 * many Yale sites are paths on a shared host, so a person page on that host is a profile
 * before it is the site.
 */
export function writerEvidenceRank(
  obs: Pick<CoverageObservationLike, 'sourceName' | 'sourceUrl'> & { field?: string },
  websiteUrl?: unknown,
): WriterEvidenceRank {
  if (isResearchPageTextEvidence(obs)) return 0;
  if (isGrantEvidenceSource(obs.sourceName)) return 4;
  if (isOfficialYalePersonPageUrl(obs.sourceUrl)) return 2;
  if (isOnOwnResearchSite(obs.sourceUrl, websiteUrl)) return 1;
  if (hasCategory(obs.sourceName, 'OFFICIAL_PROFILE')) return 2;
  return 3;
}

/**
 * The row's own research page text, then its own site, then its official profile, then
 * other pages, grants last; within a rank strongest first, then a total order on the
 * remaining keys, so the same evidence always yields the same snippet list and therefore
 * the same hash whatever order the database returned it in.
 */
export function orderWriterEvidence(
  observations: readonly CoverageObservationLike[],
  websiteUrl?: unknown,
): CoverageObservationLike[] {
  return [...observations].sort(
    (a, b) =>
      writerEvidenceRank(a, websiteUrl) - writerEvidenceRank(b, websiteUrl) ||
      (b.confidence ?? 0) - (a.confidence ?? 0) ||
      String(a.sourceName ?? '').localeCompare(String(b.sourceName ?? '')) ||
      a.field.localeCompare(b.field) ||
      observationText(a.value).localeCompare(observationText(b.value)),
  );
}

export function withOnlyCurrentResearchPageText<T extends CoverageObservationLike>(
  observations: readonly T[],
): T[] {
  const current = currentResearchPageTextObservation(
    observations.filter((obs) => obs.field === RESEARCH_PAGE_TEXT_FIELD),
  );
  return observations.filter((obs) => obs.field !== RESEARCH_PAGE_TEXT_FIELD || obs === current);
}

export const WRITER_GRANT_RECENCY_YEARS = 5;
const WRITER_GRANT_ROLES: ReadonlySet<string> = new Set(['pi', 'copi']);
/** Without research prose of the row's own, one funded project would become the whole focus. */
export const MIN_GRANTS_WITHOUT_OWN_PROSE = 2;

interface WriterGrantLike {
  role?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}

const grantTime = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const time = new Date(value as string).getTime();
  return Number.isFinite(time) ? time : undefined;
};

/**
 * The grants the writer may read (#4867, owner direction): the row's lead is the
 * principal investigator or a co-principal investigator (#5537), and the grant is active or
 * ended within five years. A grant that records no role is not read. A grant
 * with no end date counts from its start date, and one with neither is not dated, so it
 * is not read.
 */
export function eligibleWriterGrants(recentGrants: unknown, now: Date): unknown[] {
  if (!Array.isArray(recentGrants)) return [];
  const floor = new Date(now);
  floor.setFullYear(floor.getFullYear() - WRITER_GRANT_RECENCY_YEARS);
  return recentGrants.filter((grant: WriterGrantLike) => {
    if (!grant || !WRITER_GRANT_ROLES.has(String(grant.role))) return false;
    const last = grantTime(grant.endDate) ?? grantTime(grant.startDate);
    return last !== undefined && last >= floor.getTime();
  });
}

/** Whether the row states its own research in at least one snippet that reads as a body. */
export function hasOwnResearchProse(snippets: readonly CoverageSnippet[]): boolean {
  return snippets.some((snippet) => fullDescriptionQuality(snippet.text).isUseful);
}

export interface WriterEvidenceOptions {
  websiteUrl?: unknown;
  storedPageText?: StoredPageTextLookup;
  now?: Date;
  /** The row's own refusals, so a value an operator refused never becomes evidence again. */
  fieldValueRefusals?: unknown;
  entityType?: unknown;
  kind?: unknown;
  /** The row's own name, slug and committed citations, for the namesake screen (#5764). */
  identity?: { slug?: unknown; name?: unknown; sourceUrls?: unknown };
  leadNames?: readonly (string | undefined | null)[];
  /**
   * The row's `websiteUrl` is stated by a live observation from a Yale-hosted source, such
   * as the lead's official profile or a department roster, rather than by the page itself.
   */
  websiteUrlStatedByYaleSource?: boolean;
}

const namesakeScreenIdentity = (
  identity: NonNullable<WriterEvidenceOptions['identity']>,
): ResearchEntityIdentity => ({
  slug: typeof identity.slug === 'string' ? identity.slug : undefined,
  name: typeof identity.name === 'string' ? identity.name : undefined,
  sourceUrls: Array.isArray(identity.sourceUrls)
    ? identity.sourceUrls.filter((url): url is string => typeof url === 'string')
    : [],
});

/**
 * Whether a page the writer would read names the row's lead, by the lane's own rule
 * (`descriptionPageNamesRowLead`, #4873), so a person-named row is never written from a
 * department homepage or another unit's page that does not name its lead.
 *
 * A page under the row's own website is admitted for this read without naming the lead
 * when a Yale-hosted source states that website: a personal site rarely restates its
 * owner's surname, and the Yale source is the identity evidence the page cannot give.
 * The lane gate keeps #5818's stricter rule, because a website the external page itself
 * supplied (#5777) has no such statement.
 */
export function writerEvidencePageNamesRowLead(
  observations: readonly CoverageObservationLike[],
  options: WriterEvidenceOptions,
  isPersonRow: boolean,
): EvidencePageAdmission {
  const personNames = (options.leadNames ?? []).filter(
    (name): name is string => typeof name === 'string' && name.trim() !== '',
  );
  if (personNames.length === 0) return () => true;
  const pageTextByUrl = storedPageTextByUrl(observations);
  const kind = isPersonRow ? 'individual' : options.kind;
  return (pageUrl, text) => {
    if (options.websiteUrlStatedByYaleSource && isUnderOwnWebsite(pageUrl, options.websiteUrl)) {
      return true;
    }
    const pageText = [
      pageTextByUrl.get(normalizeEvidenceUrl(pageUrl)),
      options.storedPageText?.(pageUrl),
      text,
    ]
      .filter(Boolean)
      .join('\n');
    return personNames.some((personName) =>
      descriptionPageNamesRowLead({
        personName,
        websiteUrl: options.websiteUrl,
        rowName: options.identity?.name,
        kind,
        pageUrl,
        pageText,
      }),
    );
  };
}

/**
 * The writer's evidence: page text the row carries, ordered by `orderWriterEvidence`,
 * and grant records only when that page text is absent or thin. A grant read comes from
 * the row's recorded grants, which carry the role and dates the grant rule needs; a
 * grant lane's own observation carries neither, so it is not read.
 */
export function buildWriterEvidenceSnippets(
  observations: readonly CoverageObservationLike[],
  recentGrants: unknown,
  options: WriterEvidenceOptions = {},
): CoverageSnippet[] {
  const isPersonRow = isPersonResearchRow({ entityType: options.entityType, kind: options.kind });
  const ownPersonEvidence =
    isPersonRow && options.identity
      ? withoutNamesakePersonPageDescriptions(
          observations,
          namesakeScreenIdentity(options.identity),
        )
      : observations;
  const admissible = refusedResolverObservations(
    withOnlyCurrentResearchPageText(ownPersonEvidence),
    options.fieldValueRefusals,
  ).kept;
  const ordered = orderWriterEvidence(admissible, options.websiteUrl);
  const pageObservations = ordered.filter((obs) => !isGrantEvidenceSource(obs.sourceName));
  const fromPages = gatherCoverageSnippets(pageObservations, options.storedPageText, {
    admitsPage: writerEvidencePageNamesRowLead(observations, options, isPersonRow),
  });
  if (hasOwnResearchProse(fromPages)) return fromPages;
  const room = MAX_COVERAGE_SNIPPETS - fromPages.length;
  if (room <= 0) return fromPages;
  const seen = new Set(fromPages.map((snippet) => snippet.text.toLowerCase()));
  const grants = buildGrantCorpusSnippets(
    eligibleWriterGrants(recentGrants, options.now ?? new Date()),
  ).filter((snippet) => {
    const key = snippet.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (grants.length < MIN_GRANTS_WITHOUT_OWN_PROSE) return fromPages;
  return [...fromPages, ...grants.slice(0, room)];
}

/**
 * The writer's evidence for a merge survivor. A row merged into this one is the same
 * research, so its page evidence is this row's evidence, but only to fill a row whose
 * own evidence is empty: #3584 keeps a merged-in row's prose from replacing a survivor's,
 * and widening every survivor's corpus would re-synthesize bodies that are already right.
 * "Own" is every observation anchored to the survivor's slug or id, so a merged-in row's
 * observation the PI dedupe relinked to the survivor's id already counts as the survivor's.
 */
export async function buildWriterEvidenceSnippetsWithMergedInFill(
  ownObservations: readonly CoverageObservationLike[],
  loadMergedInObservations: () => Promise<readonly CoverageObservationLike[]>,
  recentGrants: unknown,
  options: WriterEvidenceOptions = {},
): Promise<CoverageSnippet[]> {
  const own = buildWriterEvidenceSnippets(ownObservations, recentGrants, options);
  if (own.length > 0) return own;
  const mergedInObservations = await loadMergedInObservations();
  if (mergedInObservations.length === 0) return own;
  return buildWriterEvidenceSnippets(mergedInObservations, recentGrants, options);
}

export type WriterStep = 'no-evidence' | 'evidence-unchanged' | 'synthesize';

export function planWriterStep(input: {
  snippets: readonly CoverageSnippet[];
  storedHash: string | undefined;
  freshHash: string;
}): WriterStep {
  if (input.snippets.length === 0) return 'no-evidence';
  if (input.storedHash && input.storedHash === input.freshHash) return 'evidence-unchanged';
  return 'synthesize';
}

/**
 * A dry run reports the step it would take and never calls the writer model: every
 * call is paid, and a dry run is how operators count the work before paying for it.
 * On 2026-10-06 an all-live dry run made 3,586 paid calls because only the persist
 * step checked the mode. A dry run therefore builds no model client at all.
 */
export function writerModelClientFor<C>(input: {
  apply: boolean;
  apiKey: string | undefined;
  create: (apiKey: string) => C;
}): C | null {
  if (!input.apply) return null;
  if (!input.apiKey) {
    throw new Error('research-entity:coverage-synthesis apply requires OPENAI_API_KEY');
  }
  return input.create(input.apiKey);
}

/**
 * `--skip-index-sync` leaves the search index to one `yarn development:search:sync`
 * after an all-rows apply, in place of a Meilisearch sync per re-gated row. It sets the
 * process-wide switch every index writer already reads (the materializer, the gate and
 * the re-gate outcome), so no write path can sync a row behind it.
 */
export function deferSearchIndexWritesWhenSkipping(
  args: Pick<CoverageSynthesisArgs, 'skipIndexSync'>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (args.skipIndexSync) env[SEARCH_INDEX_WRITES_VARIABLE] = SEARCH_INDEX_WRITES_DEFERRED;
}

export interface WriterWrites {
  writeBody: boolean;
  recordHash: boolean;
}

const WRITES_NOTHING: WriterWrites = { writeBody: false, recordHash: false };

/**
 * What one writer step stores. The writer only adds bodies: a refused draft, a row with
 * no evidence left and a failed store all leave the body the row serves today in place,
 * because a refusal judges the new draft rather than the served body (#5537). A refusal
 * still records its hash, so it is final under the same evidence, prompt and model. A
 * failed call judged nothing, so it records no hash and the next run retries.
 */
export function writerWritesFor(
  step: WriterStep,
  decision: CoverageSynthesisDecision | null,
): WriterWrites {
  if (step === 'evidence-unchanged' || step === 'no-evidence') return WRITES_NOTHING;
  if (!decision || isCoverageSynthesisLlmFailure(decision.refusal)) return WRITES_NOTHING;
  return { writeBody: Boolean(decision.result), recordHash: true };
}

export function carriedOverWrites(
  writes: WriterWrites,
  carry: { carriedOver: boolean; liveBody: string | undefined; description: string | undefined },
): WriterWrites {
  if (!carry.carriedOver || !writes.writeBody) return writes;
  const same =
    (carry.liveBody ?? '').replace(/\s+/g, ' ').trim() ===
    (carry.description ?? '').replace(/\s+/g, ' ').trim();
  return same ? { ...writes, writeBody: false } : writes;
}

/**
 * A body the store refused leaves the row judged against evidence it no longer reflects,
 * so no hash is recorded and the next run judges the row again instead of reading it as
 * unchanged; the body the row serves today stays.
 */
export function writerWritesAfterBodyAttempt(
  writes: WriterWrites,
  bodyStored: boolean,
): WriterWrites {
  if (!writes.writeBody || bodyStored) return writes;
  return WRITES_NOTHING;
}

export const WRITER_EVIDENCE_FIELDS: readonly string[] = [
  ...COVERAGE_SNIPPET_FIELDS,
  RESEARCH_PAGE_TEXT_FIELD,
  SOURCE_CONTENT_HASH_FIELD,
];

export function writerObservationAnchors(input: {
  entityKey?: unknown;
  entityId?: unknown;
}): Record<string, unknown>[] {
  const anchors: Record<string, unknown>[] = [];
  if (typeof input.entityKey === 'string' && input.entityKey) {
    anchors.push({ entityKey: input.entityKey });
  }
  if (input.entityId) anchors.push({ entityId: input.entityId });
  return anchors;
}

export type ReinstateStep = 'reinstated' | 'reinstate-refused' | 'nothing-to-reinstate';

/**
 * What `--reinstate-retired-bodies` does with one row. A body the writer retired only
 * because a later draft was refused comes back when, judged against today's evidence by
 * the same content arms, it would not be retired under the refusal rule now in force.
 * A row that already serves a live written body is left alone, and so is one whose
 * retired body no longer clears the arms. No model is called.
 */
export function reinstateStepFor(input: {
  liveBody: string | undefined;
  retiredBody: string | undefined;
  retiredBodyStillSupported: boolean;
}): ReinstateStep {
  if (input.liveBody || !input.retiredBody) return 'nothing-to-reinstate';
  return input.retiredBodyStillSupported ? 'reinstated' : 'reinstate-refused';
}

/** The newest live body this lane wrote for the row, from observations already read. */
export function liveWrittenBody(
  observations: ReadonlyArray<CoverageObservationLike & { observedAt?: Date }>,
  sourceName: string,
): string | undefined {
  const bodies = observations
    .filter(
      (obs) =>
        obs.sourceName === sourceName &&
        obs.field === 'fullDescription' &&
        typeof obs.value === 'string' &&
        obs.value.trim().length > 0,
    )
    .sort((a, b) => (b.observedAt?.getTime() ?? 0) - (a.observedAt?.getTime() ?? 0));
  return bodies[0]?.value as string | undefined;
}

export function storedWriterEvidenceHash(
  observations: ReadonlyArray<CoverageObservationLike & { observedAt?: Date }>,
  sourceName: string,
): string | undefined {
  const hashes = observations
    .filter(
      (obs) =>
        obs.sourceName === sourceName &&
        obs.field === SOURCE_CONTENT_HASH_FIELD &&
        typeof obs.value === 'string',
    )
    .sort((a, b) => (b.observedAt?.getTime() ?? 0) - (a.observedAt?.getTime() ?? 0));
  return hashes[0]?.value as string | undefined;
}

/**
 * The rows whose card the written-body card defect left unservable: live, serving the
 * written body, and held on `missing_card_description`. `--rederive-cards` re-projects
 * only these, and calls the writer model for none of them; with `--all` it re-projects
 * every live row serving the written body, which is how a card rule change reaches them.
 */
export function writtenBodyCardRepairFilter(
  sourceName: string,
  options: { allWrittenRows?: boolean } = {},
): Record<string, unknown> {
  return {
    archived: { $ne: true },
    'fieldProvenance.fullDescription.sourceName': sourceName,
    ...(options.allWrittenRows ? {} : { studentVisibilityReasons: 'missing_card_description' }),
  };
}

/**
 * The one model lane whose values are admitted as writer evidence, and only for the
 * field it verifies: before storing a `fullDescription` it requires every sentence of
 * four or more words to be present in the fetched page text (`groundDescriptionExtraction`,
 * landed in #528). Its `shortDescription` can be a synthesized card, so it is not admitted.
 */
export const INGEST_VERIFIED_EXTRACTION_SOURCE = 'lab-microsite-description-llm';
export const INGEST_VERIFIED_EXTRACTION_FIELDS: ReadonlySet<string> = new Set(['fullDescription']);
/** When the ingest check reached the lane (#528 merged to beta), so earlier runs were not verified. */
export const PAGE_GROUNDING_VERIFIED_SINCE = new Date('2026-08-22T19:15:50Z');

interface RecordedRunLike {
  _id: unknown;
  sourceName?: unknown;
  startedAt?: unknown;
  invalidated?: unknown;
}

/**
 * The recorded runs of the extraction lane that ran with the ingest check. A run id is
 * the durable per-observation marker: the lane's own runs are recorded in `scrape_runs`,
 * while the description backfill script stores rewrites and syntheses under the same
 * source name with a fresh run id it never records, so its values match no run here.
 */
export function ingestVerifiedRunIds(runs: readonly RecordedRunLike[]): Set<string> {
  return new Set(
    runs
      .filter((run) => {
        if (run.sourceName !== INGEST_VERIFIED_EXTRACTION_SOURCE) return false;
        if (run.invalidated === true) return false;
        const started = grantTime(run.startedAt);
        return started !== undefined && started >= PAGE_GROUNDING_VERIFIED_SINCE.getTime();
      })
      .map((run) => String(run._id)),
  );
}

export function markIngestVerifiedObservations<T extends CoverageObservationLike>(
  observations: readonly T[],
  verifiedRunIds: ReadonlySet<string>,
): T[] {
  return observations.map((obs) =>
    obs.sourceName === INGEST_VERIFIED_EXTRACTION_SOURCE &&
    INGEST_VERIFIED_EXTRACTION_FIELDS.has(obs.field) &&
    obs.scrapeRunId !== undefined &&
    obs.scrapeRunId !== null &&
    verifiedRunIds.has(String(obs.scrapeRunId))
      ? { ...obs, ingestVerifiedAgainstPage: true }
      : { ...obs, ingestVerifiedAgainstPage: false },
  );
}
