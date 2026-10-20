/**
 * A research home's own site, read with code: its stated name, its research text and its
 * topics.
 *
 * The deterministic replacement for `lab-microsite-description-llm` (#5296). It reads the
 * same rows and the same pages as that lane, through the same URL guards, and stores what
 * the page says rather than a model's reading of it: the research text goes to
 * `researchSummary` as passages the description writer reads at materialization, so the
 * same page always yields the same observations. It writes no description and no card,
 * because a body and a card are the writer's job, and no methods, which the owner dropped
 * on 2026-10-19.
 */
import { fetchPageWithPolicy } from '../utils/httpFetch';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { serializedDocumentId } from '../../utils/idSerialization';
import { personProfileSourceMatchesEntity } from '../utils/personProfileEntityMatch';
import { isInstitutionSectionLandingUrl, isSharedEvidenceUrl } from '../utils/sharedEvidenceUrls';
import {
  OWNERSHIP_GUARDED_ENTITY_TYPE,
  refusesDescriptionOnSharedPage,
} from '../descriptionSourceOwnership';
import { descriptionEntityKindForResearchEntity } from '../../utils/researchHomeDescriptionSelection';
import { isPersonProfileOrDirectoryUrl } from '../../utils/researchHomeWebsiteUrl';
import {
  getResearchAreaCanonicalizer,
  type ResearchAreaCanonicalizer,
} from '../researchAreaCanonicalization';
import { computeContentHash, contentHashObservation } from '../contentHashGate';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  readLabPageName,
  readLabPageResearchPassages,
  readLabPageTopics,
  joinResearchPassages,
  type LabPageReadContext,
  type LabPageResearchPassage,
} from '../utils/labPageResearchRead';
import {
  defaultIdentityCorpusLoader,
  defaultLabFinder,
  descriptionPageNamesRowLead,
  fetchDescriptionPageWithTlsFallback,
  foreignEvidenceCiterNames,
  isKnownUnavailableSourceUrl,
  isNonIdentifyingDescriptionSourceUrl,
  isRefusedDescriptionLaneSourceUrl,
  researchSubPageCrawlUrls,
  type CandidateDescriptionLab,
  type FetchDescriptionPageFn,
  type FetchedDescriptionPage,
  type PageAttributionIdentityCorpus,
} from './labMicrositeDescriptionLLMExtractor';

export const LAB_SITE_RESEARCH_READ_SOURCE_NAME = 'lab-site-research-read';
export const RESEARCH_TEXT_FIELD = 'researchSummary';
export const MAX_RESEARCH_TEXT_SNIPPET_CHARS = 1200;
export const MAX_RESEARCH_TEXT_SNIPPETS = 12;

const LAB_NAME_CONFIDENCE = 0.95;
const MAX_RESEARCH_SUBPAGES = 2;
const EMPTY_SET: ReadonlySet<string> = new Set();

export interface LabSiteResearchReadDeps {
  fetchPage?: FetchDescriptionPageFn;
  labFinder?: (options?: {
    only?: string[];
    exhaustive?: boolean;
  }) => Promise<CandidateDescriptionLab[]>;
  identityCorpusLoader?: () => Promise<PageAttributionIdentityCorpus>;
  canonicalizerLoader?: () => Promise<ResearchAreaCanonicalizer>;
}

async function fetchPageOnce(url: string): Promise<FetchedDescriptionPage> {
  const page = await fetchPageWithPolicy(url, {
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    timeoutMs: 10_000,
  });
  return { url: page.url, html: page.html };
}

