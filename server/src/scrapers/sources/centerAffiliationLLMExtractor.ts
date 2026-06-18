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
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { serializedDocumentId } from '../../utils/idSerialization';
import { ResearchEntity } from '../../models/researchEntity';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  type CenterMember,
  centerMemberRelationshipObservationsForEntityKey,
} from './centersInstitutesScraper';

const SOURCE_KEY = 'center-affiliation-llm';
const DEFAULT_MODEL = 'gpt-4o-mini';
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

export interface CenterAffiliationLLMExtractorDeps {
  fetchPage?: FetchCenterPageFn;
  callLLM?: CallCenterAffiliationLLMFn;
  centerFinder?: CenterFinderFn;
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

function htmlToText(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, nav, footer').remove();
  return textValue($('body').text() || $.root().text()).slice(0, MAX_PROMPT_CHARS);
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
  // SSRF guard: url is a DB-sourced center websiteUrl — block private/metadata hosts
  // and validate redirect hops at connect time.
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrlText, {
    timeout: 15_000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
    maxRedirects: 5,
  });
  return { url: res.request?.res?.responseUrl || safeUrlText, html: String(res.data || '') };
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
      temperature: 0,
    },
    {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 40_000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') throw new Error('LLM returned empty content');
  const parsed = JSON.parse(content) as Partial<CenterAffiliationExtraction>;
  return { affiliatedPeople: Array.isArray(parsed.affiliatedPeople) ? parsed.affiliatedPeople : [] };
}

async function defaultCenterFinder(options: { only?: string[] } = {}): Promise<CandidateCenter[]> {
  const only = Array.from(new Set((options.only || []).map((value) => value.trim()).filter(Boolean)));
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

export class CenterAffiliationLLMExtractor implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'Center affiliation LLM (faculty & labs)';

  private readonly fetchPage: FetchCenterPageFn;
  private readonly callLLM: CallCenterAffiliationLLMFn;
  private readonly centerFinder: CenterFinderFn;
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(deps: CenterAffiliationLLMExtractorDeps = {}) {
    this.fetchPage = deps.fetchPage || defaultFetchPage;
    this.callLLM = deps.callLLM || defaultCallLLM;
    this.centerFinder = deps.centerFinder || defaultCenterFinder;
    this.apiKey = deps.apiKey || process.env.OPENAI_API_KEY;
    this.model = deps.model || DEFAULT_MODEL;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    if (!this.apiKey) {
      ctx.log('OPENAI_API_KEY missing; skipping center affiliation extraction.');
      return { observationCount: 0, entitiesObserved: 0, notes: 'OPENAI_API_KEY missing' };
    }

    const only = Array.from(new Set((ctx.options.only || []).map((v) => String(v).trim()).filter(Boolean)));
    const offset = Math.max(0, Number(ctx.options.offset) || 0);
    const limit = Math.max(1, Number(ctx.options.limit) || 100);
    const candidates = (await this.centerFinder({ only }))
      .filter((c) => c.websiteUrl && c.slug)
      .slice(offset, offset + limit);

    let observationCount = 0;
    let entitiesObserved = 0;

    for (const center of candidates) {
      try {
        let page: { url: string; html: string } | null = null;
        try {
          page = await this.fetchPage(center.websiteUrl as string);
        } catch (error) {
          ctx.log(`[${center.slug}] fetch failed for configured center URL: ${sanitizeLogValue(error)}`);
          continue;
        }
        const pageText = htmlToText(page?.html || '');
        if (pageText.length < 120) {
          ctx.log(`[${center.slug}] page too small/empty; skipping.`);
          continue;
        }

        const extraction = await this.callLLM({
          model: this.model,
          apiKey: this.apiKey,
          centerName: center.name,
          sourceUrl: page?.url || (center.websiteUrl as string),
          pageText,
        });
        const observations = affiliationExtractionToObservations(extraction, {
          centerEntityKey: center.slug as string,
          sourceUrl: page?.url || (center.websiteUrl as string),
        });
        if (!observations.length) {
          ctx.log(`[${center.slug}] no named faculty extracted.`);
          continue;
        }
        await ctx.emit(observations);
        observationCount += observations.length;
        entitiesObserved += 1;
        ctx.log(`[${center.slug}] emitted ${observations.length} affiliation relationship observations.`);
      } catch (error) {
        ctx.log(`[${center.slug}] affiliation extraction failed: ${sanitizeLogValue(error)}`);
      }
    }

    return {
      observationCount,
      entitiesObserved,
      notes: `Extracted LLM affiliations for ${entitiesObserved} centers.`,
    };
  }
}
