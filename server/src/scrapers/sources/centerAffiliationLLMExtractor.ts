/**
 * Center affiliation LLM extractor.
 *
 * The heterogeneous long tail of research CENTER/INSTITUTE/INITIATIVE/CORE_FACILITY
 * entities has no uniform people roster (YSE centers link a school-wide directory,
 * Jackson child centers name a few faculty inline, etc.). Per-center HTML extractors
 * do not scale across them. This source reads each center's official page and uses an
 * LLM to extract the faculty explicitly named on it, then emits only
 * `researchEntityRelationship` observations keyed by the center's own slug.
 *
 * Conservatism is load-bearing: the LLM output is observations, not conclusions. The
 * shared materializer (`materializeResearchEntityRelationship`) resolves each named
 * person to an existing PI-led lab (preferred, AFFILIATED_LAB) or faculty-research-area
 * entity, and SKIPS anyone who does not uniquely resolve. Hallucinated or ambiguous
 * names therefore never create an entity or an edge. We deliberately do not emit
 * ResearchGroupMember rows here (those would persist name-only rows from LLM output).
 */
import axios from 'axios';
import mongoose from 'mongoose';
import * as cheerio from 'cheerio';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { openAiChatSampling } from '../../utils/openAiChatSampling';
import { serializedDocumentId } from '../../utils/idSerialization';
import { ResearchEntity } from '../../models/researchEntity';
import { Observation } from '../../models/observation';
import { escapeRegex } from '../../utils/regex';
import { FACULTY_RESEARCH_AREA_SLUG_PREFIX } from '../../utils/researchEntityShellSlug';
import {
  buildCenterRosterHealthSnapshot,
  CENTER_AFFILIATION_LLM_SOURCE_NAME,
  CENTER_ROSTER_HEALTH_ENTITY_TYPE,
  CENTER_ROSTER_HEALTH_FIELD,
  type CenterRosterReadMember,
} from '../centerRosterRetirement';
import { SLUG_MAX_LENGTH, slugTokens } from '../utils/scraperHelpers';
import { extractElementTextWithBlockSeparators } from '../utils/htmlText';
import {
  DEFAULT_SOURCE_CONCURRENCY,
  mapWithConcurrency,
  resolveSourceConcurrency,
} from '../utils/mapWithConcurrency';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  type CenterMember,
  centerMemberRelationshipObservationsForEntityKey,
} from './centersInstitutesScraper';
import { fetchPageWithPolicy } from '../utils/httpFetch';

const SOURCE_KEY = CENTER_AFFILIATION_LLM_SOURCE_NAME;
const AFFILIATION_READ_ROLE = 'affiliated';
const DEFAULT_MODEL = 'gpt-5-mini';
const MAX_PROMPT_CHARS = 30_000;
const ORG_ENTITY_TYPES = ['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY'];
const CENTER_AFFILIATION_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function normalizeCenterAffiliationObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return CENTER_AFFILIATION_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

export interface CenterAffiliationPerson {
  name: string;
  role?: string;
  title?: string;
  profileUrl?: string;
}

export interface CenterAffiliationExtraction {
  affiliatedPeople: CenterAffiliationPerson[];
}

export interface CandidateCenter {
  _id?: string;
  slug?: string;
  name: string;
  websiteUrl?: string;
}

export type FetchCenterPageFn = (url: string) => Promise<{ url: string; html: string } | null>;
export type CallCenterAffiliationLLMFn = (input: {
  model: string;
  apiKey: string;
  centerName: string;
  sourceUrl: string;
  pageText: string;
}) => Promise<CenterAffiliationExtraction>;
export type CenterFinderFn = (options?: { only?: string[] }) => Promise<CandidateCenter[]>;

export interface LiveAffiliationClaim {
  relationshipKey: string;
  targetEntityKey: string;
}

export type LiveAffiliationClaimFinderFn = (
  centerEntityKey: string,
) => Promise<LiveAffiliationClaim[]>;

