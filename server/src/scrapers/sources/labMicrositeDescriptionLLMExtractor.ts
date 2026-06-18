import axios from 'axios';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import { ResearchEntity } from '../../models/researchEntity';
import { VisibilityReleaseQueueItem } from '../../models/visibilityReleaseQueueItem';
import {
  deriveShortDescriptionFromFullDescription,
  shortDescriptionQuality,
} from '../../utils/researchEntityDescriptionQuality';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { serializedDocumentId } from '../../utils/idSerialization';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  createWorkPlannerMetrics,
  getWorkPlannerSourcePolicy,
  loadEntityWorkPlan,
  recordWorkPlannerDecision,
  recordWorkPlannerNoIdentifier,
  type EntityWorkPlan,
  type WorkPlannerSourcePolicy,
} from '../workPlanner';
import { extractLabHomepageDescription } from './ysmAtoZScraper';

const SOURCE_KEY = 'lab-microsite-description-llm';
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_PROMPT_CHARS = 40_000;
const DESCRIPTION_LLM_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function normalizeDescriptionLlmObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return DESCRIPTION_LLM_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

export interface CandidateDescriptionLab {
  _id?: unknown;
  slug?: string;
  name: string;
  websiteUrl: string;
  sourceUrls?: string[];
  manuallyLockedFields?: string[];
}

export interface CandidateDescriptionLabDoc {
  _id?: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  websiteUrl?: string;
  website?: string;
  sourceUrls?: string[];
  manuallyLockedFields?: string[];
}

export interface FetchedDescriptionPage {
  url: string;
  html: string;
}

export interface DescriptionExtraction {
  fullDescription: string;
  shortDescription: string;
  topics: string[];
  methods: string[];
}

export type FetchDescriptionPageFn = (url: string) => Promise<FetchedDescriptionPage | null>;
export type CallDescriptionLLMFn = (input: {
  model: string;
  apiKey: string;
  labName: string;
  sourceUrl: string;
  pageText: string;
}) => Promise<DescriptionExtraction>;

export type DescriptionWorkPlanLoaderFn = (
  lab: CandidateDescriptionLab,
  policy: WorkPlannerSourcePolicy,
  ctx: ScraperContext,
) => Promise<EntityWorkPlan>;

