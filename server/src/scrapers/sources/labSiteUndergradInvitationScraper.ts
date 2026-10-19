import * as cheerio from 'cheerio';
import { ResearchEntity } from '../../models';
import { Observation } from '../../models/observation';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { extractElementTextWithLineBreaks } from '../utils/htmlText';
import { mapWithConcurrency, resolveSourceConcurrency } from '../utils/mapWithConcurrency';
import { quotePageIsAboutAnotherEntity } from '../undergradQuoteRelevance';
import {
  extractUndergradInvitation,
  strongerInvitation,
  type UndergradInvitation,
} from '../utils/undergradInvitation';
import {
  candidateCrawlUrls,
  candidateLabFromResearchEntityDoc,
  defaultFetchPage,
  discoverSubPageUrls,
  PAGE_CHROME_SELECTOR,
  pagesWithinEntityScope,
  selectLabsToProcess,
  UNDERGRAD_LLM_CANDIDATE_FILTER,
  type CandidateLab,
  type FetchPageFn,
  type PromptSourcePage,
} from './labMicrositeUndergradLLMExtractor';

export const LAB_SITE_UNDERGRAD_INVITATION_SOURCE = 'lab-site-undergrad-invitation';
export const UNDERGRAD_INVITATION_FIELD = 'undergradInvitation';

const MAX_SUBPAGES_READ = 4;
const DEFAULT_CONCURRENCY = 6;
export const SHARED_QUOTE_ENTITY_THRESHOLD = 3;

export interface ServedUndergradInvitation extends UndergradInvitation {
  sourceUrl: string;
}

export type InvitationLabFinder = () => Promise<CandidateLab[]>;
export type LiveInvitationQuoteFinder = () => Promise<Map<string, string>>;

export interface LabSiteUndergradInvitationDeps {
  fetchPage?: FetchPageFn;
  labFinder?: InvitationLabFinder;
  liveQuoteFinder?: LiveInvitationQuoteFinder;
}

interface LabPagesRead {
  pages: PromptSourcePage[];
  complete: boolean;
}

async function defaultInvitationLabFinder(): Promise<CandidateLab[]> {
  const docs = await ResearchEntity.find(UNDERGRAD_LLM_CANDIDATE_FILTER, {
    _id: 1,
    slug: 1,
    name: 1,
    displayName: 1,
    websiteUrl: 1,
    website: 1,
    sourceUrls: 1,
    archived: 1,
    entityType: 1,
    kind: 1,
  }).lean();
  return (docs as Record<string, unknown>[]).map(candidateLabFromResearchEntityDoc);
}

async function defaultLiveInvitationQuoteFinder(): Promise<Map<string, string>> {
  const rows = await Observation.find({
    sourceName: LAB_SITE_UNDERGRAD_INVITATION_SOURCE,
    entityType: 'researchEntity',
    field: UNDERGRAD_INVITATION_FIELD,
    superseded: false,
    'rollback.rolledBackAt': { $exists: false },
    'value.quote': { $type: 'string' },
  })
    .select('entityKey value')
    .lean<Array<{ entityKey?: string; value?: { quote?: string } }>>();
  const quotes = new Map<string, string>();
  for (const row of rows) {
    if (row.entityKey && row.value?.quote) quotes.set(row.entityKey, row.value.quote);
  }
  return quotes;
}

function blockLinesWithout(html: string, removedSelector: string): string {
  try {
    const $ = cheerio.load(html);
    $(removedSelector).remove();
    return extractElementTextWithLineBreaks($('body')[0] ?? $.root()[0]);
  } catch {
    return '';
  }
}

function pageText(html: string): string {
  return (
    blockLinesWithout(html, PAGE_CHROME_SELECTOR) ||
    blockLinesWithout(html, 'script, style, noscript, svg, iframe')
  );
}

export function strongestInvitationOnPages(
  pages: readonly PromptSourcePage[],
  lab: CandidateLab,
  now: Date,
): ServedUndergradInvitation | null {
  let best: ServedUndergradInvitation | null = null;
  for (const page of pagesWithinEntityScope(pages)) {
    if (quotePageIsAboutAnotherEntity(page.url, lab)) continue;
    const found = extractUndergradInvitation(page.text, now);
    if (!found) continue;
    const candidate = { ...found, sourceUrl: page.url };
    if (strongerInvitation(best, candidate) === candidate) best = candidate;
  }
  return best;
}

function withoutHash(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.toString();
}

const normalizedQuote = (quote: string) => quote.toLowerCase().replace(/\s+/g, ' ').trim();

export function quotesSharedAcrossEntities(
  quotesByEntity: ReadonlyMap<string, string>,
  threshold = SHARED_QUOTE_ENTITY_THRESHOLD,
): Set<string> {
  const counts = new Map<string, number>();
  for (const quote of quotesByEntity.values()) {
    const key = normalizedQuote(quote);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count >= threshold).map(([quote]) => quote));
}