export interface CenterAffiliationLLMExtractorDeps {
  fetchPage?: FetchCenterPageFn;
  callLLM?: CallCenterAffiliationLLMFn;
  centerFinder?: CenterFinderFn;
  liveClaimFinder?: LiveAffiliationClaimFinderFn;
  apiKey?: string;
  model?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/** Map an LLM-provided role onto a safe stored member role. */
function normalizeAffiliationRole(role: unknown): CenterMember['role'] {
  const value = textValue(role).toLowerCase();
  if (/\bco-?director\b/.test(value)) return 'co-director';
  if (/\bdirector\b/.test(value)) return 'director';
  return 'affiliated';
}

function htmlToPromptText(html: string): { text: string; truncated: boolean } {
  if (!html) return { text: '', truncated: false };
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, nav, footer').remove();
  const text = textValue(
    extractElementTextWithBlockSeparators($('body')[0]) ||
      extractElementTextWithBlockSeparators($.root()[0]),
  );
  return { text: text.slice(0, MAX_PROMPT_CHARS), truncated: text.length > MAX_PROMPT_CHARS };
}

export function personSlugIsStatedOnPage(
  personSlug: string,
  pageTokens: ReadonlySet<string>,
): boolean {
  const tokens = personSlug.split('-').filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => pageTokens.has(token));
}

/**
 * A claim the page still names is listed even when this read's model output omits it,
 * because one model call is not a repeatable read and its omission alone is not evidence
 * that the center stopped naming the person.
 */
export function affiliationReadMembers(
  observations: readonly ObservationInput[],
  liveClaims: readonly LiveAffiliationClaim[],
  pageText: string,
): CenterRosterReadMember[] {
  const listed = new Set(
    observations
      .filter((observation) => observation.entityType === 'researchEntityRelationship')
      .map((observation) => observation.entityKey)
      .filter((key): key is string => Boolean(key)),
  );
  const pageTokens = new Set(slugTokens(pageText));
  for (const claim of liveClaims) {
    if (listed.has(claim.relationshipKey)) continue;
    const personSlug =
      claim.targetEntityKey.startsWith(FACULTY_RESEARCH_AREA_SLUG_PREFIX) &&
      claim.targetEntityKey.length < SLUG_MAX_LENGTH
        ? claim.targetEntityKey.slice(FACULTY_RESEARCH_AREA_SLUG_PREFIX.length)
        : '';
    if (!personSlug || personSlugIsStatedOnPage(personSlug, pageTokens)) {
      listed.add(claim.relationshipKey);
    }
  }
  return Array.from(listed).map((relationshipKey) => ({
    memberKey: relationshipKey,
    role: AFFILIATION_READ_ROLE,
    relationshipKey,
  }));
}

export function affiliationReadSnapshotObservation(input: {
  centerEntityKey: string;
  sourceUrl: string;
  members: readonly CenterRosterReadMember[];
  truncated: boolean;
  readAt?: Date;
}): ObservationInput {
  return {
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    entityKey: input.centerEntityKey,
    field: CENTER_ROSTER_HEALTH_FIELD,
    value: buildCenterRosterHealthSnapshot({
      centerKey: input.centerEntityKey,
      entityKey: input.centerEntityKey,
      members: input.members,
      pagesRead: 1,
      readMode: 'html',
      stopReason: input.truncated ? 'page-cap' : 'not-paginated',
      cacheAllowed: false,
      readAt: input.readAt ?? new Date(),
    }),
    sourceUrl: input.sourceUrl,
  };
}

/**
 * Turn an LLM extraction into relationship-only observations keyed by the center's
 * own entity slug. No member rows are emitted — see the file header.
 */