function defaultFetchPage(url: string): Promise<FetchedDescriptionPage | null> {
  return fetchDescriptionPageWithTlsFallback(url, fetchPageOnce);
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function splitAtSentenceBoundary(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const boundary = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
      window.lastIndexOf('; '),
    );
    const cut = boundary >= maxChars / 2 ? boundary + 1 : window.lastIndexOf(' ');
    const at = cut > 0 ? cut : maxChars;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * The research text as the writer reads it: one snippet per passage, a long passage cut at
 * a sentence boundary, at most `MAX_RESEARCH_TEXT_SNIPPETS` of them in page order. The
 * writer keeps at most that many snippets of at most that length per row, so a longer
 * value would be cut where the writer cuts rather than where the page's sentences end.
 */
export function researchTextSnippets(passages: readonly LabPageResearchPassage[]): string[] {
  return passages
    .flatMap((passage) => splitAtSentenceBoundary(passage.text, MAX_RESEARCH_TEXT_SNIPPET_CHARS))
    .filter(Boolean)
    .slice(0, MAX_RESEARCH_TEXT_SNIPPETS);
}

interface PageRead {
  page: FetchedDescriptionPage;
  passages: LabPageResearchPassage[];
}

const researchTextLength = (read: PageRead): number =>
  read.passages.reduce((total, passage) => total + passage.text.length, 0);

/**
 * The page whose research text this read stores. A crawled research page replaces the
 * home page only when it carries strictly more research text, so a home page with its own
 * statement keeps the citation and a home page that is a welcome blurb gives way to the
 * site's research page.
 */
export function selectResearchTextPage(reads: readonly PageRead[]): PageRead | undefined {
  let best: PageRead | undefined;
  for (const read of reads) {
    if (!best || researchTextLength(read) > researchTextLength(best)) best = read;
  }
  return best && researchTextLength(best) > 0 ? best : undefined;
}

export interface LabSiteResearchReadInput {
  lab: CandidateDescriptionLab;
  primary: FetchedDescriptionPage;
  crawled: readonly FetchedDescriptionPage[];
  identityCorpus: PageAttributionIdentityCorpus;
  canonicalizer: ResearchAreaCanonicalizer;
}

export interface LabSiteResearchReadOutcome {
  observations: ObservationInput[];
  refusal?: 'shared_evidence_url' | 'institution_landing_url' | 'page_does_not_name_row';
  snippetCount: number;
  topicCount: number;
  named: boolean;
}

/**
 * Pure: the observations one read of a row's pages states. A read whose page carries no
 * research text still records that it read the page and positively asserts no research
 * text, so a stale text is retired by the read rather than inferred from silence (#2647).
 */
export function labSiteResearchReadObservations(
  input: LabSiteResearchReadInput,
): LabSiteResearchReadOutcome {
  const { lab, primary, identityCorpus } = input;
  const entityId = serializedDocumentId(lab._id) || undefined;
  const entityRef = { entityType: 'researchEntity' as const, entityId, entityKey: lab.slug };
  const leadPersonName = identityCorpus.leadPersonNameByEntityId.get(entityId || '');
  const context = (pageUrl: string): LabPageReadContext => ({
    pageUrl,
    kind: descriptionEntityKindForResearchEntity(lab),
    entityType: lab.entityType,
    entityKey: lab.slug,
    personName: leadPersonName,
    knownPersonSurnames: identityCorpus.knownPersonSurnames,
    departments: lab.departments,
    recordCitedUrls: lab.sourceUrls,
  });
  const reads: PageRead[] = [primary, ...input.crawled].map((page) => ({
    page,
    passages: readLabPageResearchPassages(page.html, context(page.url)),
  }));
  const chosen = selectResearchTextPage(reads);
  const citedPage = chosen?.page ?? primary;
  const witness = (assertsNoValue: boolean, hashText: string): ObservationInput => ({
    ...contentHashObservation(entityRef, citedPage.url, computeContentHash(hashText)),
    ...(assertsNoValue ? { assertsNoValueFor: [RESEARCH_TEXT_FIELD] } : {}),
  });

  if (
    refusesDescriptionOnSharedPage(
      {
        entityType: OWNERSHIP_GUARDED_ENTITY_TYPE,
        field: 'fullDescription',
        sourceUrl: citedPage.url,
        ownName: lab.name,
      },
      foreignEvidenceCiterNames(
        citedPage.url,
        entityId,
        identityCorpus.evidenceCiters ?? new Map(),
      ),
    )
  ) {
    return {
      observations: [],
      refusal: 'shared_evidence_url',
      snippetCount: 0,
      topicCount: 0,
      named: false,
    };
  }
  if (
    isInstitutionSectionLandingUrl(citedPage.url, identityCorpus.institutionalHosts ?? EMPTY_SET)
  ) {
    return {
      observations: [],
      refusal: 'institution_landing_url',
      snippetCount: 0,
      topicCount: 0,
      named: false,
    };
  }
  const researchText = chosen ? joinResearchPassages(chosen.passages) : '';
  if (
    researchText &&
    !descriptionPageNamesRowLead({
      personName: leadPersonName,
      websiteUrl: lab.websiteUrl,
      rowName: lab.name,
      kind: lab.kind,
      pageUrl: citedPage.url,
      pageText: researchText,
    })
  ) {
    return {
      observations: [],
      refusal: 'page_does_not_name_row',
      snippetCount: 0,
      topicCount: 0,
      named: false,
    };
  }

  const observations: ObservationInput[] = [];
  const base = { ...entityRef, sourceUrl: citedPage.url };
  const snippets = chosen ? researchTextSnippets(chosen.passages) : [];
  if (snippets.length > 0) {
    observations.push({ ...base, field: RESEARCH_TEXT_FIELD, value: snippets });
  }
  const topics = chosen
    ? readLabPageTopics(chosen.page.html, researchText, input.canonicalizer, lab.departments)
    : [];
  if (topics.length > 0) observations.push({ ...base, field: 'researchAreas', value: topics });

  const pageNameIsShared =
    isSharedEvidenceUrl(primary.url, identityCorpus.sharedUrls ?? EMPTY_SET) &&
    !isPersonProfileOrDirectoryUrl(primary.url);
  const name = pageNameIsShared ? undefined : readLabPageName(primary.html, context(primary.url));
  const adoptableName = name && !name.leadsPersonalPage ? name.value : '';
  if (adoptableName) {
    const nameBase = {
      ...entityRef,
      sourceUrl: primary.url,
      confidenceOverride: LAB_NAME_CONFIDENCE,
    };
    observations.push(
      { ...nameBase, field: 'name', value: adoptableName },
      { ...nameBase, field: 'displayName', value: adoptableName },
    );
  }
  observations.push(
    witness(
      snippets.length === 0,
      [snippets.join('\n'), topics.join('\n'), adoptableName].join('\n\n'),
    ),
  );
  return {
    observations,
    snippetCount: snippets.length,
    topicCount: topics.length,
    named: Boolean(adoptableName),
  };
}

export class LabSiteResearchReadScraper implements IScraper {
  readonly name = LAB_SITE_RESEARCH_READ_SOURCE_NAME;
  readonly displayName = 'Lab site research read (deterministic)';

  private readonly fetchPage: FetchDescriptionPageFn;
  private readonly labFinder: NonNullable<LabSiteResearchReadDeps['labFinder']>;
  private readonly identityCorpusLoader: () => Promise<PageAttributionIdentityCorpus>;
  private readonly canonicalizerLoader: () => Promise<ResearchAreaCanonicalizer>;

  constructor(deps: LabSiteResearchReadDeps = {}) {
    this.fetchPage = deps.fetchPage ?? defaultFetchPage;
    this.labFinder = deps.labFinder ?? defaultLabFinder;
    this.identityCorpusLoader = deps.identityCorpusLoader ?? defaultIdentityCorpusLoader;
    this.canonicalizerLoader = deps.canonicalizerLoader ?? getResearchAreaCanonicalizer;
  }

  private async fetchFirstReadablePage(
    lab: CandidateDescriptionLab,
    identityCorpus: PageAttributionIdentityCorpus,
    log: (message: string) => void,
  ): Promise<FetchedDescriptionPage | null> {
    const urls = Array.from(new Set([lab.websiteUrl, ...(lab.sourceUrls || [])])).filter(
      (url) =>
        Boolean(url) &&
        !isRefusedDescriptionLaneSourceUrl(url) &&
        !isNonIdentifyingDescriptionSourceUrl(url, identityCorpus) &&
        personProfileSourceMatchesEntity(url, lab) &&
        !isKnownUnavailableSourceUrl(url, lab.sourceLinkHealth),
    );
    for (const url of urls) {
      try {
        const page = await this.fetchPage(url);
        if (!page?.html) continue;
        if (isNonIdentifyingDescriptionSourceUrl(page.url, identityCorpus)) return null;
        if (!personProfileSourceMatchesEntity(page.url, lab)) return null;
        return page;
      } catch (error) {
        log(`[${lab.slug || 'candidate'}] page fetch failed: ${sanitizeLogValue(error)}`);
      }
    }
    return null;
  }

  private async fetchResearchSubpages(
    lab: CandidateDescriptionLab,
    primary: FetchedDescriptionPage,
    identityCorpus: PageAttributionIdentityCorpus,
    log: (message: string) => void,
  ): Promise<FetchedDescriptionPage[]> {
    const pages: FetchedDescriptionPage[] = [];
    const kind = descriptionEntityKindForResearchEntity(lab);
    for (const url of researchSubPageCrawlUrls(primary.html, primary.url, MAX_RESEARCH_SUBPAGES, {
      includeAboutPages: kind === 'organization',
    })) {
      if (isKnownUnavailableSourceUrl(url, lab.sourceLinkHealth)) continue;
      if (isNonIdentifyingDescriptionSourceUrl(url, identityCorpus)) continue;
      try {
        const page = await this.fetchPage(url);
        if (!page?.html || !personProfileSourceMatchesEntity(page.url, lab)) continue;
        if (page.url === primary.url || pages.some((seen) => seen.url === page.url)) continue;
        pages.push(page);
      } catch (error) {
        log(`[${lab.slug || 'candidate'}] research subpage skipped: ${sanitizeLogValue(error)}`);
      }
    }
    return pages;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const only = Array.from(
      new Set((ctx.options.only || []).map((value) => String(value).trim()).filter(Boolean)),
    );
    const offset = Math.max(0, Number(ctx.options.offset) || 0);
    const limit =
      ctx.options.exhaustive && ctx.options.limit === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(1, Number(ctx.options.limit) || 100);
    const candidates = (await this.labFinder({ only, exhaustive: ctx.options.exhaustive }))
      .filter((lab) => lab.websiteUrl && !isRefusedDescriptionLaneSourceUrl(lab.websiteUrl))
      .slice(offset, offset + limit);
    const [identityCorpus, canonicalizer] = await Promise.all([
      this.identityCorpusLoader(),
      this.canonicalizerLoader(),
    ]);
    const counts = {
      read: 0,
      unreadable: 0,
      unparseable: 0,
      refused: 0,
      withText: 0,
      empty: 0,
      named: 0,
    };
    let observationCount = 0;
    for (const lab of candidates) {
      await yieldToEventLoop();
      const primary = await this.fetchFirstReadablePage(lab, identityCorpus, ctx.log);
      if (!primary) {
        counts.unreadable += 1;
        continue;
      }
      const crawled = await this.fetchResearchSubpages(lab, primary, identityCorpus, ctx.log);
      let outcome: LabSiteResearchReadOutcome;
      try {
        outcome = labSiteResearchReadObservations({
          lab,
          primary,
          crawled,
          identityCorpus,
          canonicalizer,
        });
      } catch (error) {
        counts.unparseable += 1;
        ctx.log(`[${lab.slug || 'candidate'}] page could not be read: ${sanitizeLogValue(error)}`);
        continue;
      }
      counts.read += 1;
      if (outcome.refusal) {
        counts.refused += 1;
        ctx.log(`[${lab.slug || 'candidate'}] research text refused: ${outcome.refusal}.`);
        continue;
      }
      if (outcome.snippetCount > 0) counts.withText += 1;
      else counts.empty += 1;
      if (outcome.named) counts.named += 1;
      await ctx.emit(outcome.observations);
      observationCount += outcome.observations.length;
    }
    return {
      observationCount,
      entitiesObserved: counts.withText + counts.empty,
      notes:
        `Read ${counts.read} of ${candidates.length} research homes: ${counts.withText} stated research text, ` +
        `${counts.empty} stated none, ${counts.refused} refused, ${counts.unreadable} unreadable, ${counts.unparseable} unparseable, ${counts.named} named.`,
    };
  }
}
