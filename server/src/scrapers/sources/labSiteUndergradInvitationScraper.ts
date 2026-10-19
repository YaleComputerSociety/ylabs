import { ResearchEntity } from '../../models';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
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
  htmlToPromptText,
  htmlToRosterText,
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

export interface LabSiteUndergradInvitationDeps {
  fetchPage?: FetchPageFn;
  labFinder?: InvitationLabFinder;
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

function pageText(html: string): string {
  return htmlToRosterText(html) || htmlToPromptText(html);
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

const normalizedQuote = (quote: string) => quote.toLowerCase().replace(/\s+/g, ' ').trim();

export function quotesSharedAcrossEntities(
  invitations: ReadonlyMap<string, ServedUndergradInvitation>,
  threshold = SHARED_QUOTE_ENTITY_THRESHOLD,
): Set<string> {
  const counts = new Map<string, number>();
  for (const invitation of invitations.values()) {
    const key = normalizedQuote(invitation.quote);
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

  constructor(deps: LabSiteUndergradInvitationDeps = {}) {
    this.fetchPage = deps.fetchPage ?? defaultFetchPage;
    this.labFinder = deps.labFinder ?? defaultInvitationLabFinder;
  }

  private async readLabPages(lab: CandidateLab): Promise<PromptSourcePage[] | null> {
    const home = await this.fetchPage(lab.websiteUrl);
    if (!home) return null;
    const pages: PromptSourcePage[] = [{ url: home.url, text: pageText(home.html) }];
    for (const url of candidateCrawlUrls(home.html, home.url, MAX_SUBPAGES_READ)) {
      const page = await this.fetchPage(url);
      if (page) pages.push({ url: page.url, text: pageText(page.html) });
    }
    return pages;
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
    let fetchFailed = 0;
    await mapWithConcurrency(
      labs,
      resolveSourceConcurrency(ctx.options.sourceConcurrency, DEFAULT_CONCURRENCY),
      async (lab) => {
        const pages = await this.readLabPages(lab);
        if (!pages) {
          fetchFailed += 1;
          return;
        }
        read.set(lab.slug, lab);
        const invitation = strongestInvitationOnPages(pages, lab, now);
        if (invitation) invitations.set(lab.slug, invitation);
      },
    );
    const shared = quotesSharedAcrossEntities(invitations);
    const observations: ObservationInput[] = [];
    let sharedRefused = 0;
    for (const [slug, lab] of read) {
      const invitation = invitations.get(slug) ?? null;
      if (invitation && shared.has(normalizedQuote(invitation.quote))) {
        sharedRefused += 1;
        continue;
      }
      observations.push(invitationObservation(lab, invitation));
    }
    if (labs.length > 0 && read.size === 0) {
      throw new Error(`${this.name}: every lab-site fetch failed (${fetchFailed})`);
    }
    await ctx.emit(observations);
    const counts = { actively_hiring: 0, welcomes_undergrads: 0 };
    for (const observation of observations) {
      const level = (observation.value as ServedUndergradInvitation | null)?.level;
      if (level) counts[level] += 1;
    }
    const notes = `read ${read.size}/${labs.length} lab sites; actively hiring ${counts.actively_hiring}, welcomes undergrads ${counts.welcomes_undergrads}; ${sharedRefused} refused as a quote shared by ${SHARED_QUOTE_ENTITY_THRESHOLD}+ rows; ${fetchFailed} home pages unreadable`;
    ctx.log(notes);
    return { observationCount: observations.length, entitiesObserved: read.size, notes };
  }
}