export function affiliationExtractionToObservations(
  extraction: CenterAffiliationExtraction,
  context: { centerEntityKey: string; sourceUrl: string },
): ObservationInput[] {
  if (!context.centerEntityKey) return [];
  const out: ObservationInput[] = [];
  const seen = new Set<string>();
  for (const person of extraction?.affiliatedPeople || []) {
    const name = textValue(person?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const member: CenterMember = {
      name,
      role: normalizeAffiliationRole(person?.role),
      profileUrl: textValue(person?.profileUrl) || undefined,
      title: textValue(person?.title) || undefined,
    };
    out.push(
      ...centerMemberRelationshipObservationsForEntityKey(
        context.centerEntityKey,
        member,
        context.sourceUrl,
      ),
    );
  }
  return out;
}

async function defaultFetchPage(url: string): Promise<{ url: string; html: string } | null> {
  const page = await fetchPageWithPolicy(url, {
    timeoutMs: 15_000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    maxRedirects: 5,
  });
  return { url: page.url, html: page.html };
}

async function defaultCallLLM(input: {
  model: string;
  apiKey: string;
  centerName: string;
  sourceUrl: string;
  pageText: string;
}): Promise<CenterAffiliationExtraction> {
  const safeCenterName = redactDirectContactInfo(input.centerName).slice(0, 240);
  const safeSourceUrl = redactDirectContactInfo(input.sourceUrl).slice(0, 2048);
  const safePageText = redactDirectContactInfo(input.pageText).slice(0, MAX_PROMPT_CHARS);
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: input.model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You extract the Yale faculty/people explicitly named on an official research center or institute web page. ' +
            'Only include real personal names that literally appear in the provided page text (directors, affiliated faculty, core members). ' +
            'Never invent names, never include students/staff titles without a name, and never include people who are not on the page. ' +
            'Copy each name character-for-character exactly as it appears in the page text; never reformat, correct, translate, or complete a name. ' +
            'If the page names no individuals, return an empty list.',
        },
        {
          role: 'user',
          content: [
            `Center: ${safeCenterName}`,
            `Source URL: ${safeSourceUrl}`,
            'Return JSON: {"affiliatedPeople":[{"name":"First Last","role":"director|faculty|affiliated","title":"optional","profileUrl":"optional"}]}',
            safePageText,
          ].join('\n\n'),
        },
      ],
      ...openAiChatSampling(input.model),
    },
    {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 40_000,
    },
  );
  const choice = response.data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('LLM output was cut off');
  const content = choice?.message?.content;
  if (!content || typeof content !== 'string') throw new Error('LLM returned empty content');
  const parsed = JSON.parse(content) as Partial<CenterAffiliationExtraction>;
  return {
    affiliatedPeople: Array.isArray(parsed.affiliatedPeople) ? parsed.affiliatedPeople : [],
  };
}