export function invitationObservation(
  lab: CandidateLab,
  invitation: ServedUndergradInvitation | null,
): ObservationInput {
  if (!invitation) {
    return {
      entityType: 'researchEntity',
      entityKey: lab.slug,
      field: UNDERGRAD_INVITATION_FIELD,
      value: null,
      sourceUrl: lab.websiteUrl,
      assertsNoValueFor: [UNDERGRAD_INVITATION_FIELD],
    };
  }
  return {
    entityType: 'researchEntity',
    entityKey: lab.slug,
    field: UNDERGRAD_INVITATION_FIELD,
    value: { level: invitation.level, quote: invitation.quote, sourceUrl: invitation.sourceUrl },
    sourceUrl: invitation.sourceUrl,
  };
}

export class LabSiteUndergradInvitationScraper implements IScraper {
  readonly name = LAB_SITE_UNDERGRAD_INVITATION_SOURCE;
  readonly displayName = 'Lab site undergraduate invitations';

  private readonly fetchPage: FetchPageFn;
  private readonly labFinder: InvitationLabFinder;
  private readonly liveQuoteFinder: LiveInvitationQuoteFinder;

  constructor(deps: LabSiteUndergradInvitationDeps = {}) {
    this.fetchPage = deps.fetchPage ?? defaultFetchPage;
    this.labFinder = deps.labFinder ?? defaultInvitationLabFinder;
    this.liveQuoteFinder = deps.liveQuoteFinder ?? defaultLiveInvitationQuoteFinder;
  }

  private async readLabPages(lab: CandidateLab): Promise<LabPagesRead | null> {
    const home = await this.fetchPage(lab.websiteUrl);
    if (!home) return null;
    const pages: PromptSourcePage[] = [{ url: home.url, text: pageText(home.html) }];
    const linked = new Set(
      discoverSubPageUrls(home.html, home.url, MAX_SUBPAGES_READ).map(withoutHash),
    );
    let complete = true;
    for (const url of candidateCrawlUrls(home.html, home.url, MAX_SUBPAGES_READ)) {
      const page = await this.fetchPage(url);
      if (page) pages.push({ url: page.url, text: pageText(page.html) });
      else if (linked.has(url)) complete = false;
    }
    return { pages, complete };
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const now = ctx.options.referenceDate ?? new Date();
    const labs = selectLabsToProcess(await this.labFinder(), {
      only: ctx.options.only,
      limit: ctx.options.limit,
      exhaustive: ctx.options.exhaustive,
    });
    const read = new Map<string, CandidateLab>();
    const invitations = new Map<string, ServedUndergradInvitation>();
    const partialReads = new Map<
      string,
      { lab: CandidateLab; invitation: ServedUndergradInvitation | null }
    >();
    let fetchFailed = 0;
    await mapWithConcurrency(
      labs,
      resolveSourceConcurrency(ctx.options.sourceConcurrency, DEFAULT_CONCURRENCY),
      async (lab) => {
        const labPages = await this.readLabPages(lab);
        if (!labPages) {
          fetchFailed += 1;
          return;
        }
        const invitation = strongestInvitationOnPages(labPages.pages, lab, now);
        if (!labPages.complete) {
          partialReads.set(lab.slug, { lab, invitation });
          return;
        }
        read.set(lab.slug, lab);
        if (invitation) invitations.set(lab.slug, invitation);
      },
    );
    if (labs.length > 0 && read.size === 0 && partialReads.size === 0) {
      throw new Error(`${this.name}: every lab-site fetch failed (${fetchFailed})`);
    }
    const corpusQuotes = await this.liveQuoteFinder();
    let heldPartialReads = 0;
    for (const [slug, { lab, invitation }] of partialReads) {
      const cannotDowngrade =
        invitation?.level === 'actively_hiring' || (invitation && !corpusQuotes.has(slug));
      if (!cannotDowngrade) {
        heldPartialReads += 1;
        continue;
      }
      read.set(slug, lab);
      invitations.set(slug, invitation);
    }
    for (const slug of read.keys()) {
      const invitation = invitations.get(slug);
      if (invitation) corpusQuotes.set(slug, invitation.quote);
      else corpusQuotes.delete(slug);
    }
    const shared = quotesSharedAcrossEntities(corpusQuotes);
    const observations: ObservationInput[] = [];
    let sharedRefused = 0;
    for (const [slug, lab] of read) {
      const invitation = invitations.get(slug) ?? null;
      if (invitation && shared.has(normalizedQuote(invitation.quote))) {
        sharedRefused += 1;
        observations.push(invitationObservation(lab, null));
        continue;
      }
      observations.push(invitationObservation(lab, invitation));
    }
    await ctx.emit(observations);
    const counts = { actively_hiring: 0, welcomes_undergrads: 0 };
    for (const observation of observations) {
      const level = (observation.value as ServedUndergradInvitation | null)?.level;
      if (level) counts[level] += 1;
    }
    const notes = `read ${read.size}/${labs.length} lab sites; actively hiring ${counts.actively_hiring}, welcomes undergrads ${counts.welcomes_undergrads}; ${sharedRefused} refused as a quote shared by ${SHARED_QUOTE_ENTITY_THRESHOLD}+ rows; ${fetchFailed} home pages unreadable; ${heldPartialReads} rows held at their live value because a linked page was unreadable`;
    ctx.log(notes);
    return { observationCount: observations.length, entitiesObserved: read.size, notes };
  }
}
