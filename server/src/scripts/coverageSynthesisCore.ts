import {
  SOURCE_CONTENT_HASH_FIELD,
  computeVersionedContentHash,
} from '../scrapers/contentHashGate';
import {
  COVERAGE_SNIPPET_FIELDS,
  COVERAGE_SYNTHESIS_MODEL,
  MAX_COVERAGE_SNIPPETS,
  gatherCoverageSnippets,
  isCoverageSynthesisLlmFailure,
  type CoverageObservationLike,
  type CoverageSnippet,
  type CoverageSynthesisDecision,
  type StoredPageTextLookup,
} from '../scrapers/coverageSynthesis';
import { COVERAGE_SYNTHESIS_PROMPT_HASH } from '../scrapers/prompts';
import { getSourceCoverage } from '../scrapers/sourceCoverageRegistry';
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
  output?: string;
}

export const DEFAULT_COVERAGE_SYNTHESIS_LIMIT = 25;
export const DEFAULT_COVERAGE_SYNTHESIS_CONCURRENCY = 4;
const MAX_COVERAGE_SYNTHESIS_CONCURRENCY = 8;

/**
 * Folded into the evidence hash beside the prompt hash, so a change to the code-side
 * refusal arms re-judges every row once, the way a prompt edit already does.
 */
export const WRITER_CONTRACT_VERSION = 'written-description-4867-v1';

export function parseCoverageSynthesisArgs(argv: string[]): CoverageSynthesisArgs {
  const args: CoverageSynthesisArgs = {
    apply: false,
    confirm: false,
    limit: DEFAULT_COVERAGE_SYNTHESIS_LIMIT,
    all: false,
    rederiveCards: false,
    concurrency: DEFAULT_COVERAGE_SYNTHESIS_CONCURRENCY,
    slugs: [],
  };
  for (const token of argv) {
    if (token === '--apply') args.apply = true;
    else if (token === '--dry-run') args.apply = false;
    else if (token === '--confirm-coverage-synthesis') args.confirm = true;
    else if (token === '--all') args.all = true;
    else if (token === '--rederive-cards') args.rederiveCards = true;
    else if (token.startsWith('--limit=')) args.limit = Number(token.slice('--limit='.length));
    else if (token.startsWith('--concurrency=')) {
      args.concurrency = Number(token.slice('--concurrency='.length));
    } else if (token.startsWith('--slugs=')) {
      args.slugs = token
        .slice('--slugs='.length)
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean);
    } else if (token.startsWith('--output=')) args.output = token.slice('--output='.length);
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0)
    args.limit = DEFAULT_COVERAGE_SYNTHESIS_LIMIT;
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    args.concurrency = DEFAULT_COVERAGE_SYNTHESIS_CONCURRENCY;
  }
  args.concurrency = Math.min(MAX_COVERAGE_SYNTHESIS_CONCURRENCY, Math.floor(args.concurrency));
  return args;
}

export function assertCoverageSynthesisApplyAllowed(
  args: CoverageSynthesisArgs,
  dbLabel: string,
): void {
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

export type WriterEvidenceRank = 0 | 1 | 2 | 3;

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

/**
 * Which kind of page a piece of evidence is (#4867): 0 the row's own research site, 1 an
 * official profile, 2 any other page, 3 a grant record. The row's own site is decided by
 * the cited URL rather than the lane, because a lane that reads many kinds of page
 * cannot say which one a value came from, and many Yale sites are paths on a shared
 * host, so a person page on that host is a profile before it is the site.
 */
export function writerEvidenceRank(
  obs: Pick<CoverageObservationLike, 'sourceName' | 'sourceUrl'>,
  websiteUrl?: unknown,
): WriterEvidenceRank {
  if (isGrantEvidenceSource(obs.sourceName)) return 3;
  if (isOfficialYalePersonPageUrl(obs.sourceUrl)) return 1;
  if (isOnOwnResearchSite(obs.sourceUrl, websiteUrl)) return 0;
  if (hasCategory(obs.sourceName, 'OFFICIAL_PROFILE')) return 1;
  return 2;
}

/**
 * The row's own site, then its official profile, then other pages, grants last; within
 * a rank strongest first, then a total order on the remaining keys, so the same evidence
 * always yields the same snippet list and therefore the same hash whatever order the
 * database returned it in.
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

export const WRITER_GRANT_RECENCY_YEARS = 5;
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
 * principal investigator, and the grant is active or ended within five years. A grant
 * with no end date counts from its start date, and one with neither is not dated, so it
 * is not read.
 */
export function eligibleWriterGrants(recentGrants: unknown, now: Date): unknown[] {
  if (!Array.isArray(recentGrants)) return [];
  const floor = new Date(now);
  floor.setFullYear(floor.getFullYear() - WRITER_GRANT_RECENCY_YEARS);
  return recentGrants.filter((grant: WriterGrantLike) => {
    if (!grant || grant.role !== 'pi') return false;
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
  const ordered = orderWriterEvidence(observations, options.websiteUrl);
  const pageObservations = ordered.filter((obs) => !isGrantEvidenceSource(obs.sourceName));
  const fromPages = gatherCoverageSnippets(pageObservations, options.storedPageText);
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

export function writerEvidenceHash(snippets: readonly CoverageSnippet[]): string {
  return computeVersionedContentHash(
    snippets.map((snippet) => snippet.text).join('\n'),
    COVERAGE_SYNTHESIS_PROMPT_HASH,
    COVERAGE_SYNTHESIS_MODEL,
    WRITER_CONTRACT_VERSION,
  );
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

export interface WriterWrites {
  writeBody: boolean;
  retireBody: boolean;
  recordHash: boolean;
}

/**
 * What one writer step stores. The written body is a derivation of the evidence it was
 * written from, so a body the current evidence no longer supports is retired rather than
 * left to outrank the copied fallback: on a refusal, and when the row has no evidence
 * left. A failed call judged nothing, so it records no hash and the next run retries.
 */
export function writerWritesFor(
  step: WriterStep,
  decision: CoverageSynthesisDecision | null,
): WriterWrites {
  if (step === 'evidence-unchanged') {
    return { writeBody: false, retireBody: false, recordHash: false };
  }
  if (step === 'no-evidence') return { writeBody: false, retireBody: true, recordHash: false };
  if (!decision || isCoverageSynthesisLlmFailure(decision.refusal)) {
    return { writeBody: false, retireBody: false, recordHash: false };
  }
  if (decision.result) return { writeBody: true, retireBody: false, recordHash: true };
  return { writeBody: false, retireBody: true, recordHash: true };
}

/**
 * A body the store refused leaves the row judged against evidence it no longer reflects,
 * so the prior written body is retired and no hash is recorded: the next run judges the
 * row again instead of reading it as unchanged.
 */
export function writerWritesAfterBodyAttempt(
  writes: WriterWrites,
  bodyStored: boolean,
): WriterWrites {
  if (!writes.writeBody || bodyStored) return writes;
  return { writeBody: false, retireBody: true, recordHash: false };
}

export const WRITER_EVIDENCE_FIELDS: readonly string[] = [
  ...COVERAGE_SNIPPET_FIELDS,
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
 * only these, and calls the writer model for none of them.
 */
export function writtenBodyCardRepairFilter(sourceName: string): Record<string, unknown> {
  return {
    archived: { $ne: true },
    'fieldProvenance.fullDescription.sourceName': sourceName,
    studentVisibilityReasons: 'missing_card_description',
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