export interface LabMicrositeDescriptionLLMExtractorDeps {
  fetchPage?: FetchDescriptionPageFn;
  callLLM?: CallDescriptionLLMFn;
  workPlanLoader?: DescriptionWorkPlanLoaderFn;
  labFinder?: (options?: { only?: string[] }) => Promise<CandidateDescriptionLab[]>;
  apiKey?: string;
  model?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

function parseRuntimeIntegerOption(
  value: number | undefined,
  flag: string,
  options: { min: number; label: 'positive' | 'non-negative'; fallback: number },
): number {
  if (value === undefined) return options.fallback;
  if (!Number.isSafeInteger(value) || value < options.min) {
    throw new Error(`${flag} must be a safe ${options.label} integer`);
  }
  return value;
}

const rejectedDescriptionSourcePatterns = [
  /\/membership\/directory\/?$/i,
  /\/(?:people|faculty|directory|members)\/?$/i,
  /(?:^|\.)orcid\.org/i,
  /(?:^|\.)doi\.org/i,
  /(?:^|\.)openalex\.org/i,
  /(?:^|\.)crossref\.org/i,
  /reporter\.nih\.gov/i,
  /nsf\.gov/i,
  /api\.nsf\.gov/i,
];

function isRejectedDescriptionSourceUrl(value: unknown): boolean {
  const urlText = textValue(value);
  if (!/^https?:\/\//i.test(urlText)) return true;
  try {
    const url = new URL(urlText);
    const hostPath = `${url.hostname}${url.pathname}`.replace(/\/+$/, '');
    return rejectedDescriptionSourcePatterns.some((pattern) => pattern.test(hostPath));
  } catch {
    return true;
  }
}

const idValue = (value: unknown): string => {
  const directId = serializedDocumentId(value);
  if (directId) return directId;
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return idValue((value as Record<string, unknown>)._id);
  }
  return '';
};

const candidateKeyMatches = (candidate: CandidateDescriptionLab, keys: string[]): boolean => {
  if (keys.length === 0) return true;
  const normalized = new Set(keys.map((key) => key.toLowerCase()));
  return [
    idValue(candidate._id),
    candidate.slug,
    candidate.name,
  ].some((value) => {
    const text = textValue(value).toLowerCase();
    return text && normalized.has(text);
  });
};

function descriptionUrlPriority(value: string): number {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    if (/\/(?:lab|labs|research|center|centers|institute|institutes|program|programs)\b/.test(path)) {
      return 0;
    }
    if (/\/profile\//.test(path)) return 1;
    if (/\/people\//.test(path)) return 2;
  } catch {
    return 9;
  }
  return 3;
}

function descriptionSourceUrlVariants(value: string): string[] {
  const original = textValue(value);
  if (!original) return [];
  try {
    const url = new URL(original);
    if (!/(^|\.)yale\.edu$/i.test(url.hostname)) return [original];
    const match = url.pathname.match(/^\/people\/([^/]+)\/?$/i);
    if (!match) return [original];
    const profileUrl = new URL(url.toString());
    profileUrl.pathname = `/profile/${match[1]}`;
    profileUrl.search = '';
    profileUrl.hash = '';
    return [original, profileUrl.toString()];
  } catch {
    return [original];
  }
}

function expandDescriptionSourceUrls(values: unknown[]): string[] {
  return uniqueStrings(values).flatMap(descriptionSourceUrlVariants);
}

function candidateUrlsForDoc(doc: CandidateDescriptionLabDoc): string[] {
  const primaryUrls = expandDescriptionSourceUrls([doc.websiteUrl, doc.website])
    .filter((url) => !isRejectedDescriptionSourceUrl(url))
    .sort((a, b) => descriptionUrlPriority(a) - descriptionUrlPriority(b) || a.localeCompare(b));
  const primaryNonProfileUrls = primaryUrls.filter((url) => {
    try {
      return !/\/profile\//i.test(new URL(url).pathname);
    } catch {
      return false;
    }
  });
  if (primaryNonProfileUrls.length > 0) {
    const fallbackUrls = expandDescriptionSourceUrls([...primaryUrls, ...(doc.sourceUrls || [])])
      .filter((url) => !isRejectedDescriptionSourceUrl(url))
      .sort((a, b) => descriptionUrlPriority(a) - descriptionUrlPriority(b) || a.localeCompare(b));
    return uniqueStrings([...primaryNonProfileUrls, ...fallbackUrls]);
  }

  return expandDescriptionSourceUrls([...primaryUrls, ...(doc.sourceUrls || [])])
    .filter((url) => !isRejectedDescriptionSourceUrl(url))
    .sort((a, b) => descriptionUrlPriority(a) - descriptionUrlPriority(b) || a.localeCompare(b));
}

export function candidateDescriptionLabsFromDocs(
  docs: CandidateDescriptionLabDoc[],
  options: { only?: string[]; queueOrder?: string[] } = {},
): CandidateDescriptionLab[] {
  const queueRank = new Map((options.queueOrder || []).map((id, index) => [id, index]));
  const keys = uniqueStrings(options.only || []);
  const candidates = docs.flatMap((doc) => {
    const urls = candidateUrlsForDoc(doc);
    if (urls.length === 0) return [];
    const candidate: CandidateDescriptionLab = {
      _id: doc._id,
      slug: doc.slug,
      name: textValue(doc.displayName || doc.name || doc.slug || idValue(doc._id)),
      websiteUrl: urls[0],
      sourceUrls: urls,
      manuallyLockedFields: doc.manuallyLockedFields || [],
    };
    return candidateKeyMatches(candidate, keys) ? [candidate] : [];
  });

  return candidates.sort((a, b) => {
    const rankA = queueRank.get(idValue(a._id)) ?? Number.MAX_SAFE_INTEGER;
    const rankB = queueRank.get(idValue(b._id)) ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB || a.name.localeCompare(b.name);
  });
}

function usefulDescription(value: unknown): string {
  const text = textValue(value);
  if (text.length < 80) return '';
  if (/^(?:n\/a|none|unknown)$/i.test(text)) return '';
  return text;
}

function sentenceCase(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
}

function withTerminalPeriod(value: string): string {
  const text = value.replace(/[.;:,]+$/g, '').trim();
  return text && !/[.!?]$/.test(text) ? `${text}.` : text;
}

function normalizeKnownDescriptionAcronyms(value: string): string {
  return value.replace(/\bCar\s+DS\b/g, 'CarDS').replace(/\bNOu\s+RISH\b/g, 'NOURISH');
}

function firstPersonShortToCardShort(value: string, fullDescription: string): string {
  const rewrites: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [
      /^we\s+study\s+(.+)$/i,
      (match) => `Studies ${match[1]}`,
    ],
    [
      /^we\s+investigate\s+(.+)$/i,
      (match) => `Investigates ${match[1]}`,
    ],
    [
      /^we\s+focus\s+on\s+(.+)$/i,
      (match) => `Focuses on ${match[1]}`,
    ],
    [
      /^our\s+research\s+(?:studies|investigates|examines)\s+(.+)$/i,
      (match) => `Studies ${match[1]}`,
    ],
    [
      /^our\s+research\s+focuses\s+on\s+(.+)$/i,
      (match) => `Focuses on ${match[1]}`,
    ],
  ];

  for (const [pattern, rewrite] of rewrites) {
    const match = value.match(pattern);
    if (!match) continue;
    const candidate = withTerminalPeriod(sentenceCase(rewrite(match)));
    if (shortDescriptionQuality(candidate, fullDescription).isUseful) return candidate;
  }
  return '';
}

function usefulShortDescription(value: unknown, fullDescription: string): string {
  const text = normalizeKnownDescriptionAcronyms(usefulDescription(value));
  if (text && shortDescriptionQuality(text, fullDescription).isUseful) return text;
  const rewritten = text ? firstPersonShortToCardShort(text, fullDescription) : '';
  if (rewritten) return rewritten;
  const derived = deriveShortDescriptionFromFullDescription(fullDescription);
  return shortDescriptionQuality(derived, fullDescription).isUseful ? derived : '';
}

function htmlToText(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, nav, footer').remove();
  return textValue($('body').text() || $.root().text()).slice(0, MAX_PROMPT_CHARS);
}

export function descriptionExtractionToObservations(
  extraction: DescriptionExtraction,
  context: { entityId?: string; entityKey?: string; sourceUrl: string },
): ObservationInput[] {
  if (isRejectedDescriptionSourceUrl(context.sourceUrl)) return [];
  const fullDescription = normalizeKnownDescriptionAcronyms(
    usefulDescription(extraction.fullDescription),
  );
  if (!fullDescription) return [];
  const shortDescription = usefulShortDescription(extraction.shortDescription, fullDescription);

  const base = {
    entityType: 'researchEntity' as const,
    entityId: context.entityId,
    entityKey: context.entityKey,
    sourceUrl: context.sourceUrl,
    confidenceOverride: /\/profile\//i.test(context.sourceUrl) ? 0.55 : 0.82,
  };
  const observations: ObservationInput[] = [
    { ...base, field: 'fullDescription', value: fullDescription },
  ];

  if (shortDescription) {
    observations.push({ ...base, field: 'shortDescription', value: shortDescription });
  }
  const topics = uniqueStrings(extraction.topics || []).slice(0, 12);
  if (topics.length) observations.push({ ...base, field: 'researchAreas', value: topics });
  const methods = uniqueStrings(extraction.methods || []).slice(0, 12);
  if (methods.length) observations.push({ ...base, field: 'methods', value: methods });
  return observations;
}

async function defaultFetchPage(url: string): Promise<FetchedDescriptionPage | null> {
  // SSRF guard: url is a DB-sourced lab websiteUrl — block private/metadata hosts and validate
  // redirect hops at connect time.
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrlText, {
    timeout: 10_000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  return { url: res.request?.res?.responseUrl || safeUrlText, html: String(res.data || '') };
}

async function defaultCallLLM(input: {
  model: string;
  apiKey: string;
  labName: string;
  sourceUrl: string;
  pageText: string;
}): Promise<DescriptionExtraction> {
  const safeLabName = redactDirectContactInfo(input.labName).slice(0, 240);
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
            'Extract conservative source-backed research-home description fields from official Yale lab/profile/center page text. Do not extract access, contact, openings, or application claims.',
        },
        {
          role: 'user',
          content: [
            `Lab: ${safeLabName}`,
            `Source URL: ${safeSourceUrl}`,
            'Return JSON with fullDescription, shortDescription, topics, methods.',
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
      timeout: 30_000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') throw new Error('LLM returned empty content');
  return JSON.parse(content) as DescriptionExtraction;
}

async function defaultLabFinder(options: { only?: string[] } = {}): Promise<CandidateDescriptionLab[]> {
  const only = uniqueStrings(options.only || []);
  const onlyObjectIds = only
    .map((value) => normalizeDescriptionLlmObjectId(value))
    .filter((value): value is string => Boolean(value))
    .map((value) => new mongoose.Types.ObjectId(value));
  const queueItems = only.length
    ? []
    : await VisibilityReleaseQueueItem.find({
        collection: 'research',
        status: 'open',
        repairStage: 'source_description',
        repairStatus: { $in: ['queued', 'blocked', 'attempted'] },
      })
        .sort({ lastSeenAt: -1, _id: 1 })
        .limit(1000)
        .select('recordId')
        .lean();
  const queueOrder = uniqueStrings(queueItems.map((item: any) => item.recordId));
  const identityFilter = only.length
    ? {
        $or: [
          ...(onlyObjectIds.length ? [{ _id: { $in: onlyObjectIds } }] : []),
          { slug: { $in: only } },
          { name: { $in: only } },
          { displayName: { $in: only } },
        ],
      }
    : queueOrder.length
      ? { _id: { $in: queueOrder } }
      : {};
  const urlFilter = {
    $or: [
      { websiteUrl: /^https?:\/\//i },
      { website: /^https?:\/\//i },
      { sourceUrls: /^https?:\/\//i },
    ],
  };
  const docs = await ResearchEntity.find(
    {
      $and: [{ archived: { $ne: true } }, urlFilter, identityFilter],
    },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      manuallyLockedFields: 1,
    },
  ).lean();
  return candidateDescriptionLabsFromDocs(docs as CandidateDescriptionLabDoc[], { only, queueOrder });
}

async function defaultWorkPlanLoader(
  lab: CandidateDescriptionLab,
  policy: WorkPlannerSourcePolicy,
  _ctx: ScraperContext,
): Promise<EntityWorkPlan> {
  return loadEntityWorkPlan({
    entityType: policy.entityType,
    entityId: idValue(lab._id) || undefined,
    entityKey: lab.slug,
    sourceName: policy.sourceName,
    targetFields: policy.targetFields,
    manuallyLockedFields: lab.manuallyLockedFields,
    freshnessWindowMs: policy.freshnessWindowMs,
    now: new Date(),
  });
}

export class LabMicrositeDescriptionLLMExtractor implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'Lab microsite LLM (description only)';

  private readonly fetchPage: FetchDescriptionPageFn;
  private readonly callLLM: CallDescriptionLLMFn;
  private readonly workPlanLoader: DescriptionWorkPlanLoaderFn;
  private readonly labFinder: (options?: { only?: string[] }) => Promise<CandidateDescriptionLab[]>;
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(deps: LabMicrositeDescriptionLLMExtractorDeps = {}) {
    this.fetchPage = deps.fetchPage || defaultFetchPage;
    this.callLLM = deps.callLLM || defaultCallLLM;
    this.workPlanLoader = deps.workPlanLoader || defaultWorkPlanLoader;
    this.labFinder = deps.labFinder || defaultLabFinder;
    this.apiKey = deps.apiKey || process.env.OPENAI_API_KEY;
    this.model = deps.model || DEFAULT_MODEL;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    if (!this.apiKey) {
      ctx.log('OPENAI_API_KEY missing; skipping lab microsite description extraction.');
      return { observationCount: 0, entitiesObserved: 0, notes: 'OPENAI_API_KEY missing' };
    }

    const only = uniqueStrings(ctx.options.only || []);
    const offset = parseRuntimeIntegerOption(ctx.options.offset, '--offset', {
      min: 0,
      label: 'non-negative',
      fallback: 0,
    });
    const limit = parseRuntimeIntegerOption(ctx.options.limit, '--limit', {
      min: 1,
      label: 'positive',
      fallback: 100,
    });
    const candidates = (await this.labFinder({ only }))
      .filter(
        (candidate) =>
          candidateKeyMatches(candidate, only) &&
          candidate.websiteUrl &&
          !isRejectedDescriptionSourceUrl(candidate.websiteUrl),
      )
      .slice(offset, offset + limit);
    let observationCount = 0;
    let entitiesObserved = 0;
    const workPlannerPolicy = ctx.options.ignoreWorkPlanner
      ? undefined
      : getWorkPlannerSourcePolicy(this.name);
    const workPlannerMetrics = createWorkPlannerMetrics();

    for (const lab of candidates) {
      try {
        if (workPlannerPolicy) {
          if (!idValue(lab._id) && !lab.slug) {
            recordWorkPlannerNoIdentifier(workPlannerMetrics);
            ctx.log('[candidate] skipped by WorkPlanner — missing entity identifier.');
            continue;
          }
          const plan = await this.workPlanLoader(lab, workPlannerPolicy, ctx);
          recordWorkPlannerDecision(workPlannerMetrics, plan);
          if (!plan.shouldFetch) {
            const reasons = Array.from(new Set(plan.fields.map((field) => field.reason))).join(',');
            ctx.log(`[${lab.slug || 'candidate'}] skipped by WorkPlanner — ${reasons || 'fresh'}.`);
            continue;
          }
        }
        const urls = uniqueStrings([lab.websiteUrl, ...(lab.sourceUrls || [])]).filter(
          (url) => !isRejectedDescriptionSourceUrl(url),
        );
        let page: FetchedDescriptionPage | null = null;
        let lastFetchError = '';
        for (const sourceUrl of urls) {
          try {
            page = await this.fetchPage(sourceUrl);
          } catch (error) {
            lastFetchError = sanitizeLogValue(error);
            ctx.log(
              `[${lab.slug || 'candidate'}] description extraction source failed: ${lastFetchError}`,
            );
            continue;
          }
          if (page?.html) break;
        }
        if (!page?.html && lastFetchError) {
          ctx.log(
            `[${lab.slug || 'candidate'}] skipping description extraction: ${lastFetchError}`,
          );
        }
        if (!page?.html) continue;

        // Fast, faithful path: many Yale pages (medicine.yale.edu /lab and
        // /profile, etc.) are JS-rendered, so the visible-text LLM path sees an
        // empty shell — but the verbatim official description sits in an embedded
        // script-tag JSON payload that extractLabHomepageDescription() parses.
        // Use it before the LLM: cheaper, and it recovers descriptions the
        // plain-text path misses.
        let embeddedHostname = '';
        try {
          embeddedHostname = new URL(page.url).hostname;
        } catch {
          embeddedHostname = '';
        }
        if (/(^|\.)yale\.edu$/i.test(embeddedHostname)) {
          const embedded = extractLabHomepageDescription(page.html);
          if (embedded?.description) {
            const embeddedObservations = descriptionExtractionToObservations(
              {
                fullDescription: embedded.description,
                shortDescription: embedded.shortDescription || '',
                topics: [],
                methods: [],
              },
              {
                entityId: serializedDocumentId(lab._id),
                entityKey: lab.slug,
                sourceUrl: page.url,
              },
            );
            if (embeddedObservations.length) {
              await ctx.emit(embeddedObservations);
              observationCount += embeddedObservations.length;
              entitiesObserved += 1;
              continue;
            }
          }
        }

        const pageText = htmlToText(page.html);
        if (pageText.length < 120) continue;

        const extraction = await this.callLLM({
          model: this.model,
          apiKey: this.apiKey,
          labName: lab.name,
          sourceUrl: page.url,
          pageText,
        });
        const observations = descriptionExtractionToObservations(extraction, {
          entityId: serializedDocumentId(lab._id),
          entityKey: lab.slug,
          sourceUrl: page.url,
        });
        if (!observations.length) continue;

        await ctx.emit(observations);
        observationCount += observations.length;
        entitiesObserved += 1;
      } catch (error) {
        const message = sanitizeLogValue(error);
        ctx.log(
          `[${lab.slug || 'candidate'}] skipping description extraction: ${message}`,
        );
      }
    }

    return {
      observationCount,
      entitiesObserved,
      notes: `Extracted source-backed descriptions for ${entitiesObserved} research entities.`,
      metrics: { workPlanner: workPlannerMetrics },
    };
  }
}