async function defaultCenterFinder(options: { only?: string[] } = {}): Promise<CandidateCenter[]> {
  const only = Array.from(
    new Set((options.only || []).map((value) => value.trim()).filter(Boolean)),
  );
  const onlyObjectIds = only
    .map((value) => normalizeCenterAffiliationObjectId(value))
    .filter((value): value is string => Boolean(value))
    .map((value) => new mongoose.Types.ObjectId(value));
  const identityFilter = only.length
    ? {
        $or: [
          ...(onlyObjectIds.length ? [{ _id: { $in: onlyObjectIds } }] : []),
          { slug: { $in: only } },
          { name: { $in: only } },
        ],
      }
    : {};
  const docs = await ResearchEntity.find(
    {
      $and: [
        { entityType: { $in: ORG_ENTITY_TYPES } },
        { archived: { $ne: true } },
        { websiteUrl: /^https?:\/\//i },
        identityFilter,
      ],
    },
    { _id: 1, slug: 1, name: 1, websiteUrl: 1 },
  ).lean();
  return (docs as any[]).map((doc) => ({
    _id: serializedDocumentId(doc._id),
    slug: doc.slug,
    name: doc.name,
    websiteUrl: doc.websiteUrl,
  }));
}

async function defaultLiveClaimFinder(centerEntityKey: string): Promise<LiveAffiliationClaim[]> {
  const rows = (await Observation.find({
    sourceName: SOURCE_KEY,
    entityType: 'researchEntityRelationship',
    field: 'targetEntityKey',
    entityKey: { $regex: `^${escapeRegex(centerEntityKey)}:` },
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('entityKey value')
    .lean()) as Array<{ entityKey?: unknown; value?: unknown }>;
  return rows
    .map((row) => ({
      relationshipKey: textValue(row.entityKey),
      targetEntityKey: textValue(row.value),
    }))
    .filter((claim) => claim.relationshipKey && claim.targetEntityKey);
}

type CenterReadOutcome = 'fetch-failed' | 'page-too-small' | 'llm-failed' | 'read';

interface CenterReadTally {
  observationCount: number;
  entitiesObserved: number;
  admittedReads: number;
  partialReads: number;
  emptyReads: number;
  outcomes: Record<CenterReadOutcome, number>;
}

export class CenterAffiliationLLMExtractor implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'Center affiliation LLM (faculty & labs)';

  private readonly fetchPage: FetchCenterPageFn;
  private readonly callLLM: CallCenterAffiliationLLMFn;
  private readonly centerFinder: CenterFinderFn;
  private readonly liveClaimFinder: LiveAffiliationClaimFinderFn;
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(deps: CenterAffiliationLLMExtractorDeps = {}) {
    this.fetchPage = deps.fetchPage || defaultFetchPage;
    this.callLLM = deps.callLLM || defaultCallLLM;
    this.centerFinder = deps.centerFinder || defaultCenterFinder;
    this.liveClaimFinder = deps.liveClaimFinder || defaultLiveClaimFinder;
    this.apiKey = deps.apiKey || process.env.OPENAI_API_KEY;
    this.model = deps.model || DEFAULT_MODEL;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    if (!this.apiKey) {
      ctx.log('OPENAI_API_KEY missing; skipping center affiliation extraction.');
      return { observationCount: 0, entitiesObserved: 0, notes: 'OPENAI_API_KEY missing' };
    }

    const only = Array.from(
      new Set((ctx.options.only || []).map((v) => String(v).trim()).filter(Boolean)),
    );
    const offset = Math.max(0, Number(ctx.options.offset) || 0);
    const limit =
      ctx.options.exhaustive && ctx.options.limit === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(1, Number(ctx.options.limit) || 100);
    const candidates = (await this.centerFinder({ only }))
      .filter((c) => c.websiteUrl && c.slug)
      .slice(offset, offset + limit);

    const tally: CenterReadTally = {
      observationCount: 0,
      entitiesObserved: 0,
      admittedReads: 0,
      partialReads: 0,
      emptyReads: 0,
      outcomes: { 'fetch-failed': 0, 'page-too-small': 0, 'llm-failed': 0, read: 0 },
    };

    const concurrency = resolveSourceConcurrency(
      ctx.options.sourceConcurrency,
      DEFAULT_SOURCE_CONCURRENCY,
    );

    await mapWithConcurrency(candidates, concurrency, async (center) => {
      tally.outcomes[await this.readCenter(center, ctx, tally)] += 1;
    });

    return {
      observationCount: tally.observationCount,
      entitiesObserved: tally.entitiesObserved,
      notes:
        `Extracted LLM affiliations for ${tally.entitiesObserved} centers; ` +
        `${tally.admittedReads} complete read(s), ${tally.partialReads} partial, ${tally.emptyReads} empty, ` +
        `${tally.outcomes['fetch-failed']} fetch failure(s), ${tally.outcomes['page-too-small']} page(s) too small, ` +
        `${tally.outcomes['llm-failed']} model failure(s).`,
    };
  }

  private async readCenter(
    center: CandidateCenter,
    ctx: ScraperContext,
    tally: CenterReadTally,
  ): Promise<CenterReadOutcome> {
    const centerEntityKey = center.slug as string;
    let page: { url: string; html: string } | null;
    try {
      page = await this.fetchPage(center.websiteUrl as string);
    } catch (error) {
      ctx.log(
        `[${center.slug}] fetch failed for configured center URL: ${sanitizeLogValue(error)}`,
      );
      return 'fetch-failed';
    }
    const { text: pageText, truncated } = htmlToPromptText(page?.html || '');
    if (pageText.length < 120) {
      ctx.log(`[${center.slug}] page too small/empty; skipping.`);
      return 'page-too-small';
    }
    const sourceUrl = page?.url || (center.websiteUrl as string);

    let extraction: CenterAffiliationExtraction;
    try {
      extraction = await this.callLLM({
        model: this.model,
        apiKey: this.apiKey as string,
        centerName: center.name,
        sourceUrl,
        pageText,
      });
    } catch (error) {
      ctx.log(`[${center.slug}] affiliation extraction failed: ${sanitizeLogValue(error)}`);
      return 'llm-failed';
    }

    const observations = affiliationExtractionToObservations(extraction, {
      centerEntityKey,
      sourceUrl,
    });
    const members = observations.length
      ? affiliationReadMembers(observations, await this.liveClaimFinder(centerEntityKey), pageText)
      : [];
    const snapshot = affiliationReadSnapshotObservation({
      centerEntityKey,
      sourceUrl,
      members,
      truncated,
    });
    await ctx.emit([...observations, snapshot]);
    tally.observationCount += observations.length + 1;

    if (truncated) tally.partialReads += 1;
    else if (members.length === 0) tally.emptyReads += 1;
    else tally.admittedReads += 1;

    if (!observations.length) {
      ctx.log(`[${center.slug}] no named faculty extracted.`);
      return 'read';
    }
    tally.entitiesObserved += 1;
    ctx.log(
      `[${center.slug}] emitted ${observations.length} affiliation relationship observations${
        truncated ? ' (page truncated, read not admitted for retirement)' : ''
      }.`,
    );
    return 'read';
  }
}
