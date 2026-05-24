/**
 * LabMicrositeDescriptionLLMExtractor
 *
 * Official lab microsites are often the best source for "what this lab
 * studies", but that evidence should stay separate from undergraduate-access
 * extraction. This scraper targets active ResearchEntity rows with usable
 * websites and missing/weak description fields, then asks an LLM for
 * description-only structured output.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ResearchEntity } from '../../models/researchEntity';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import {
  assessResearchEntityDescriptionQuality,
  deriveShortDescriptionFromFullDescription,
} from '../../utils/researchEntityDescriptionQuality';
import {
  isAcademicAppointmentDescription,
  isBrokenResearchEntityDescriptionFragment,
  isResearchAreaPlaceholderDescription,
  isResearchEntitySourceChromeText,
  isSyntheticResearchHomeMetadataDescription,
} from '../../utils/researchEntityDescriptionText';
import { isUsableResearchWebsiteUrl } from '../../utils/researchWebsiteUrl';
import {
  createScraplingRenderedFetcher,
  measureRenderedFetch,
  summarizeFetchMetrics,
  type RenderedFetcher,
  type RenderedFetchResult,
} from '../renderedFetch';
import { getCached, setCached } from '../snapshotCache';
import type {
  DescriptionReviewSample,
  IScraper,
  ObservationInput,
  ScraperContext,
  ScraperFetchMetric,
  ScraperResult,
} from '../types';
import {
  createWorkPlannerMetrics,
  getWorkPlannerSourcePolicy,
  loadEntityWorkPlan,
  recordWorkPlannerDecision,
  recordWorkPlannerNoIdentifier,
  type EntityWorkPlan,
  type WorkPlannerSourcePolicy,
} from '../workPlanner';
import {
  defaultFetchPage,
  htmlToPromptText,
  type FetchedPage,
  type FetchPageFn,
  type PromptSourcePage,
} from './labMicrositeUndergradLLMExtractor';

export type { FetchedPage } from './labMicrositeUndergradLLMExtractor';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PROMPT_CHARS = 50_000;
const DEFAULT_LIMIT = 100;
const DEFAULT_MODEL = 'gpt-4o-mini';
const SOURCE_KEY = 'lab-microsite-description-llm';
const DESCRIPTION_CONFIDENCE_OVERRIDE = 0.55;
const MAX_CANDIDATE_SUBPAGE_URLS = 8;
const MAX_SUBPAGES_FETCHED = 3;
const EVIDENCE_QUOTE_MAX_CHARS = 240;
const RESEARCH_AREA_MAX_CHARS = 80;
const MAX_RESEARCH_AREAS = 8;
const MAX_DESCRIPTION_REVIEW_SAMPLES = 50;

const DESCRIPTION_FIELDS = ['fullDescription', 'shortDescription'] as const;
type DescriptionField = (typeof DESCRIPTION_FIELDS)[number];

const DESCRIPTION_SUBPAGE_PATH_HINTS = [
  '/research',
  '/projects',
  '/science',
  '/work',
  '/about',
  '/publications',
  '/research-projects',
  '/what-we-do',
];

const DESCRIPTION_SUBPAGE_ANCHOR_RE =
  /\b(research|projects?|science|publications?|about|our\s+work|what\s+we\s+do|focus|areas?)\b/i;

const DESCRIPTION_SUBPAGE_PATH_EXCLUDE_RE =
  /(?:^|\/)(?:interdisciplinary-research)(?:\/|$)/i;

const GENERIC_DESCRIPTION_RE =
  /^(research\s+areas?\s*(include|:)|research\s+area:|studies\s+[^.]{1,40}\.|research\s+interests?\s*(include|:))/i;

const SOURCE_CHROME_PATTERNS = [
  /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i,
  /\bORCID\s*\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i,
  /View (Lab Website|Related Publication)/i,
  /View (Full Profile|\d+\s+(Common|Related)\s+Publications?)/i,
  /(Common|Related)\s+Publications?/i,
  /^Publications$/i,
  /Publications\s*Timeline/i,
  /Yale Co-Authors/i,
  /YSM Researchers/i,
  /YSM Researcher/i,
  /Streamline Icon/i,
  /Director of Department Cores/i,
  /Course Director/i,
  /\bCitations\b/i,
  /\bNews\s+People\s+Projects\s+Publications\s+Opportunities\s+Contact\b/i,
];

function looksLikeSourceChrome(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (isResearchEntitySourceChromeText(normalized)) return true;
  if (SOURCE_CHROME_PATTERNS.some((pattern) => pattern.test(normalized))) return true;

  const phraseCounts = new Map<string, number>();
  const phrasePattern =
    /\b(?:Director of Department Cores|Therapeutic Radiology|Radiobiology Course Director|View Lab Website|View Related Publication|View Full Profile|Common Publications|Related Publications|YSM Researcher|YSM Researchers)\b/gi;
  for (const match of normalized.matchAll(phrasePattern)) {
    const phrase = match[0].toLowerCase();
    phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
  }
  return Array.from(phraseCounts.values()).some((count) => count >= 2);
}

export interface DescriptionLLMExtraction {
  fullDescription: string;
  shortDescription: string;
  researchAreas: string[];
  evidenceQuote: string;
}

export interface DescriptionCandidateEntity {
  _id?: any;
  slug: string;
  name: string;
  websiteUrl: string;
  sourceUrls?: string[];
  archived?: boolean;
  manuallyLockedFields?: string[];
  description?: string;
  fullDescription?: string;
  shortDescription?: string;
  researchAreas?: string[];
}

export interface SelectDescriptionTargetsOptions {
  only?: string[];
  limit?: number;
  offset?: number;
}

export const LAB_DESCRIPTION_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'lab_description_extraction',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        fullDescription: { type: 'string' },
        shortDescription: { type: 'string' },
        researchAreas: {
          type: 'array',
          items: { type: 'string' },
          maxItems: MAX_RESEARCH_AREAS,
        },
        evidenceQuote: { type: 'string' },
      },
      required: [
        'fullDescription',
        'shortDescription',
        'researchAreas',
        'evidenceQuote',
      ],
    },
    strict: true,
  },
};

const SYSTEM_PROMPT = `You write concise, source-backed descriptions of Yale research labs for undergraduate research discovery.

Return only what the lab studies: research questions, subject matter, methods, and fit. Use student-facing prose that is concrete and specific.

Rules:
- fullDescription is the source of truth. It must be a useful 2-5 sentences research explanation supported by the provided official lab website text.
- Do not write a fullDescription from the lab name, departments, topics, or current description metadata. Use only research-content evidence from the official page text.
- shortDescription must be derived from fullDescription, not independently from metadata. It should be a concise 1-2 sentence browsing summary that preserves concrete research context.
- Return empty strings and an empty researchAreas array if the pages do not contain enough research-content evidence.
- Return empty strings and an empty researchAreas array if the page text is only navigation, addresses, profile/member listings, publications widgets, recruitment copy, news blurbs, titles, or appointment biography.
- Do not infer openings, availability, hiring, eligibility, applications, mentorship, or undergraduate access.
- You must not create entry pathways, access signals, contact routes, posted opportunities, application instructions, or join routes.
- Do not mention undergraduate availability unless the source text is explicitly about the lab's research focus and the word is needed to describe the research itself.
- researchAreas must be conservative topic/method labels directly supported by the source.
- evidenceQuote must be a verbatim quote, at most 240 characters, supporting fullDescription.

Do not paraphrase quotes. Do not include direct contact details.`;

function cleanTextValue(value: unknown, maxChars?: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = redactDirectContactInfo(value).replace(/\s+/g, ' ').trim();
  if (maxChars === undefined) return cleaned;
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const normalizeEvidenceText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().toLowerCase();

const normalizeEvidenceLooseText = (value: string): string =>
  value
    .replace(/Copy\s*Link/gi, ' Copy Link ')
    .replace(/Read\s*More/gi, ' Read More ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-z])(?=health\s+effects\b)/gi, '$1 ')
    .replace(/([a-z])(?=future\s+climate\b)/gi, '$1 ')
    .replace(/\b(?:copy\s+link|read\s+more)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function sourceSupportsEvidenceQuote(evidenceQuote: string, sourceText?: string): boolean {
  if (sourceText === undefined) return true;
  const quote = normalizeEvidenceText(evidenceQuote).replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  const source = normalizeEvidenceText(sourceText);
  if (!quote || !source) return false;
  if (quote.length < 20 || quote.split(/\s+/).filter(Boolean).length < 4) return false;
  if (source.includes(quote)) return true;

  const looseQuote = normalizeEvidenceLooseText(quote);
  const looseSource = normalizeEvidenceLooseText(source);
  if (looseSource.includes(looseQuote)) return true;
  if (/^perspectives?\b/i.test(quote)) {
    const topicTokens = looseQuote
      .replace(/^perspectives?\s+/, '')
      .split(/\s+/)
      .filter((token) => token.length >= 6);
    if (topicTokens.length >= 3 && topicTokens.every((token) => looseSource.includes(token))) {
      return true;
    }
  }
  const depersonalizedQuote = looseQuote.replace(/^(?:his|her|their)\s+/, '');
  if (
    depersonalizedQuote !== looseQuote &&
    depersonalizedQuote.split(/\s+/).length >= 4 &&
    looseSource.includes(depersonalizedQuote)
  ) {
    return true;
  }

  const ellipsisSegments = quote
    .split(/\.{3,}|…/g)
    .map((segment) => normalizeEvidenceLooseText(segment))
    .filter((segment) => segment.split(/\s+/).length >= 4);
  if (ellipsisSegments.length >= 2) {
    let cursor = 0;
    let matched = 0;
    for (const segment of ellipsisSegments) {
      const index = looseSource.indexOf(segment, cursor);
      if (index < 0) break;
      cursor = index + segment.length;
      matched += 1;
    }
    if (matched === ellipsisSegments.length) return true;
  }

  const quoteWords = looseQuote.split(/\s+/).filter(Boolean);
  if (quoteWords.length < 10) return false;
  const prefix = quoteWords.slice(0, Math.max(10, Math.floor(quoteWords.length * 0.8))).join(' ');
  return Boolean(prefix && looseSource.includes(prefix));
}

function sourceSupportsLabIdentity(fullDescription: string, sourceText?: string): boolean {
  if (sourceText === undefined) return true;
  const description = normalizeEvidenceText(fullDescription);
  if (!/\blab(?:oratory)?\b/.test(description)) return true;

  const source = normalizeEvidenceText(sourceText);
  const describedLabPhrases = Array.from(
    description.matchAll(
      /\b(?:the\s+)?([a-z][a-z0-9&.'-]*(?:\s+[a-z][a-z0-9&.'-]*){0,5}\s+lab)\b/g,
    ),
  )
    .map((match) => match[1].replace(/^the\s+/, '').trim())
    .filter((phrase) => phrase.split(/\s+/).length >= 2);
  if (describedLabPhrases.some((phrase) => source.includes(phrase))) return true;
  if (/\b(?:our|the|this)\s+lab\b/.test(source)) return true;
  if (/\blab\s+(?:studies|investigates|focuses|uses|provides|members?|environment|website)\b/.test(source)) {
    return true;
  }
  if (/\blaborator(?:y|ies)\b/.test(source)) return true;
  if (/\bresearch\s+(group|team|program|center|centre)\b/.test(source)) return true;
  return false;
}

function entityDescriptionLooksMismatched(
  entity: Pick<DescriptionCandidateEntity, 'name'>,
  fullDescription: string,
): boolean {
  const name = cleanTextValue(entity.name);
  if (!/[—-]\s*Research\b/i.test(name)) return false;
  const personName = name.replace(/[—-]\s*Research\b.*$/i, '').trim();
  const surname = personName.split(/\s+/).filter(Boolean).at(-1)?.toLowerCase() || '';
  const description = normalizeEvidenceText(fullDescription);
  if (surname && description.includes(surname)) return false;
  const firstSentence = sentencesFromText(fullDescription, 1);
  return /\b(?:core|facility|center|centre|institute)\b/i.test(firstSentence);
}

function isIdentityOnlyEvidenceQuote(value: string): boolean {
  const normalized = normalizeEvidenceText(value);
  return (
    /\b(?:lab|laboratory|center|centre|program|initiative)\s+is\s+(?:an?\s+)?(?:scientific\s+)?research\s+(?:group|center|centre|program|initiative|home)\b/i.test(
      normalized,
    ) &&
    !/\b(studies|investigates|examines|explores|focuses on|works on|develops|uses|employs|researches|analyzes|models|measures)\b/i.test(
      normalized,
    )
  );
}

function evidenceQuoteSupportsDescription(evidenceQuote: string): boolean {
  const quote = cleanTextValue(evidenceQuote, EVIDENCE_QUOTE_MAX_CHARS);
  if (!quote) return false;
  return !isIdentityOnlyEvidenceQuote(quote);
}

function dedupeRepeatedSentences(value: string): string {
  const sentences = value.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((sentence) => sentence.trim()) || [];
  if (sentences.length <= 1) return value;
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const sentence of sentences) {
    const key = sentence.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (key && seen.has(key)) continue;
    seen.add(key);
    unique.push(sentence);
  }
  return unique.join(' ').trim();
}

function normalizeSourceVoiceDescription(value: string): string {
  return cleanTextValue(value)
    .replace(
      /\b(?:Selected Awards\s*&\s*Honors|Selected Publications|Publications|Patents|Accessibility\s*>|Privacy Policy\s>)[\s\S]*$/i,
      '',
    )
    .replace(/\brefered\b/gi, 'referred')
    .replace(/\.\s*,\s+via\s+[^.!?)]*\)\.?/gi, '.')
    .replace(/\.(?=I am especially interested\b)/g, '. ')
    .replace(/\b(?:My\s+)?CV\s+is\s+available\s+here\.?/gi, '')
    .replace(/\s+\b(?:e\.)?g\.\s*$/i, '')
    .replace(/^INFORMATION FOR\s+(?:Research Focus|Areas of Focus)\s+/i, '')
    .replace(/^[\s\S]{0,260}\bOur lab studies\b/i, 'Studies')
    .replace(/^Our lab studies\b/i, 'Studies')
    .replace(/^My lab studies\b/i, 'Studies')
    .replace(
      /^(?!The\b|Our\b|My\b|Dr\.?\b|Prof(?:essor)?\.?\b|Currently\b|Also\b|More\b)(?!(?:[\p{L}.'’-]+\s+){0,5}(?:Lab|Laboratory)\s+studies\b)[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+studies\b/iu,
      'Studies',
    )
    .replace(/^Our lab focuses on\b/i, 'Focuses on')
    .replace(/^My lab focuses on\b/i, 'Focuses on')
    .replace(/^Our lab uses\b/i, 'Uses')
    .replace(/^My lab uses\b/i, 'Uses')
    .replace(/^We study\b/i, 'Studies')
    .replace(/^Studies this question in the model plant Arabidopsis\b/i, 'Studies biological timing in the model plant Arabidopsis')
    .replace(/^Our lab investigates\b/i, 'Investigates')
    .replace(/^My lab investigates\b/i, 'Investigates')
    .replace(/^We investigate\b/i, 'Investigates')
    .replace(/^We combine\b/i, 'Combines')
    .replace(/^We apply\b/i, 'Applies')
    .replace(/^We develop\b/i, 'Develops')
    .replace(/^We are now building\b/i, 'Is building')
    .replace(/^We are interested in understanding\b/i, 'Studies')
    .replace(/^We are interested in\b/i, 'Studies')
    .replace(/^Our group uses\b/i, 'Uses')
    .replace(/^Our group develops\b/i, 'Develops')
    .replace(/^Our group focuses on\b/i, 'Focuses on')
    .replace(/^Our group works on\b/i, 'Works on')
    .replace(/^Our group is interested in\b/i, 'Studies')
    .replace(/^I study\b/i, 'Studies')
    .replace(/^I do research in\b/i, 'Research focuses on')
    .replace(/^I work on\b/i, 'Research focuses on')
    .replace(/^I currently work on\b/i, 'Research focuses on')
    .replace(/^I am a macroeconomist and economic theorist interested in\s+(.+?)\.?$/i, 'Research focuses on macroeconomics, economic theory, $1.')
    .replace(/^I actively engage in the study of\b/i, 'Studies')
    .replace(/^I investigate\b/i, 'Investigates')
    .replace(/^I am interested in developing\b/i, 'Develops')
    .replace(/^I am interested in\b/i, 'Research focuses on')
    .replace(/^My research interests span\b/i, 'Research spans')
    .replace(/^My research interests include\b/i, 'Research interests include')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+interests\s+include\b/iu, 'Research interests include')
    .replace(/^I am also interested in\b/i, 'Research also includes')
    .replace(/^I am especially interested in\b/i, 'Research interests include')
    .replace(/^My research topics include\b/i, 'Research topics include')
    .replace(/^Our research focuses\b/i, 'Research focuses')
    .replace(/^Our research aims to\b/i, 'Research aims to')
    .replace(/^Our goal is to help dispel the scientific fog that shrouds\s+(.+?)(?:\s+over\s+the\s+decades\s+to\s+come)?\.?$/i, (_match, focus) => {
      const normalizedFocus = cleanTextValue(focus)
        .replace(/\bthe\s+climate\s+change\s+impact\b/i, 'climate change impacts')
        .replace(/[.!?]+$/g, '')
        .trim();
      return normalizedFocus ? `Research examines ${normalizedFocus}.` : '';
    })
    .replace(/^My research focuses\b/i, 'Research focuses')
    .replace(/^His research focuses on\b/i, 'Research focuses on')
    .replace(/^Her research focuses on\b/i, 'Research focuses on')
    .replace(/^Their research focuses on\b/i, 'Research focuses on')
    .replace(/^His research examines\b/i, 'Research focuses on')
    .replace(/^Her research examines\b/i, 'Research focuses on')
    .replace(/^Their research examines\b/i, 'Research focuses on')
    .replace(/^My research is in\b/i, 'Research focuses on')
    .replace(/^In my research, I am currently studying\b/i, 'Currently studies')
    .replace(/^His research has focused on\b/i, 'Research focuses on')
    .replace(/^Her research has focused on\b/i, 'Research focuses on')
    .replace(/^Their research has focused on\b/i, 'Research focuses on')
    .replace(/^His current research has focused on\b/i, 'Research focuses on')
    .replace(/^Her current research has focused on\b/i, 'Research focuses on')
    .replace(/^Their current research has focused on\b/i, 'Research focuses on')
    .replace(/^His current research focuses on\b/i, 'Research focuses on')
    .replace(/^Her current research focuses on\b/i, 'Research focuses on')
    .replace(/^Their current research focuses on\b/i, 'Research focuses on')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+main\s+research\s+is\s+in\b/iu, 'Research focuses on')
    .replace(/^Professor\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+primary\s+research\s+fields\s+are\b/iu, 'Research focuses on')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+specializes\s+in\b/iu, 'Research focuses on')
    .replace(/^Dr\.?\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+currently\s+focuses\s+on\b/iu, 'Research focuses on')
    .replace(/^(?:His|Her|Their)\s+research\s+interests\s+lie\s+at\s+the\s+intersection\s+of\b/i, 'Research focuses on the intersection of')
    .replace(/^(?:His|Her|Their)\s+research\s+interests\s+lie\s+in\b/i, 'Research focuses on')
    .replace(/^Professor\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+lies\s+at\s+the\s+intersection\s+between\b/iu, 'Research focuses on the intersection between')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+lies\s+at\s+the\s+intersection\s+between\b/iu, 'Research focuses on the intersection between')
    .replace(/^His current work analyzes\b/i, 'Current work analyzes')
    .replace(/^Her current work analyzes\b/i, 'Current work analyzes')
    .replace(/^Their current work analyzes\b/i, 'Current work analyzes')
    .replace(/^In\s+addition\s+to\s+(.+?),\s+(?:he|she)\s+has\s+written\s+on\s+(.+)$/i, 'Research focuses on $1, $2')
    .replace(/([.!?])\s+His\s+most\s+notable\s+contributions\s+include\b/g, '$1 Notable contributions include')
    .replace(/([.!?])\s+Her\s+most\s+notable\s+contributions\s+include\b/g, '$1 Notable contributions include')
    .replace(/([.!?])\s+Their\s+most\s+notable\s+contributions\s+include\b/g, '$1 Notable contributions include')
    .replace(/^(?:His|Her|Their)\s+research\s+and\s+teaching\s+specialize\s+in\b/i, 'Research focuses on')
    .replace(/^(?:His|Her|Their)\s+recent\s+works?\s+centers?\s+around\b/i, 'Recent work centers on')
    .replace(/^Professor\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+fields\s+include\b/iu, 'Research focuses on')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+is\s+a\s+macroeconomist\s+whose\s+research\s+focuses\s+on\b/iu, 'Research focuses on')
    .replace(/^Professor\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+is\s+a\s+health\s+economist\s+whose\s+work\s+is\s+focused\s+on\b/iu, 'Research focuses on')
    .replace(/^(?:He|She|They)\s+is\s+a\s+health\s+economist\s+whose\s+research\s+focuses\s+on\b/i, 'Research focuses on')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+is\s+a\s+health\s+economist\s+whose\s+research\s+focuses\s+on\b/iu, 'Research focuses on')
    .replace(/^I\s+am\s+a\s+labor\s+economist\s+who\s+studies\b/i, 'Studies')
    .replace(/^(?:He|She|They)\s+works?\s+in\s+the\s+fields?\s+of\b/i, 'Research focuses on')
    .replace(/^My research provides\b/i, 'Research provides')
    .replace(/^The first stream combines\b/i, 'Combines')
    .replace(/^(?:His|Her|Their)\s+interests\s+include\b/i, 'Research interests include')
    .replace(/^(?:He|She|They)\s+is\s+interested\s+in\s+issues\s+related\s+to\b/i, 'Studies issues related to')
    .replace(/([.!?])\s+(?:His|Her|Their)\s+interests\s+include\b/g, '$1 Research interests include')
    .replace(/([.!?])\s+(?:He|She|They)\s+is\s+interested\s+in\s+issues\s+related\s+to\b/g, '$1 Studies issues related to')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+is\s+a\s+labor\s+economist\s+working\s+on\s+topics\s+related\s+to\b/iu, 'Research focuses on labor economics, with topics related to')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+is\s+an?\s+applied\s+microeconomist\s+whose\s+research\s+is\s+motivated\s+by\s+policy-relevant\s+questions\s+in\b/iu, 'Research focuses on applied microeconomics, with policy-relevant questions in')
    .replace(/^Prof(?:essor)?\.?\s+[\p{L}.-]+(?:\s+[\p{L}.-]+){0,4}['’]s\s+interests\s+include\b/iu, 'Research focuses on')
    .replace(/^Prof(?:essor)?\.?\s+[\p{L}.-]+(?:\s+[\p{L}.-]+){0,4}['’]s\s+recent\s+works?\s+centers?\s+around\b/iu, 'Recent work centers on')
    .replace(/^His focus is on\b/i, 'Focuses on')
    .replace(/^Her focus is on\b/i, 'Focuses on')
    .replace(/^Their focus is on\b/i, 'Focuses on')
    .replace(/^Professor\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+examines\b/iu, 'Research examines')
    .replace(/^Professor\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+focuses\s+on\b/iu, 'Research focuses on')
    .replace(/^Dr\.?\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+focuses\s+on\b/iu, 'Research focuses on')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+examines\b/iu, 'Research examines')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+focuses\s+on\b/iu, 'Research focuses on')
    .replace(/^His core research is focused on\b/i, 'Research focuses on')
    .replace(/^Her core research is focused on\b/i, 'Research focuses on')
    .replace(/^Their core research is focused on\b/i, 'Research focuses on')
    .replace(/^His main interest is in\b/i, 'Research interests include')
    .replace(/^Her main interest is in\b/i, 'Research interests include')
    .replace(/([.!?])\s+We use\b/g, '$1 Uses')
    .replace(/([.!?])\s+We employ\b/g, '$1 Employs')
    .replace(/([.!?])\s+We apply\b/g, '$1 Applies')
    .replace(/([.!?])\s+We combine\b/g, '$1 Combines')
    .replace(/([.!?])\s+We study\b/g, '$1 Studies')
    .replace(/\bStudies this question in the model plant Arabidopsis\b/g, 'Studies biological timing in the model plant Arabidopsis')
    .replace(/([.!?])\s+We develop\b/g, '$1 Develops')
    .replace(/([.!?])\s+We address questions like these with research focused on\b/g, '$1 Research focuses on')
    .replace(/,\s+we understand that\s+/gi, ', ')
    .replace(/([.!?])\s+Through the development of ([^,]+),\s+we can\s+dissect\b/gi, '$1 Uses $2 to dissect')
    .replace(/([.!?])\s+Our aim is to\b/g, '$1 Aims to')
    .replace(/([.!?])\s+We are now building\b/g, '$1 Is building')
    .replace(/([.!?])\s+We are interested in understanding\b/g, '$1 Studies')
    .replace(/([.!?])\s+We are interested in\b/g, '$1 Studies')
    .replace(/([.!?])\s+I study\b/g, '$1 Studies')
    .replace(/([.!?])\s+I do research in\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+I work on\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+I currently work on\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+I am a macroeconomist and economic theorist interested in\s+(.+?)([.!?]|$)/g, '$1 Research focuses on macroeconomics, economic theory, $2$3')
    .replace(/([.!?])\s+I actively engage in the study of\b/g, '$1 Studies')
    .replace(/([.!?])\s+I investigate\b/g, '$1 Investigates')
    .replace(/([.!?])\s+I am interested in developing\b/g, '$1 Develops')
    .replace(/([.!?])\s+I am interested in\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+My research interests span\b/g, '$1 Research spans')
    .replace(/([.!?])\s+My research interests include\b/g, '$1 Research interests include')
    .replace(/([.!?])\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+interests\s+include\b/giu, '$1 Research interests include')
    .replace(/([.!?])\s+I am also interested in\b/g, '$1 Research also includes')
    .replace(/([.!?])\s+I am especially interested in\b/g, '$1 Research interests include')
    .replace(/([.!?])\s+My research topics include\b/g, '$1 Research topics include')
    .replace(/([.!?])\s+My research focuses\b/g, '$1 Research focuses')
    .replace(/([.!?])\s+(?:His|Her|Their) research focuses on\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+(?:His|Her|Their) research examines\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+In my research, I am currently studying\b/g, '$1 Currently studies')
    .replace(/([.!?])\s+Our work uses\b/g, '$1 Uses')
    .replace(/([.!?])\s+Our research uses\b/g, '$1 Uses')
    .replace(/([.!?])\s+Our lab uses\b/g, '$1 Uses')
    .replace(/([.!?])\s+My lab uses\b/g, '$1 Uses')
    .replace(/([.!?])\s+Our research aims to\b/g, '$1 Research aims to')
    .replace(/([.!?])\s+Our goal is to help dispel the scientific fog that shrouds\s+(.+?)(?:\s+over\s+the\s+decades\s+to\s+come)?\./gi, (_match, boundary, focus) => {
      const normalizedFocus = cleanTextValue(focus)
        .replace(/\bthe\s+climate\s+change\s+impact\b/i, 'climate change impacts')
        .replace(/[.!?]+$/g, '')
        .trim();
      return normalizedFocus ? `${boundary} Research examines ${normalizedFocus}.` : boundary;
    })
    .replace(/([.!?])\s+Our group works on\b/g, '$1 Works on')
    .replace(/([.!?])\s+(?:His|Her|Their) research has focused on\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+(?:His|Her|Their) current research has focused on\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+(?:His|Her|Their) current research focuses on\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+main\s+research\s+is\s+in\b/giu, '$1 Research focuses on')
    .replace(/([.!?])\s+Dr\.?\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+currently\s+focuses\s+on\b/giu, '$1 Research focuses on')
    .replace(/([.!?])\s+(?:His|Her|Their)\s+research\s+interests\s+lie\s+at\s+the\s+intersection\s+of\b/g, '$1 Research focuses on the intersection of')
    .replace(/([.!?])\s+(?:His|Her|Their)\s+research\s+interests\s+lie\s+in\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+Professor\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+lies\s+at\s+the\s+intersection\s+between\b/giu, '$1 Research focuses on the intersection between')
    .replace(/([.!?])\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+lies\s+at\s+the\s+intersection\s+between\b/giu, '$1 Research focuses on the intersection between')
    .replace(/([.!?])\s+(?:His|Her|Their) current work analyzes\b/g, '$1 Current work analyzes')
    .replace(/([.!?])\s+In\s+addition\s+to\s+(.+?),\s+(?:he|she)\s+has\s+written\s+on\s+(.+)/gi, '$1 Research focuses on $2, $3')
    .replace(/([.!?])\s+(?:He|She|They)\s+works?\s+in\s+the\s+fields?\s+of\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+(?:His|Her|Their)\s+research\s+and\s+teaching\s+specialize\s+in\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+(?:His|Her|Their)\s+recent\s+works?\s+centers?\s+around\b/g, '$1 Recent work centers on')
    .replace(/([.!?])\s+Professor\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+fields\s+include\b/giu, '$1 Research focuses on')
    .replace(/([.!?])\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+is\s+a\s+macroeconomist\s+whose\s+research\s+focuses\s+on\b/giu, '$1 Research focuses on')
    .replace(/([.!?])\s+Professor\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+is\s+a\s+health\s+economist\s+whose\s+work\s+is\s+focused\s+on\b/giu, '$1 Research focuses on')
    .replace(/([.!?])\s+(?:He|She|They)\s+is\s+a\s+health\s+economist\s+whose\s+research\s+focuses\s+on\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+is\s+a\s+health\s+economist\s+whose\s+research\s+focuses\s+on\b/giu, '$1 Research focuses on')
    .replace(/([.!?])\s+I\s+am\s+a\s+labor\s+economist\s+who\s+studies\b/gi, '$1 Studies')
    .replace(/([.!?])\s+My research provides\b/g, '$1 Research provides')
    .replace(/([.!?])\s+The first stream combines\b/g, '$1 Combines')
    .replace(/([.!?])\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+is\s+a\s+labor\s+economist\s+working\s+on\s+topics\s+related\s+to\b/giu, '$1 Research focuses on labor economics, with topics related to')
    .replace(/([.!?])\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+is\s+an?\s+applied\s+microeconomist\s+whose\s+research\s+is\s+motivated\s+by\s+policy-relevant\s+questions\s+in\b/giu, '$1 Research focuses on applied microeconomics, with policy-relevant questions in')
    .replace(/([.!?])\s+Prof(?:essor)?\.?\s+[\p{L}.-]+(?:\s+[\p{L}.-]+){0,4}['’]s\s+interests\s+include\b/giu, '$1 Research focuses on')
    .replace(/([.!?])\s+Prof(?:essor)?\.?\s+[\p{L}.-]+(?:\s+[\p{L}.-]+){0,4}['’]s\s+recent\s+works?\s+centers?\s+around\b/giu, '$1 Recent work centers on')
    .replace(/([.!?])\s+(?:His|Her|Their) focus is on\b/g, '$1 Focuses on')
    .replace(/([.!?])\s+Professor\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+examines\b/giu, '$1 Research examines')
    .replace(/([.!?])\s+Professor\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+focuses\s+on\b/giu, '$1 Research focuses on')
    .replace(/([.!?])\s+Dr\.?\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+focuses\s+on\b/giu, '$1 Research focuses on')
    .replace(/([.!?])\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+examines\b/giu, '$1 Research examines')
    .replace(/([.!?])\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+focuses\s+on\b/giu, '$1 Research focuses on')
    .replace(/([.!?])\s+(?:His|Her|Their) core research is focused on\b/g, '$1 Research focuses on')
    .replace(/([.!?])\s+(?:His|Her|Their) work spans\b/g, '$1 Work spans')
    .replace(/([.!?])\s+(?:He|She|They) studies\b/g, '$1 Studies')
    .replace(
      /(?<!\bDr)([.!?])\s+(?!The\b|Our\b|My\b|Dr\.?\b|Prof(?:essor)?\.?\b|Currently\b|Also\b|More\b)(?!(?:[\p{L}.'’-]+\s+){0,5}(?:Lab|Laboratory)\s+studies\b)[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+studies\b/giu,
      '$1 Studies',
    )
    .replace(/\bmy work\b/gi, 'this work')
    .replace(/\bMuch of my research\b/gi, 'Much of this research')
    .replace(/,\s+I have also worked on\b/gi, '. Research also examines')
    .replace(/([.!?])\s+We also work on\b/g, '$1 Also studies')
    .replace(/([.!?])\s+We have also solved\b/g, '$1 Has also solved')
    .replace(/([.!?])\s+We are also involved in hunting for\b/g, '$1 Also hunts for')
    .replace(/([.!?])\s+Most of our work uses\b/g, '$1 Most work uses');
}

function evidenceQuoteCanSeedDescription(value: string): boolean {
  const quote = cleanTextValue(value);
  if (!quote || quote.length < 60) return false;
  if (isIdentityOnlyEvidenceQuote(quote)) return false;
  const profileResearchSelfDescription =
    /^I\s+am\s+a\s+(?:labor economist who studies|macroeconomist and economic theorist interested in)\b/i.test(
      quote,
    );
  if (
    looksLikeSourceChrome(quote) ||
    (isAcademicAppointmentDescription(quote) && !profileResearchSelfDescription)
  ) return false;
  return /\b(research|stud(?:y|ies)|investigat(?:e|es|ing)|focus(?:es|ed)?|develop(?:s|ing)?|models?|analy(?:z|s)es|measures?|uses?|employs?|seeks?|examines?|explores?|dissects?|elucidates?|synthesis|work(?:s|ing)?\s+on|works?\s+in\s+the\s+fields?|written\s+on|working\s+on\s+topics|main\s+research\s+is\s+in|interested\s+in|interests\s+include|labor economist|macroeconomist|combustion|electrospray|optimization|signal processing|system theory|soft matter|glass|jamming|biomechanics|materials?|cellular behavior|bioactive domains)\b/i.test(
    quote,
  );
}

function descriptionFromEvidenceQuote(evidenceQuote: string): string {
  if (!evidenceQuoteCanSeedDescription(evidenceQuote)) return '';
  const quote = normalizeSourceVoiceDescription(
    cleanTextValue(evidenceQuote).replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''),
  )
    .replace(/:\s*$/g, '.')
    .replace(/^Through the development of ([^,]+),\s+we can\s+(.+)$/i, 'Uses $1 to $2')
    .replace(/\bthat can be attributed to\b/gi, 'in')
    .replace(/\s+(?:and|or|of|in|with|for|to|the)$/i, '')
    .trim();
  if (!quote) return '';
  return /[.!?]$/.test(quote) ? quote : `${quote}.`;
}

function expandEvidenceQuoteWithFollowingResearchSentence(
  evidenceQuote: string,
  sourceText?: string,
): string {
  const rawQuote = cleanTextValue(evidenceQuote);
  const quote = cleanTextValue(evidenceQuote, EVIDENCE_QUOTE_MAX_CHARS);
  const source = cleanTextValue(sourceText);
  if (!rawQuote || !source) return quote;

  const sentences =
    source.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((sentence) => sentence.trim()) ||
    [];
  if (sentences.length < 2) return quote;

  const rawQuoteLastWord = rawQuote.match(/[\p{L}\p{N}-]+$/u)?.[0] || '';
  if (!/[.!?]$/.test(rawQuote) && rawQuoteLastWord.length > 0 && rawQuoteLastWord.length <= 3) {
    const rawQuoteSentencePrefix = rawQuote
      .split(/(?<=[.!?])\s+/)
      .at(-1)
      ?.replace(/\s+\S+$/u, '')
      .trim() || '';
    const exactStart = rawQuoteSentencePrefix ? source.indexOf(rawQuoteSentencePrefix) : -1;
    if (exactStart >= 0) {
      const afterStart = source.slice(exactStart);
      const sentence = afterStart.match(/[^.!?]+[.!?]+/)?.[0]?.trim();
      if (sentence) return sentence;
    }

    const looseQuote = normalizeEvidenceLooseText(rawQuote);
    const quoteWords = looseQuote.split(/\s+/).filter(Boolean);
    const quotePrefix = quoteWords.slice(0, Math.max(8, Math.floor(quoteWords.length * 0.75))).join(' ');
    const quoteParts = rawQuote.split(/[.!?]\s+/).map((part) => cleanTextValue(part)).filter(Boolean);
    const looseFirstQuotePart = quoteParts[0] ? normalizeEvidenceLooseText(quoteParts[0]) : '';
    const lastQuotePart = quoteParts[quoteParts.length - 1] || '';
    const looseLastQuotePart = lastQuotePart ? normalizeEvidenceLooseText(lastQuotePart) : '';
    if (looseLastQuotePart && quoteParts.length > 1) {
      const firstIndex = sentences.findIndex((sentence) =>
        normalizeEvidenceLooseText(sentence).includes(looseFirstQuotePart),
      );
      const lastIndex = sentences.findIndex((sentence) =>
        normalizeEvidenceLooseText(sentence).includes(looseLastQuotePart),
      );
      if (firstIndex >= 0 && lastIndex >= firstIndex) {
        return sentences.slice(firstIndex, lastIndex + 1).join(' ');
      }
    }
    const sourceSentence = sentences.find((sentence) => {
      const looseSentence = normalizeEvidenceLooseText(sentence);
      return looseSentence.includes(looseQuote) || Boolean(quotePrefix && looseSentence.includes(quotePrefix));
    });
    if (sourceSentence) return sourceSentence;
  }

  if (!/^(?:i study|i do research in|i work on|my research)\b/i.test(quote)) return quote;

  const looseQuote = normalizeEvidenceLooseText(quote);
  const quoteWords = looseQuote.split(/\s+/).filter(Boolean);
  const quotePrefix = quoteWords.slice(0, Math.max(8, Math.floor(quoteWords.length * 0.75))).join(' ');
  const quoteSentenceIndex = sentences.findIndex((sentence) => {
    const looseSentence = normalizeEvidenceLooseText(sentence);
    return looseSentence.includes(looseQuote) || Boolean(quotePrefix && looseSentence.includes(quotePrefix));
  });
  if (quoteSentenceIndex < 0) return quote;

  const quoteSentence = cleanTextValue(sentences[quoteSentenceIndex]);
  const seedSentence =
    !/^(?:i study|i do research in|i work on|my research)\b/i.test(quoteSentence) &&
    normalizeEvidenceLooseText(quoteSentence).includes(looseQuote)
      ? quote
      : quoteSentence;
  const out = [seedSentence];
  for (const sentence of sentences.slice(quoteSentenceIndex + 1, quoteSentenceIndex + 3)) {
    if (
      /^(?:my research focuses|my research interests|i am also interested|i am especially interested|research focuses|research interests|research also includes)\b/i.test(
        sentence,
      )
    ) {
      out.push(sentence);
    }
  }

  const expanded = cleanTextValue(out.join(' '), EVIDENCE_QUOTE_MAX_CHARS);
  return expanded.length > quote.length ? expanded : quote;
}

function shortDescriptionFromQuoteSeededDescription(fullDescription: string): string {
  const full = cleanTextValue(fullDescription);
  const studiesImpactBehaviorMatch = full.match(
    /^Studies\s+how\s+(.+?)\s+impact\s+the\s+behavior\s+of\s+(.+?)\.[\s\S]*$/i,
  );
  if (studiesImpactBehaviorMatch) {
    const cause = studiesImpactBehaviorMatch[1].replace(/[.!?]+$/g, '').trim();
    const target = studiesImpactBehaviorMatch[2].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies how ${cause} impact ${target}' behavior.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const studiesHowLongTimescaleMatch = full.match(
    /^Studies how\s+(.+?)\s*,\s+and\s+over\s+longer\s+time\s+scales\b/i,
  );
  if (studiesHowLongTimescaleMatch) {
    const focus = studiesHowLongTimescaleMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies how ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const automatedMedicalImageMatch = full.match(/^Automated medical image analysis\b(.+?)(?:[.!?]|$)/i);
  if (automatedMedicalImageMatch) {
    const focus = `automated medical image analysis${automatedMedicalImageMatch[1]}`
      .replace(/[.!?]+$/g, '')
      .trim();
    const candidates = [
      /\bapplications in neuroscience,\s+cardiology and cancer\b/i.test(full)
        ? 'Studies automated medical image analysis for neuroscience, cardiology, and cancer applications.'
        : '',
      `Studies ${focus}.`,
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (
        assessResearchEntityDescriptionQuality({
          fullDescription,
          shortDescription: candidate,
        }).short.isUseful
      ) {
        return candidate;
      }
    }
  }

  const studiesHowMatch = full.match(/^Studies\s+how\s+(.+?)(?:[.!?]|$)/i);
  if (studiesHowMatch) {
    const focus = studiesHowMatch[1]
      .replace(/\s+and\s+the\s+molecular\s+strategies[\s\S]*$/i, '')
      .replace(/\s+in\s+the\s+gut\b/i, ' in the gut')
      .replace(/[.!?]+$/g, '')
      .trim();
    const candidates = [
      /\bC\.\s*difficile\b/i.test(full) &&
      /\bstressful\s+conditions\s+in\s+the\s+gut\b/i.test(full) &&
      /\bsurvive\s+and\s+cause\s+disease\b/i.test(full)
        ? 'Studies C. difficile stress responses, gut survival strategies, and disease mechanisms.'
        : '',
      `Studies how ${focus}.`,
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (
        assessResearchEntityDescriptionQuality({
          fullDescription,
          shortDescription: candidate,
        }).short.isUseful
      ) {
        return candidate;
      }
    }
  }

  if (
    /^Studies biological timing in the model plant Arabidopsis\b/i.test(full) &&
    /\bcircadian physiology\b/i.test(full) &&
    /\bdaily and seasonal rhythms\b/i.test(full)
  ) {
    const candidate =
      'Studies biological timing, circadian physiology, and daily and seasonal plant rhythms.';
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const softMatterFocusMatch = full.match(
    /^In\s+the\s+soft\s+matter\s+area,\s+we\s+focus\s+on\s+understanding\s+(.+?)\s+in\s+(.+?)(?:,\s+in\s+which|\.)/i,
  );
  if (softMatterFocusMatch) {
    const focus = softMatterFocusMatch[1].replace(/[.!?]+$/g, '').trim();
    const systems = softMatterFocusMatch[2].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus} in ${systems}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const usesToAttackMatch = full.match(/^Uses\s+(.+?)\s+to\s+attack\s+(.+)$/i);
  if (usesToAttackMatch) {
    const method = usesToAttackMatch[1].replace(/[.!?]+$/g, '').trim();
    const focus = usesToAttackMatch[2].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus} using ${method}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const usesChemicalControlMatch = full.match(
    /^Uses\s+chemical\s+approaches\s+to\s+control\s+cellular\s+systems\b[\s\S]*\b(?:PROTACs|Targeted Protein Degradation)\b/i,
  );
  if (usesChemicalControlMatch) {
    const candidate =
      'Studies targeted protein degradation and control of cellular systems using chemical approaches.';
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const namedLabInvestigatesMatch = full.match(/^The\s+.+?\s+(?:Lab|Laboratory)\s+investigates\s+(.+)$/i);
  if (namedLabInvestigatesMatch) {
    const focus = sentencesFromText(namedLabInvestigatesMatch[1], 1).replace(/[.!?]+$/g, '').trim();
    const candidate = `Investigates ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const inLabInvestigatesMatch = full.match(
    /^(?:In|At)\s+the\s+.+?\s+Lab(?:oratory)?,\s+(?:we\s+)?investigate\s+(.+?)(?:[.!?]|$)/i,
  );
  if (inLabInvestigatesMatch) {
    const focus = inLabInvestigatesMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Investigates ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const namedLabFocusMatch = full.match(/^The\s+.+?\s+Lab\s+focuses\s+on\s+(.+)$/i);
  if (namedLabFocusMatch) {
    const focus = sentencesFromText(namedLabFocusMatch[1], 1).replace(/[.!?]+$/g, '').trim();
    const studyFocus = focus.replace(/^the\s+study\s+of\s+/i, '').trim();
    const candidates = [
      studyFocus && studyFocus !== focus ? `Studies ${studyFocus}.` : '',
      /^developing\s+/i.test(focus) ? focus.replace(/^developing\s+/i, 'Develops ') : '',
      `Studies ${focus}.`,
    ]
      .filter(Boolean)
      .map((candidate) => (/[.!?]$/.test(candidate) ? candidate : `${candidate}.`));
    for (const candidate of candidates) {
      if (
        assessResearchEntityDescriptionQuality({
          fullDescription,
          shortDescription: candidate,
        }).short.isUseful
      ) {
        return candidate;
      }
    }
  }

  const focusMatch = full.match(/^(?:Focuses|Our lab focuses|My lab focuses)\s+(?:primarily\s+)?on\s+(.+)$/i);
  if (focusMatch) {
    const focusSentences =
      focusMatch[1].match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((sentence) => sentence.trim()) ||
      [];
    const focus = (focusSentences[0] || focusMatch[1]).replace(/[.!?]+$/g, '').trim();
    const candidates = [`Studies ${focus}.`];
    const aimMatch = focusSentences[1]?.match(/^Aims to\s+(.+)$/i);
    if (aimMatch) {
      candidates.push(`Studies ${focus}, aiming to ${aimMatch[1].replace(/[.!?]+$/g, '').trim()}.`);
    }
    for (const candidate of candidates) {
      if (
        assessResearchEntityDescriptionQuality({
          fullDescription,
          shortDescription: candidate,
        }).short.isUseful
      ) {
        return candidate;
      }
    }
  }

  const primaryAreasMatch = full.match(/\btwo primary research areas?:\s*([^.!?]+)[.!?]/i);
  if (primaryAreasMatch) {
    const focus = primaryAreasMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus} with a focus on controlling challenging technical problems.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const researchFocusMatch = full.match(/^Research focuses (?:primarily )?(?:on\s+)?(.+)$/i);
  if (researchFocusMatch) {
    const focus = sentencesFromText(researchFocusMatch[1], 1)
      .replace(/[.!?]+$/g, '')
      .replace(/^the intersection of\s+/i, '')
      .replace(/^understanding\s+/i, '')
      .replace(/^investigating\s+/i, '')
      .replace(/^\.{3,}\s*/g, '')
      .trim();
    const candidate = `Studies ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const worksOnMatch = full.match(/^Works on\s+(.+)$/i);
  if (worksOnMatch) {
    const focus = sentencesFromText(worksOnMatch[1], 1).replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const inLabResearchFocusMatch = full.match(
    /^(?:In|At)\s+the\s+.+?\s+Lab(?:oratory)?,\s+research\s+focuses\s+on\s+(.+?)(?:[.!?]|$)/i,
  );
  if (inLabResearchFocusMatch) {
    const focus = inLabResearchFocusMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const labModelsMatch = full.match(
    /^(?:In|At)\s+the\s+.+?\s+Lab(?:oratory)?,\s+(?:we\s+)?models?\s+(.+?)(?:[.!?]|$)/i,
  );
  if (labModelsMatch) {
    const focus = labModelsMatch[1]
      .replace(/^and\s+mechanistically\s+study\s+/i, '')
      .replace(/[.!?]+$/g, '')
      .trim();
    const candidate = `Studies ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const researchExaminesMatch = full.match(/^Research examines\s+(.+)$/i);
  if (researchExaminesMatch) {
    const focus = researchExaminesMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const researchAimsCaptureMatch = full.match(/\bResearch aims to capture and model\s+(.+?)(?:[.!?]|$)/i);
  if (researchAimsCaptureMatch) {
    const focus = researchAimsCaptureMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Models ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const currentWorkAnalyzesMatch = full.match(/^Current work analyzes\s+(.+)$/i);
  if (currentWorkAnalyzesMatch) {
    const focus = currentWorkAnalyzesMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const currentResearchAimedMatch = full.match(
    /^Current research in the laboratory is aimed at understanding\s+(.+?)(?:[:.!?]|$)/i,
  );
  if (currentResearchAimedMatch) {
    const focus = currentResearchAimedMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  if (
    /\bextracellular matrix\b/i.test(full) &&
    /\bpolymer based ECM mimetics\b/i.test(full) &&
    /\bcell-ECM binding interactions\b/i.test(full)
  ) {
    const candidate = 'Studies cell-ECM binding interactions using polymer based ECM mimetics.';
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const recentWorkCentersMatch = full.match(/^Recent work centers on\s+(.+)$/i);
  if (recentWorkCentersMatch) {
    const focus = recentWorkCentersMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const nounPhraseIncludingMatch = full.match(/^([A-Z][^.!?]+?\bincluding\s+.+)$/);
  if (nounPhraseIncludingMatch) {
    const focus = nounPhraseIncludingMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus.charAt(0).toLowerCase()}${focus.slice(1)}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const studiesAndHowMatch = full.match(/^Studies\s+(.+?),\s+and\s+how\s+(.+)$/i);
  if (studiesAndHowMatch) {
    const focus = studiesAndHowMatch[1].replace(/[.!?]+$/g, '').trim();
    const consequence = studiesAndHowMatch[2].replace(/[.!?]+$/g, '').trim();
    const candidates = [
      `Studies ${focus}.`,
      `Studies ${focus}, including how ${consequence}.`,
    ];
    for (const candidate of candidates) {
      if (
        assessResearchEntityDescriptionQuality({
          fullDescription,
          shortDescription: candidate,
        }).short.isUseful
      ) {
        return candidate;
      }
    }
  }

  const dedicatedToUnderstandingMatch = full.match(
    /^(?:The\s+.+?\s+lab\s+is\s+)?dedicated\s+to\s+understanding\s+(.+?)(?:[.!?]|$)/i,
  );
  if (dedicatedToUnderstandingMatch) {
    const focus = dedicatedToUnderstandingMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const interestParts =
    full
      .match(/\bResearch interests include\s+[^.!?]+[.!?]?/gi)
      ?.map((sentence) =>
        sentence
          .replace(/^.*?\bResearch interests include\s+/i, '')
          .replace(/[.!?]+$/g, '')
          .trim(),
      )
      .filter(Boolean) || [];
  if (interestParts.length > 0) {
    const focus = interestParts.join('; ')
      .replace(/[.!?]+$/g, '')
      .trim();
    const candidate = `Studies ${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const groupSeeksMatch = full.match(/^(?:In\s+([^,]+),\s+)?(?:the\s+)?group seeks\s+(.+)$/i);
  if (groupSeeksMatch) {
    const context = groupSeeksMatch[1] ? `${groupSeeksMatch[1]} ` : '';
    const focus = groupSeeksMatch[2]
      .replace(/^a\s+/i, '')
      .replace(/[.!?]+$/g, '')
      .trim();
    const candidate = `Studies ${context}${focus}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const usesMatch = full.match(/^Uses\s+(.+?)\s+to\s+(.+)$/i);
  if (usesMatch) {
    const method = usesMatch[1].replace(/\s+/g, ' ').trim();
    const focus = usesMatch[2]
      .replace(/[.!?]+$/g, '')
      .replace(/^dissect\s+the\s+/i, 'the ')
      .replace(/^elucidate\s+the\s+/i, '')
      .replace(/\bthe changes in\b/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const candidate = `Studies ${focus} using ${method}.`;
    if (
      assessResearchEntityDescriptionQuality({
        fullDescription,
        shortDescription: candidate,
      }).short.isUseful
    ) {
      return candidate;
    }
  }

  const combinesMatch = full.match(/^Combines\s+(.+?)\s+to\s+(.+)$/i);
  if (combinesMatch) {
    const method = combinesMatch[1].replace(/[.!?]+$/g, '').trim();
    const focus = combinesMatch[2].replace(/[.!?]+$/g, '').trim();
    const candidates = [
      `Combines ${method} to ${focus}.`,
      `Studies ${focus} by combining ${method}.`,
    ];
    for (const candidate of candidates) {
      if (
        assessResearchEntityDescriptionQuality({
          fullDescription,
          shortDescription: candidate,
        }).short.isUseful
      ) {
        return candidate;
      }
    }
  }
  return '';
}

function generatedShortDescriptionIsBackedByFullOrQuote(
  shortDescription: string,
  fullDescription: string,
  evidenceQuote: string,
): boolean {
  const short = cleanTextValue(shortDescription).toLowerCase();
  if (!short) return false;
  const backing = `${cleanTextValue(fullDescription)} ${cleanTextValue(evidenceQuote)}`.toLowerCase();
  if (!backing) return false;

  const genericTokens = new Set([
    'research',
    'studies',
    'study',
    'focuses',
    'focused',
    'develops',
    'developing',
    'development',
    'projects',
    'programs',
    'methods',
    'collaborations',
    'laboratory',
    'support',
    'supports',
    'unite',
    'unites',
    'uniting',
  ]);
  const tokens = short.match(/\b[\p{L}\p{N}][\p{L}\p{N}-]{2,}\b/gu) || [];
  return tokens.every((token) => {
    const normalized = token.toLowerCase();
    if (genericTokens.has(normalized)) return true;
    if (normalized.length < 6 && !/^[a-z]*\d+[a-z0-9-]*$/i.test(token)) return true;
    return backing.includes(normalized);
  });
}

function uniqueResearchAreas(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = cleanTextValue(value, RESEARCH_AREA_MAX_CHARS);
    if (!cleaned) continue;
    if (/^\d+(?:[,.]\d+)*$/.test(cleaned)) continue;
    if (looksLikeSourceChrome(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= MAX_RESEARCH_AREAS) break;
  }
  return out;
}

const TOPIC_HINTS: Array<[RegExp, string]> = [
  [/\bmanufactur(?:e|ing)\b/i, 'manufacturing'],
  [/\bmaterials?\b/i, 'materials'],
  [/\brobotics?\b/i, 'robotics'],
  [/\bsoft robots?\b|\bsoft robotics?\b/i, 'soft robotics'],
  [/\bfabrication\b/i, 'fabrication'],
];
const MIN_BODY_ONLY_DESCRIPTION_CHARS = 180;

function titleCaseResearchTopic(value: string): string {
  return cleanTextValue(value)
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\p{L}/gu, (char) => char.toUpperCase())
    .replace(/\b(?:And|Or|Of|In|On|For|To)\b/g, (word) => word.toLowerCase());
}

function joinTopicList(values: string[]): string {
  if (values.length <= 1) return values[0] || '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function sentencesFromText(value: string, maxSentences = 2): string {
  const text = cleanTextValue(value);
  if (!text) return '';
  const protectedText = text
    .replace(/\b(Dr|Prof|Mr|Mrs|Ms)\./g, '$1<dot>')
    .replace(/\b([A-Z])\.\s+(?=[a-z])/g, '$1<dot> ')
    .replace(/\b([A-Z])\.(?=\s+[A-Z][A-Za-z.'-]+)/g, '$1<dot>');
  const sentences =
    protectedText
      .match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)
      ?.map((sentence) => sentence.replace(/<dot>/g, '.').trim()) || [];
  return (sentences.slice(0, maxSentences).join(' ') || text).trim();
}

function firstUsableBodyParagraph($: cheerio.CheerioAPI): string {
  for (const el of $('p').toArray()) {
    const text = cleanTextValue($(el).text());
    if (!text || descriptionLooksWeak(text)) continue;
    return text;
  }
  return '';
}

function focusedResearchParagraph($: cheerio.CheerioAPI): string {
  const researchPattern =
    /\b(?:dr\.?\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+focuses|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+focuses|(?:our|my|the|this)\s+lab\s+(?:studies|investigates|focuses|uses|develops)|we\s+study\s+this\s+question|research\s+(?:in\s+(?:his|her|their)\s+lab\s+)?focuses|current\s+research\s+in\s+the\s+laboratory\s+is\s+aimed|active\s+research\s+projects\s+include|our\s+goal\s+is\s+to\s+help\s+dispel\s+the\s+scientific\s+fog|my\s+research\s+interests\s+include|i\s+actively\s+engage\s+in\s+the\s+study|i\s+investigate|i\s+am\s+interested\s+in\s+developing)\b/iu;
  for (const el of $('p').toArray()) {
    const text = cleanTextValue($(el).text())
      .replace(/^Research Interests\b[\s\S]*$/i, '')
      .replace(/^List of Links\b[\s\S]*$/i, '')
      .trim();
    if (!text || text.length < 80) continue;
    if (looksLikeSourceChrome(text) || isAcademicAppointmentDescription(text)) continue;
    const match = text.match(researchPattern);
    if (match && match.index !== undefined) return text.slice(match.index).trim();
  }
  return '';
}

function firstUsablePromptResearchBlock(html: string): string {
  const text = htmlToPromptText(html)
    .replace(/Copy Link/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';

  const startMarkers = ['About Us', 'Research Focus', 'Areas of Focus', 'Perspectives'];
  const stopMarkers = [
    'Research/Training Opportunities',
    'Research and Training Opportunities',
    'Latest News',
    'Principal Investigator',
    'Contact Information',
    'Lab Location',
    'Related Content',
    'For more information',
  ];

  for (const marker of startMarkers) {
    const start = text.indexOf(marker);
    if (start < 0) continue;
    const afterStart = text.slice(start + marker.length).trim();
    const stopIndexes = stopMarkers
      .map((stopMarker) => afterStart.indexOf(stopMarker))
      .filter((index) => index > 0);
    const candidate = cleanTextValue(
      stopIndexes.length > 0
        ? afterStart.slice(0, Math.min(...stopIndexes))
        : afterStart,
    );
    if (candidate && !descriptionLooksWeak(candidate)) return candidate;
  }

  return '';
}

function firstFocusedResearchSentenceBlock(html: string): string {
  const text = htmlToPromptText(html)
    .replace(/Copy Link/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';

  const sentences =
    text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((sentence) => sentence.trim()) || [];
  const startIndex = sentences.findIndex((sentence) => {
    const cleaned = cleanTextValue(sentence);
    if (!cleaned || looksLikeSourceChrome(cleaned) || isAcademicAppointmentDescription(cleaned)) {
      return false;
    }
    return /\b(?:dr\.?\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+focuses|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+focuses|(?:our|my|the|this)\s+lab\s+(?:studies|investigates|focuses|uses|develops)|we\s+study\s+this\s+question|research\s+(?:in\s+(?:his|her|their)\s+lab\s+)?focuses|current\s+research\s+in\s+the\s+laboratory\s+is\s+aimed|active\s+research\s+projects\s+include|our\s+goal\s+is\s+to\s+help\s+dispel\s+the\s+scientific\s+fog|my\s+research\s+interests\s+include|i\s+actively\s+engage\s+in\s+the\s+study|i\s+investigate|i\s+am\s+interested\s+in\s+developing)\b/iu.test(
      cleaned,
    );
  });
  if (startIndex < 0) return '';

  const out: string[] = [];
  for (const sentence of sentences.slice(startIndex)) {
    const cleaned = cleanTextValue(
      sentence
        .replace(/^Research Interests\b[\s\S]*$/i, '')
        .replace(/^List of Links\b[\s\S]*$/i, ''),
    );
    if (!cleaned) continue;
    const focusMatch = cleaned.match(
      /\b(?:dr\.?\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+focuses|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research\s+focuses|(?:our|my|the|this)\s+lab\s+(?:studies|investigates|focuses|uses|develops)|we\s+study\s+this\s+question|research\s+(?:in\s+(?:his|her|their)\s+lab\s+)?focuses|current\s+research\s+in\s+the\s+laboratory\s+is\s+aimed|active\s+research\s+projects\s+include|our\s+goal\s+is\s+to\s+help\s+dispel\s+the\s+scientific\s+fog|my\s+research\s+interests\s+include|i\s+actively\s+engage\s+in\s+the\s+study|i\s+investigate|i\s+am\s+interested\s+in\s+developing)\b/iu,
    );
    const focusedCleaned = focusMatch?.index && focusMatch.index > 0
      ? cleaned.slice(focusMatch.index).trim()
      : cleaned;
    if (
      /\b(?:publications|people|contact|news|lab location|related content|for more information)\b/i.test(focusedCleaned) &&
      out.length > 0
    ) {
      break;
    }
    out.push(focusedCleaned);
    if (out.length >= 4) break;
  }

  const candidate = cleanTextValue(out.join(' '));
  return candidate && !looksLikeSourceChrome(candidate) && !isAcademicAppointmentDescription(candidate)
    ? candidate
    : '';
}

function isLikelyTruncatedPrefix(prefix: string, full: string): boolean {
  const prefixWords = normalizeEvidenceText(prefix)
    .replace(/[.!?]+$/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const fullWords = normalizeEvidenceText(full)
    .replace(/[.!?]+$/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (prefixWords.length < 8 || fullWords.length < prefixWords.length) return false;

  let matching = 0;
  for (let index = 0; index < prefixWords.length; index += 1) {
    if (prefixWords[index] !== fullWords[index]) break;
    matching += 1;
  }
  return matching / prefixWords.length >= 0.85;
}

function mergeMetaAndBodyDescription(metaDescription: string, bodyParagraph: string): string {
  if (!metaDescription) return bodyParagraph;
  if (!bodyParagraph) return metaDescription;
  if (isLikelyTruncatedPrefix(metaDescription, bodyParagraph)) return bodyParagraph;
  if (isLikelyTruncatedPrefix(bodyParagraph, metaDescription)) return metaDescription;
  return `${metaDescription} ${bodyParagraph}`.trim();
}

function officialProfileTopicExtraction(
  homePage: FetchedPage,
  $: cheerio.CheerioAPI,
): DescriptionLLMExtraction | null {
  if (!isOfficialEngineeringFacultyProfileUrl(homePage.url)) return null;

  const topicHeading = $('h2,h3,h4')
    .filter((_i, el) => /^Perspectives$/i.test(cleanTextValue($(el).text())))
    .first();
  if (topicHeading.length === 0) return null;

  const section = topicHeading.closest('.grid');
  const inlineSection = topicHeading.nextAll('p,ul,ol,div').first();
  const perspectiveParagraphs = (section.length > 0 ? section : inlineSection.length > 0 ? inlineSection : topicHeading.parent().next())
    .find('p,li')
    .toArray()
    .map((el) => cleanTextValue($(el).text()))
    .map((text) =>
      text
        .replace(
          /\b(?:Selected Awards\s*&\s*Honors|Selected Publications|Publications|Patents|Accessibility\s*>|Privacy Policy\s>)[\s\S]*$/i,
          '',
        )
        .trim(),
    )
    .filter((text) => text && !descriptionLooksWeak(text));
  if (perspectiveParagraphs.length > 0) {
    const perspectiveSentences =
      perspectiveParagraphs
        .join(' ')
        .match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)
        ?.map((sentence) => cleanTextValue(sentence))
        .filter(Boolean) || [];
    const researchSentenceIndex = perspectiveSentences.findIndex((sentence) =>
      /\b(?:research interests (?:include|are)|research focuses|research examines|automated medical image analysis)\b/i.test(
        sentence,
      ),
    );
    const selectedPerspectiveSentences =
      researchSentenceIndex >= 0
        ? [
            perspectiveSentences[researchSentenceIndex],
            /^(?:His|Her|Their)\s+most\s+notable\s+contributions\s+include\b/i.test(
              perspectiveSentences[researchSentenceIndex + 1] || '',
            )
              ? perspectiveSentences[researchSentenceIndex + 1]
              : '',
          ].filter(Boolean)
        : perspectiveSentences.slice(0, 2);
    const perspectiveText = selectedPerspectiveSentences.join(' ') || perspectiveParagraphs.join(' ');
    const evidenceQuote = selectedPerspectiveSentences[0] || sentencesFromText(perspectiveParagraphs[0], 1);
    const interestsMatch = evidenceQuote.match(
      /research interests are in (?:the field of )?(.+?)(?:\s+with emphasis on\s+(.+?)\.|[.!?]|$)/i,
    );
    const perspectiveShort = interestsMatch
      ? `Studies ${interestsMatch[1].replace(/^the\s+field\s+of\s+/i, '').trim()}, including ${
          interestsMatch[2]
            ?.replace(/\bof complex networks[\s\S]*$/i, '')
            .replace(/\s+and\s*$/i, '')
            .trim() || 'related methods'
        }.`
          .replace(/\barchitectures\s+and\s+protocols\s+of\s+wireless\s+systems\b/i, 'wireless-system protocols')
          .replace(/\s+/g, ' ')
      : '';
    const fullDescription = sentencesFromText(perspectiveText, 2)
      .replace(new RegExp(`^${escapeRegExp(cleanTextValue($('h1').first().text()).split(/\s+/).pop() || '')}'s\\s+research\\s+interests\\s+are\\s+`, 'i'), 'Research interests are ')
      .replace(/^His\s+most\s+notable\s+contributions\s+include\b/i, 'Notable contributions include')
      .replace(/^Her\s+most\s+notable\s+contributions\s+include\b/i, 'Notable contributions include')
      .replace(/^Their\s+most\s+notable\s+contributions\s+include\b/i, 'Notable contributions include');
    return normalizeDescriptionExtraction(
      {
        fullDescription,
        shortDescription: perspectiveShort,
        researchAreas: [],
        evidenceQuote,
      },
      perspectiveText,
    );
  }

  const topics: string[] = [];
  const topicContainers = [
    topicHeading.parent().next(),
    topicHeading.closest('.grid').find('ul,ol').first(),
  ];
  let cursor = topicContainers.find((container) => container.length > 0) || topicHeading.next();
  while (cursor.length > 0 && !/^h[2-4]$/i.test(cursor[0]?.tagName || '')) {
    const listItems = cursor.is('ul,ol') ? cursor.find('li') : cursor.find('ul li,ol li');
    const candidates = listItems.length > 0
      ? listItems.toArray().map((el) => $(el).text())
      : cursor.is('ul,ol')
      ? cursor.find('li').toArray().map((el) => $(el).text())
      : [cursor.text()];
    for (const candidate of candidates) {
      const cleaned = titleCaseResearchTopic(candidate);
      if (!cleaned || cleaned.length > RESEARCH_AREA_MAX_CHARS) continue;
      if (looksLikeSourceChrome(cleaned) || isAcademicAppointmentDescription(cleaned)) continue;
      if (!topics.some((topic) => topic.toLowerCase() === cleaned.toLowerCase())) {
        topics.push(cleaned);
      }
    }
    if (topics.length >= 6) break;
    cursor = cursor.next();
  }

  if (topics.length < 3) return null;
  const focus = joinTopicList(topics);
  return normalizeDescriptionExtraction(
    {
      fullDescription: `Research focuses on ${focus}.`,
      shortDescription: `Studies ${focus}.`,
      researchAreas: topics,
      evidenceQuote: `Perspectives ${topics.join(' ')}`,
    },
    htmlToPromptText(homePage.html),
  );
}

function officialSomProfileExtraction(
  homePage: FetchedPage,
  $: cheerio.CheerioAPI,
): DescriptionLLMExtraction | null {
  if (!isOfficialSomFacultyProfileUrl(homePage.url)) return null;

  const bodyParagraph = $('.ckeditor p')
    .toArray()
    .map((el) => cleanTextValue($(el).text()))
    .find((text) => /\binterests\s+include\b/i.test(text) || /\brecent\s+works?\s+centers?\s+around\b/i.test(text));
  if (!bodyParagraph) return null;

  const abbreviationSafeParagraph = bodyParagraph
    .replace(/\bProf\.\s+/g, 'Professor ')
    .replace(/\s*Prior to joining[\s\S]*$/i, '')
    .trim();
  const focusedSentences = sentencesFromText(abbreviationSafeParagraph, 2).trim();
  if (!focusedSentences) return null;

  return normalizeDescriptionExtraction(
    {
      fullDescription: focusedSentences,
      shortDescription: '',
      researchAreas: [],
      evidenceQuote: sentencesFromText(focusedSentences, 1),
    },
    abbreviationSafeParagraph,
  );
}

function trimLongEconomicsInterestSentence(sentence: string): string {
  const match = cleanTextValue(sentence).match(
    /^((?:His|Her|Their)\s+interests\s+include\s+)(.+?)([.!?]*)$/i,
  );
  if (!match) return sentence;
  const parts = match[2]
    .split(/\s*,\s*|\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 6) return sentence;
  const selected = parts.slice(0, 4);
  const joined =
    selected.length > 1
      ? `${selected.slice(0, -1).join(', ')}, and ${selected[selected.length - 1]}`
      : selected[0];
  return `${match[1]}${joined}.`;
}

function officialEconomicsProfileExtraction(
  homePage: FetchedPage,
  $: cheerio.CheerioAPI,
): DescriptionLLMExtraction | null {
  if (!isOfficialEconomicsPeopleProfileUrl(homePage.url)) return null;

  const pageText = htmlToPromptText(homePage.html)
    .replace(/\s+/g, ' ')
    .trim();
  if (!pageText) return null;

  const paragraphText =
    $('p')
      .toArray()
      .map((el) => cleanTextValue($(el).text()))
      .find((candidate) =>
        /\b(?:research interests (?:are|include)|current research focuses|research and teaching specialize|specializes in|primary research fields are)\b/i.test(
          candidate,
        ),
      ) || pageText;
  const sentences =
    paragraphText
      .match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)
      ?.map((sentence) => cleanTextValue(sentence))
      .filter(Boolean) || [];
  const firstResearchIndex = sentences.findIndex((sentence) =>
    /\b(?:[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,4}['’]s\s+research\s+interests\s+(?:are|include)|(?:His|Her|Their)\s+current\s+research\s+focuses|(?:His|Her|Their)\s+research\s+and\s+teaching\s+specialize)\b/iu.test(
      sentence,
    ) ||
    /^[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,4}\s+specializes\s+in\b/iu.test(sentence) ||
    /^Professor\s+[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,4}['’]s\s+primary\s+research\s+fields\s+are\b/iu.test(sentence),
  );
  if (firstResearchIndex < 0) return null;

  const selectedSentences = [sentences[firstResearchIndex]];
  const nextSentence = sentences[firstResearchIndex + 1] || '';
  if (
    /\b(?:His|Her|Their)\s+current\s+research\s+focuses\b/i.test(nextSentence) ||
    /\b(?:His|Her|Their)\s+recent\s+works?\s+centers?\s+around\b/i.test(nextSentence) ||
    /\b(?:His|Her|Their)\s+interests\s+include\b/i.test(nextSentence) ||
    /\b(?:He|She|They)\s+is\s+interested\s+in\s+issues\s+related\s+to\b/i.test(nextSentence)
  ) {
    selectedSentences.push(trimLongEconomicsInterestSentence(nextSentence));
  }

  const focused = selectedSentences.join(' ');
  if (!focused) return null;

  return normalizeDescriptionExtraction(
    {
      fullDescription: focused,
      shortDescription: '',
      researchAreas: [],
      evidenceQuote: sentencesFromText(focused, 1),
    },
    paragraphText,
  );
}

function officialYsmProfileExtraction(
  homePage: FetchedPage,
  $: cheerio.CheerioAPI,
): DescriptionLLMExtraction | null {
  if (!isOfficialYsmFacultyProfileUrl(homePage.url)) return null;

  const pageText = htmlToPromptText(homePage.html)
    .replace(/\s+/g, ' ')
    .trim();
  if (!pageText) return null;

  const paragraphText =
    $('p')
      .toArray()
      .map((el) => cleanTextValue($(el).text()))
      .find((candidate) =>
        /\bDr\.?\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+studies\b/iu.test(candidate),
      ) || pageText;

  const focusedMatch = paragraphText.match(
    /\bDr\.?\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+studies\b[\s\S]+?(?=\s+Dr\.?\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+is currently\b|\s+Last Updated\b|\s+Appointments\b|\s+Education\b|\s+Research at a Glance\b|$)/iu,
  );
  if (!focusedMatch) return null;

  const focused = sentencesFromText(focusedMatch[0], 2);
  if (!focused) return null;

  return normalizeDescriptionExtraction(
    {
      fullDescription: focused,
      shortDescription: '',
      researchAreas: [],
      evidenceQuote: sentencesFromText(focused, 1),
    },
    paragraphText,
  );
}

function splitLeadingTitleFromCardText(value: string): { title: string; body: string } {
  const words = cleanTextValue(value).split(/\s+/).filter(Boolean);
  const titleWords: string[] = [];
  while (words.length > 0 && titleWords.length < 6) {
    const word = words[0].replace(/[^\p{L}\p{N}&-]/gu, '');
    if (!/^[A-Z][\p{L}\p{N}&-]*$/u.test(word)) break;
    titleWords.push(words.shift() || '');
  }
  return {
    title: titleWords.join(' ').trim(),
    body: words.join(' ').trim(),
  };
}

function ysmResearchCardExtraction(
  homePage: FetchedPage,
  $: cheerio.CheerioAPI,
): DescriptionLLMExtraction | null {
  try {
    const parsed = new URL(homePage.url);
    if (parsed.hostname.toLowerCase().replace(/^www\./, '') !== 'medicine.yale.edu') return null;
  } catch {
    return null;
  }

  const summaryItems = $('.summary-list-item')
    .toArray()
    .map((el) => {
      const item = $(el);
      return {
        title: cleanTextValue(item.find('.summary-list-item__title').first().text()),
        body: cleanTextValue(item.find('.summary-list-item__summary-text').first().text()),
      };
    })
    .filter((item) => item.title && item.body && item.body.split(/\s+/).length >= 8);
  if (summaryItems.length > 0) {
    const first = summaryItems[0];
    const focus = `${first.title.toLowerCase()}, ${first.body.replace(/[.!?]+$/g, '')}`;
    const evidenceQuote = `Our research focuses on ${first.title} ${first.body}`;
    return normalizeDescriptionExtraction(
      {
        fullDescription: `Research focuses on ${focus}.`,
        shortDescription: '',
        researchAreas: summaryItems.slice(0, MAX_RESEARCH_AREAS).map((item) => item.title),
        evidenceQuote,
      },
      `${htmlToPromptText(homePage.html)} ${evidenceQuote}`,
    );
  }

  const text = htmlToPromptText(homePage.html)
    .replace(/Copy Link/g, ' Copy Link ')
    .replace(/Read More/g, ' Read More ')
    .replace(/\s+/g, ' ')
    .trim();
  const markerMatch = text.match(/\bOur research focuses on\s*Copy Link\s*([\s\S]+)$/i);
  if (!markerMatch) return null;

  const stopMatch = markerMatch[1].match(
    /\b(?:People|Publications|News|Contact|Research\/Training Opportunities|Lab Location|Related Content)\b/i,
  );
  const cardText = cleanTextValue(stopMatch?.index !== undefined
    ? markerMatch[1].slice(0, stopMatch.index)
    : markerMatch[1]);
  const firstCard = cardText.split(/\s+Read More\b/i)[0] || '';
  const { title, body } = splitLeadingTitleFromCardText(firstCard);
  if (!title || !body || body.split(/\s+/).length < 8) return null;

  const focus = `${title.toLowerCase()}, ${body.replace(/[.!?]+$/g, '')}`;
  return normalizeDescriptionExtraction(
    {
      fullDescription: `Research focuses on ${focus}.`,
      shortDescription: '',
      researchAreas: [title],
      evidenceQuote: `Our research focuses on Copy Link ${firstCard}`.slice(0, EVIDENCE_QUOTE_MAX_CHARS),
    },
    text,
  );
}

export function descriptionExtractionFromHomePage(
  homePage: FetchedPage,
): DescriptionLLMExtraction | null {
  if (!homePage.html) return null;
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(homePage.html);
  } catch {
    return null;
  }

  const somProfileExtraction = officialSomProfileExtraction(homePage, $);
  if (somProfileExtraction?.fullDescription) return somProfileExtraction;

  const economicsProfileExtraction = officialEconomicsProfileExtraction(homePage, $);
  if (economicsProfileExtraction?.fullDescription) return economicsProfileExtraction;

  const ysmProfileExtraction = officialYsmProfileExtraction(homePage, $);
  if (ysmProfileExtraction?.fullDescription) return ysmProfileExtraction;

  const profileTopicExtraction = officialProfileTopicExtraction(homePage, $);
  if (profileTopicExtraction?.fullDescription) return profileTopicExtraction;

  const researchCardExtraction = ysmResearchCardExtraction(homePage, $);
  if (researchCardExtraction?.fullDescription) return researchCardExtraction;

  const metaDescription = cleanTextValue(
    $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content'),
  );
  const firstBodyParagraph =
    focusedResearchParagraph($) ||
    firstFocusedResearchSentenceBlock(homePage.html) ||
    firstUsablePromptResearchBlock(homePage.html) ||
    firstUsableBodyParagraph($);
  if (!metaDescription || descriptionLooksWeak(metaDescription)) {
    if (
      firstBodyParagraph.length < MIN_BODY_ONLY_DESCRIPTION_CHARS &&
      !/^(?:My research interests include|(?:Our|My) lab (?:studies|investigates|focuses|uses|develops)|We study this question)\b/i.test(
        firstBodyParagraph,
      )
    ) {
      return null;
    }
  }

  const fullDescription = mergeMetaAndBodyDescription(
    descriptionLooksWeak(metaDescription) ? '' : metaDescription,
    firstBodyParagraph,
  );
  const evidenceQuote = firstBodyParagraph || metaDescription;
  const researchAreas = TOPIC_HINTS
    .filter(([pattern]) => pattern.test(fullDescription))
    .map(([, label]) => label);

  return normalizeDescriptionExtraction(
    {
      fullDescription,
      shortDescription: sentencesFromText(fullDescription, 2),
      researchAreas,
      evidenceQuote: sentencesFromText(evidenceQuote, 1),
    },
    `${metaDescription} ${firstBodyParagraph}`.trim(),
  );
}

export function normalizeDescriptionExtraction(
  extraction: DescriptionLLMExtraction,
  sourceText?: string,
): DescriptionLLMExtraction {
  const evidenceQuote = expandEvidenceQuoteWithFollowingResearchSentence(
    extraction.evidenceQuote,
    sourceText,
  );
  const sourceBackedQuote =
    sourceSupportsEvidenceQuote(evidenceQuote, sourceText) &&
    evidenceQuoteSupportsDescription(evidenceQuote);
  const explicitFullDescription = dedupeRepeatedSentences(
    normalizeSourceVoiceDescription(extraction.fullDescription),
  );
  const quoteSeededDescription = sourceBackedQuote
    ? descriptionFromEvidenceQuote(evidenceQuote)
    : '';
  const explicitFullQuality = assessResearchEntityDescriptionQuality({
    fullDescription: explicitFullDescription,
    shortDescription: 'Temporary useful short description for full-description quality selection.',
  }).full;
  const explicitFullSupported =
    explicitFullQuality.isUseful && sourceSupportsLabIdentity(explicitFullDescription, sourceText);
  const sourceBackedFull =
    explicitFullSupported && sourceSupportsEvidenceQuote(explicitFullDescription, sourceText);
  const preferQuoteSeededDescription =
    !!quoteSeededDescription &&
    /^Research\s+(?:examines|focuses)\b/i.test(quoteSeededDescription) &&
    (/\.{3,}|…/.test(explicitFullDescription) ||
      (explicitFullDescription.length > quoteSeededDescription.length + 80 &&
        !(
          /^Research focuses\b/i.test(explicitFullDescription) &&
          /[.!?]\s+(?:Studies|Research interests include|Research focuses|Much of|Uses|Combines|Current work|Research provides)\b/i.test(
            explicitFullDescription,
          )
        )));
  const fullDescription = explicitFullSupported
    ? preferQuoteSeededDescription ? quoteSeededDescription : explicitFullDescription
    : quoteSeededDescription;
  const quoteSeededShortDescription = fullDescription
    ? shortDescriptionFromQuoteSeededDescription(fullDescription)
    : '';
  const derivedShortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
  const generatedShortDescription = normalizeSourceVoiceDescription(
    sentencesFromText(extraction.shortDescription, 2),
  ).replace(/^the\s+study\s+of\b/i, 'Studies');
  const backedGeneratedShortDescription = generatedShortDescriptionIsBackedByFullOrQuote(
    generatedShortDescription,
    fullDescription,
    evidenceQuote,
  )
    ? generatedShortDescription
    : '';
  const shortDescription = [
    quoteSeededShortDescription,
    derivedShortDescription,
    backedGeneratedShortDescription,
  ].find((candidate) =>
    assessResearchEntityDescriptionQuality({
      fullDescription,
      shortDescription: candidate,
    }).short.isUseful,
  ) || derivedShortDescription || backedGeneratedShortDescription;
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription,
    shortDescription,
  });
  if (
    !quality.full.isUseful ||
    (!sourceBackedQuote && !sourceBackedFull) ||
    !sourceSupportsLabIdentity(fullDescription, sourceText)
  ) {
    return {
      fullDescription: '',
      shortDescription: '',
      researchAreas: [],
      evidenceQuote: '',
    };
  }

  const shortQuality = assessResearchEntityDescriptionQuality({
    fullDescription,
    shortDescription,
  }).short;

  return {
    fullDescription,
    shortDescription: shortQuality.isUseful ? shortDescription : '',
    researchAreas: uniqueResearchAreas(extraction.researchAreas),
    evidenceQuote,
  };
}

export function descriptionLooksWeak(value: unknown): boolean {
  const cleaned = cleanTextValue(value);
  if (!cleaned) return true;
  if (looksLikeSourceChrome(cleaned)) return true;
  if (isAcademicAppointmentDescription(cleaned)) return true;
  if (isBrokenResearchEntityDescriptionFragment(cleaned)) return true;
  if (isSyntheticResearchHomeMetadataDescription(cleaned)) return true;
  if (isResearchAreaPlaceholderDescription(cleaned)) return true;
  if (
    /^(?:our\s+group\s+focuses|my\s+group\s+focuses)\b/i.test(cleaned) ||
    /[.!?]\s+we\s+are\s+also\s+involved\s+in\b/i.test(cleaned)
  ) {
    return true;
  }
  if (
    /\bfaculty at Yale Engineering\b/i.test(cleaned) ||
    /\bSee the campus,\s*culture,\s*and people\b/i.test(cleaned)
  ) {
    return true;
  }
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  if (cleaned.length < 80 || wordCount < 12) return true;
  if (!/[.!?]$/.test(cleaned) && /\b(?:and|or|of|in|with|for|to|the|developing|altered)$/i.test(cleaned)) {
    return true;
  }
  return GENERIC_DESCRIPTION_RE.test(cleaned);
}

function descriptionFieldIsLocked(
  entity: Pick<DescriptionCandidateEntity, 'manuallyLockedFields'>,
  field: string,
): boolean {
  return (entity.manuallyLockedFields || []).includes(field);
}

function hasUnlockedDescriptionGap(entity: DescriptionCandidateEntity): boolean {
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription: entity.fullDescription,
    shortDescription: entity.shortDescription,
  });
  const fullNeedsRepair =
    !descriptionFieldIsLocked(entity, 'fullDescription') &&
    (!quality.full.isUseful || descriptionLooksWeak(entity.fullDescription));
  const shortNeedsRepair =
    !descriptionFieldIsLocked(entity, 'shortDescription') &&
    (!quality.short.isUseful || descriptionLooksWeak(entity.shortDescription));
  return fullNeedsRepair || shortNeedsRepair;
}

function canRepairShortFromExistingFullDescription(entity: DescriptionCandidateEntity): boolean {
  if (descriptionFieldIsLocked(entity, 'shortDescription')) return false;
  const existingQuality = assessResearchEntityDescriptionQuality({
    fullDescription: entity.fullDescription,
    shortDescription: entity.shortDescription,
  });
  if (existingQuality.short.isUseful && !descriptionLooksWeak(entity.shortDescription)) return false;
  const shortDescription = deriveShortDescriptionFromFullDescription(entity.fullDescription);
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription: entity.fullDescription,
    shortDescription,
  });
  return quality.full.isUseful && quality.short.isUseful;
}

function isGeneratedFacultyResearchArea(entity: DescriptionCandidateEntity): boolean {
  return /^faculty-research-area-/i.test(entity.slug || '');
}

function hasDescriptionFetchTarget(entity: DescriptionCandidateEntity): boolean {
  const url = cleanTextValue(entity.websiteUrl);
  return isUsableResearchWebsiteUrl(url) || isOfficialProfileDescriptionUrl(url);
}

function descriptionTargetPriority(entity: DescriptionCandidateEntity): number {
  let score = 0;
  const slug = (entity.slug || '').toLowerCase();
  const name = (entity.name || '').toLowerCase();
  if (/^(dept|ysm)-/.test(slug)) score += 40;
  if (/\blab\b/i.test(entity.name || '')) score += 20;

  try {
    const parsed = new URL(entity.websiteUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase();
    if (host === 'medicine.yale.edu' && /\/lab\//.test(path)) score += 60;
    if (/(?:^|\.)campuspress\.yale\.edu$/.test(host)) score += 45;
    if (/(?:^|\.)elisites\.yale\.edu$/.test(host)) score += 40;
    if (/(?:^|\.)github\.io$/.test(host)) score += 35;
    if (/(?:^|[.-])lab(?:[.-]|$)/.test(host) || /\/lab(?:\/|$)/.test(path)) score += 25;
    if (/^center-/.test(slug)) score -= 30;
    if (host === 'jackson.yale.edu') score -= 25;
    if (/\/centers?-initiatives?\//.test(path)) score -= 15;
  } catch {
    score -= 100;
  }

  if (name.includes('center') || name.includes('program') || name.includes('initiative')) {
    score -= 10;
  }

  return score;
}

export function selectDescriptionTargets(
  candidates: DescriptionCandidateEntity[],
  options: SelectDescriptionTargetsOptions,
): DescriptionCandidateEntity[] {
  const onlyFilter =
    options.only && options.only.length > 0
      ? new Set(options.only.map((slug) => slug.trim().toLowerCase()))
      : null;
  const offset =
    options.offset && Number.isFinite(options.offset) && options.offset > 0
      ? Math.floor(options.offset)
      : 0;
  const limit =
    options.limit && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : DEFAULT_LIMIT;

  const filtered = candidates
    .map((entity, index) => ({ entity, index }))
    .filter(({ entity }) => {
      if (!entity.slug) return false;
      if (isGeneratedFacultyResearchArea(entity)) return false;
      const existingFullRepair = canRepairShortFromExistingFullDescription(entity);
      if (!hasDescriptionFetchTarget(entity) && !existingFullRepair) return false;
      if (entity.archived) return false;
      if (onlyFilter && !onlyFilter.has(entity.slug.toLowerCase())) return false;
      if (onlyFilter) return true;
      return hasUnlockedDescriptionGap(entity);
    })
    .sort((a, b) => {
      const priorityDelta =
        descriptionTargetPriority(b.entity) - descriptionTargetPriority(a.entity);
      return priorityDelta || a.index - b.index;
    })
    .map(({ entity }) => entity);

  return filtered.slice(offset, offset + limit);
}

function shouldEmitDescriptionField(
  entity: DescriptionCandidateEntity,
  field: DescriptionField,
  value: string,
): boolean {
  if (!value) return false;
  if (descriptionFieldIsLocked(entity, field)) return false;
  const existingValue = cleanTextValue(
    field === 'fullDescription' ? entity.fullDescription : entity.shortDescription,
  );
  if (existingValue && existingValue !== cleanTextValue(value)) return true;
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription: field === 'fullDescription' ? entity.fullDescription : entity.fullDescription,
    shortDescription:
      field === 'shortDescription'
        ? entity.shortDescription
        : 'Temporary useful short description for full-description quality selection.',
  });
  if (field === 'fullDescription') {
    return !quality.full.isUseful || descriptionLooksWeak(entity.fullDescription);
  }
  return !quality.short.isUseful || descriptionLooksWeak(entity.shortDescription);
}

function shouldEmitResearchAreas(
  entity: DescriptionCandidateEntity,
  researchAreas: string[],
): boolean {
  if (researchAreas.length === 0) return false;
  if (descriptionFieldIsLocked(entity, 'researchAreas')) return false;
  return !Array.isArray(entity.researchAreas) || entity.researchAreas.length === 0;
}

function existingFullDescriptionShortObservations(
  entity: DescriptionCandidateEntity,
  sourceUrl: string,
  observedAt: Date = new Date(),
): ObservationInput[] {
  if (descriptionFieldIsLocked(entity, 'shortDescription')) return [];
  const existingQuality = assessResearchEntityDescriptionQuality({
    fullDescription: entity.fullDescription,
    shortDescription: entity.shortDescription,
  });
  if (existingQuality.short.isUseful && !descriptionLooksWeak(entity.shortDescription)) return [];
  const shortDescription = deriveShortDescriptionFromFullDescription(entity.fullDescription);
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription: entity.fullDescription,
    shortDescription,
  });
  if (!quality.full.isUseful || !quality.short.isUseful) return [];
  return [
    {
      entityType: 'researchEntity',
      entityKey: entity.slug,
      sourceUrl,
      field: 'shortDescription',
      value: shortDescription,
      confidenceOverride: DESCRIPTION_CONFIDENCE_OVERRIDE,
    },
    {
      entityType: 'researchEntity',
      entityKey: entity.slug,
      sourceUrl,
      field: 'lastObservedAt',
      value: observedAt,
    },
  ];
}

function existingDescriptionRepairSourceUrl(entity: DescriptionCandidateEntity): string {
  if (/^https?:/i.test(cleanTextValue(entity.websiteUrl))) return cleanTextValue(entity.websiteUrl);
  return (entity.sourceUrls || []).find((url) => /^https?:/i.test(cleanTextValue(url))) || '';
}

export function descriptionExtractionToObservations(
  entity: DescriptionCandidateEntity,
  sourceUrl: string,
  extraction: DescriptionLLMExtraction,
  observedAt: Date = new Date(),
  sourceText?: string,
): ObservationInput[] {
  const normalized = normalizeDescriptionExtraction(extraction, sourceText);
  if (entityDescriptionLooksMismatched(entity, normalized.fullDescription)) return [];
  const normalizedQuality = assessResearchEntityDescriptionQuality({
    fullDescription: normalized.fullDescription,
    shortDescription: normalized.shortDescription,
  });
  if (
    !normalizedQuality.full.isUseful ||
    !normalizedQuality.short.isUseful ||
    !sourceSupportsEvidenceQuote(normalized.evidenceQuote, sourceText) ||
    !evidenceQuoteSupportsDescription(normalized.evidenceQuote)
  ) {
    return [];
  }
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: entity.slug,
    sourceUrl,
  };
  const out: ObservationInput[] = [];

  if (shouldEmitDescriptionField(entity, 'fullDescription', normalized.fullDescription)) {
    out.push({
      ...base,
      field: 'fullDescription',
      value: normalized.fullDescription,
      confidenceOverride: DESCRIPTION_CONFIDENCE_OVERRIDE,
    });
  }
  if (shouldEmitDescriptionField(entity, 'shortDescription', normalized.shortDescription)) {
    out.push({
      ...base,
      field: 'shortDescription',
      value: normalized.shortDescription,
      confidenceOverride: DESCRIPTION_CONFIDENCE_OVERRIDE,
    });
  }
  if (shouldEmitResearchAreas(entity, normalized.researchAreas)) {
    out.push({
      ...base,
      field: 'researchAreas',
      value: normalized.researchAreas,
      confidenceOverride: DESCRIPTION_CONFIDENCE_OVERRIDE,
    });
  }

  if (out.length > 0) {
    out.push({
      ...base,
      field: 'lastObservedAt',
      value: observedAt,
    });
  }

  return out;
}

function descriptionReviewSample(
  entity: DescriptionCandidateEntity,
  sourceUrl: string,
  extraction: DescriptionLLMExtraction,
  sourceText: string,
): DescriptionReviewSample {
  const normalized = normalizeDescriptionExtraction(extraction, sourceText);
  const fullDescription = normalized.fullDescription;
  const shortDescription = normalized.shortDescription;
  const evidenceQuote = normalized.evidenceQuote || cleanTextValue(extraction.evidenceQuote, EVIDENCE_QUOTE_MAX_CHARS);
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription,
    shortDescription,
  });
  const quoteSupported = sourceSupportsEvidenceQuote(evidenceQuote, sourceText);
  const quoteSupportsDescription = evidenceQuoteSupportsDescription(evidenceQuote);
  const mismatched = entityDescriptionLooksMismatched(entity, fullDescription);
  const rejectionReasons = [
    ...quality.full.flags.map((flag) => `weak-full:${flag}`),
    ...quality.short.flags.map((flag) => `bad-short:${flag}`),
  ];
  if (mismatched) rejectionReasons.unshift('entity-description-mismatch');
  if (!quoteSupported) rejectionReasons.unshift('unsupported-evidence-quote');
  if (!quoteSupportsDescription) rejectionReasons.unshift('identity-only-evidence-quote');
  const accepted =
    quality.full.isUseful &&
    quality.short.isUseful &&
    quoteSupported &&
    quoteSupportsDescription &&
    !mismatched;

  return {
    slug: entity.slug,
    name: entity.name,
    sourceUrl,
    decision: accepted ? 'accepted' : 'rejected',
    fullDescription,
    shortDescription,
    evidenceQuote,
    rejectionReasons: Array.from(new Set(rejectionReasons)),
  };
}

function extractionNeedsLLMFallback(
  entity: DescriptionCandidateEntity,
  extraction: DescriptionLLMExtraction,
  sourceText: string,
): boolean {
  const normalized = normalizeDescriptionExtraction(extraction, sourceText);
  const fullNeedsRepair =
    !descriptionFieldIsLocked(entity, 'fullDescription') &&
    descriptionLooksWeak(entity.fullDescription);
  const shortNeedsRepair =
    !descriptionFieldIsLocked(entity, 'shortDescription') &&
    descriptionLooksWeak(entity.shortDescription);
  return (fullNeedsRepair && !normalized.fullDescription) ||
    (shortNeedsRepair && !normalized.shortDescription);
}

function normalizeCandidateUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function isExcludedDescriptionSubPageUrl(candidate: URL): boolean {
  return DESCRIPTION_SUBPAGE_PATH_EXCLUDE_RE.test(candidate.pathname);
}

export function discoverDescriptionSubPageUrls(
  html: string,
  pageUrl: string,
  maxUrls: number = MAX_CANDIDATE_SUBPAGE_URLS,
): string[] {
  if (!html || maxUrls <= 0) return [];
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return [];
  }

  const base = new URL(pageUrl);
  const baseHost = base.hostname.replace(/^www\./, '');
  const out: string[] = [];
  const seen = new Set<string>();

  $('a').each((_i, el) => {
    if (out.length >= maxUrls) return;
    const text = ($(el).text() || '').trim();
    const href = $(el).attr('href') || '';
    if (!text || !href || !DESCRIPTION_SUBPAGE_ANCHOR_RE.test(text)) return;
    try {
      const absolute = new URL(href, pageUrl);
      if (!/^https?:$/i.test(absolute.protocol)) return;
      if (absolute.hostname.replace(/^www\./, '') !== baseHost) return;
      if (!isWithinMicrositePath(base, absolute)) return;
      if (isExcludedDescriptionSubPageUrl(absolute)) return;
      const normalized = normalizeCandidateUrl(absolute.toString());
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    } catch {
      /* ignore malformed URLs */
    }
  });

  return out;
}

function discoverSameSiteFrameUrls(
  html: string,
  pageUrl: string,
  maxUrls: number = MAX_CANDIDATE_SUBPAGE_URLS,
): string[] {
  if (!html || maxUrls <= 0) return [];
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return [];
  }

  const base = new URL(pageUrl);
  const baseHost = base.hostname.replace(/^www\./, '');
  const out: string[] = [];
  const seen = new Set<string>();
  $('iframe,frame').each((_i, el) => {
    if (out.length >= maxUrls) return;
    const src = $(el).attr('src') || '';
    if (!src) return;
    try {
      const absolute = new URL(src, pageUrl);
      if (!/^https?:$/i.test(absolute.protocol)) return;
      if (absolute.hostname.replace(/^www\./, '') !== baseHost) return;
      if (!isWithinMicrositePath(base, absolute)) return;
      const normalized = normalizeCandidateUrl(absolute.toString());
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    } catch {
      /* ignore malformed frame URLs */
    }
  });
  return out;
}

export function candidateDescriptionCrawlUrls(
  homeHtml: string,
  homeUrl: string,
  maxUrls: number = MAX_CANDIDATE_SUBPAGE_URLS,
): string[] {
  if (maxUrls <= 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  let fallbackUrls: string[] = [];
  try {
    const url = new URL(homeUrl);
    const base = micrositeBaseUrl(url);
    fallbackUrls = DESCRIPTION_SUBPAGE_PATH_HINTS.map(
      (path) => `${base}${path.replace(/^\//, '')}`,
    );
  } catch {
    fallbackUrls = [];
  }

  for (const candidate of [
    ...discoverSameSiteFrameUrls(homeHtml, homeUrl, maxUrls),
    ...discoverDescriptionSubPageUrls(homeHtml, homeUrl, maxUrls),
    ...fallbackUrls,
  ]) {
    const normalized = normalizeCandidateUrl(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= maxUrls) break;
  }

  return out;
}

function micrositeBaseUrl(url: URL): string {
  const pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${pathname}`;
}

function isWithinMicrositePath(base: URL, candidate: URL): boolean {
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  if (basePath === '/') return true;
  return candidate.pathname === base.pathname || candidate.pathname.startsWith(basePath);
}

export function buildDescriptionLLMPrompt(
  entity: DescriptionCandidateEntity,
  homePage: PromptSourcePage,
  subPages: PromptSourcePage[],
): string {
  const parts = [
    `Research entity name: ${entity.name}`,
    `Entity slug: ${entity.slug}`,
    `Home page URL: ${homePage.url}`,
    '',
    '--- HOME PAGE TEXT ---',
    homePage.text || '(empty)',
  ];

  if (entity.fullDescription) {
    parts.push('', '--- CURRENT FULL DESCRIPTION ---', entity.fullDescription);
  }
  if (entity.shortDescription) {
    parts.push('', '--- CURRENT SHORT DESCRIPTION ---', entity.shortDescription);
  }
  if (entity.description) {
    parts.push('', '--- LEGACY DESCRIPTION FIELD ---', entity.description);
  }

  for (const page of subPages) {
    if (!page.url || !page.text) continue;
    parts.push('', `--- SUB-PAGE TEXT (${page.url}) ---`, page.text);
  }

  return parts.join('\n').slice(0, MAX_PROMPT_CHARS);
}

export function sourceUrlForDescriptionExtraction(
  homePage: PromptSourcePage,
  subPages: PromptSourcePage[],
  extraction: DescriptionLLMExtraction,
): string {
  const quote = normalizeDescriptionExtraction(extraction).evidenceQuote;
  if (quote) {
    const matchingSubPage = subPages.find(
      (page) => page.text.includes(quote) || sourceSupportsEvidenceQuote(quote, page.text),
    );
    if (matchingSubPage) return matchingSubPage.url;
    if (homePage.text.includes(quote) || sourceSupportsEvidenceQuote(quote, homePage.text)) {
      return homePage.url;
    }
  }
  return homePage.url;
}

export type CallDescriptionLLMFn = (input: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiKey: string;
}) => Promise<DescriptionLLMExtraction>;

export const defaultCallDescriptionLLM: CallDescriptionLLMFn = async ({
  model,
  systemPrompt,
  userPrompt,
  apiKey,
}) => {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: LAB_DESCRIPTION_RESPONSE_FORMAT,
      temperature: 0,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60_000,
    },
  );

  const content = res.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('LLM returned empty content');
  }

  try {
    return JSON.parse(content) as DescriptionLLMExtraction;
  } catch (err: any) {
    throw new Error(`LLM returned invalid JSON: ${err?.message || err}`);
  }
};

export type WorkPlanLoaderFn = (
  entity: DescriptionCandidateEntity,
  policy: WorkPlannerSourcePolicy,
  ctx: ScraperContext,
) => Promise<EntityWorkPlan>;

function usableDeterministicExtraction(
  entity: DescriptionCandidateEntity,
  page: FetchedPage,
  sourceText: string,
): DescriptionLLMExtraction | null {
  const extraction = descriptionExtractionFromHomePage(page);
  if (!extraction) return null;
  if (!normalizeDescriptionExtraction(extraction, sourceText).fullDescription) return null;
  if (extractionNeedsLLMFallback(entity, extraction, sourceText)) return null;
  return extraction;
}

export interface LabMicrositeDescriptionLLMExtractorDeps {
  fetchPage?: FetchPageFn;
  renderedFetcher?: RenderedFetcher | null;
  callLLM?: CallDescriptionLLMFn;
  workPlanLoader?: WorkPlanLoaderFn;
  entityFinder?: () => Promise<DescriptionCandidateEntity[]>;
  model?: string;
  apiKey?: string;
}

async function defaultWorkPlanLoader(
  entity: DescriptionCandidateEntity,
  policy: WorkPlannerSourcePolicy,
  _ctx: ScraperContext,
): Promise<EntityWorkPlan> {
  return loadEntityWorkPlan({
    entityType: policy.entityType,
    entityKey: entity.slug,
    sourceName: policy.sourceName,
    targetFields: policy.targetFields,
    manuallyLockedFields: entity.manuallyLockedFields,
    freshnessWindowMs: policy.freshnessWindowMs,
    now: new Date(),
  });
}

function descriptionHomeUrlFromWebsiteUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, '');
    if (/\/people\/(?:members|our-people)$/i.test(path)) {
      url.pathname = '/';
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    if (/\/members$/i.test(path)) {
      url.pathname = `${path.replace(/\/members$/i, '')}/`;
      url.search = '';
      url.hash = '';
      return url.toString();
    }
  } catch {
    return value;
  }
  return value;
}

function rawDescriptionWebsiteValues(doc: Record<string, any>): unknown[] {
  return [
    doc.websiteUrl,
    doc.website,
    ...(Array.isArray(doc.sourceUrls) ? doc.sourceUrls : []),
  ];
}

function isOfficialEngineeringFacultyProfileUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    return (
      host === 'engineering.yale.edu' &&
      /^\/research-and-faculty\/faculty-directory\/[^/]+$/.test(path) &&
      !/\/load_faculty(?:\/|$)/.test(path)
    );
  } catch {
    return false;
  }
}

function isOfficialEconomicsPeopleProfileUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    return host === 'economics.yale.edu' && /^\/people\/[^/?#]+$/.test(path);
  } catch {
    return false;
  }
}

function isOfficialSomFacultyProfileUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    return host === 'som.yale.edu' && /^\/faculty-research\/faculty-directory\/[^/?#]+$/.test(path);
  } catch {
    return false;
  }
}

function isOfficialYsmFacultyProfileUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    return host === 'medicine.yale.edu' && /^\/profile\/[^/?#]+$/.test(path);
  } catch {
    return false;
  }
}

function isOfficialProfileDescriptionUrl(value: string): boolean {
  return (
    isOfficialEngineeringFacultyProfileUrl(value) ||
    isOfficialEconomicsPeopleProfileUrl(value) ||
    isOfficialSomFacultyProfileUrl(value) ||
    isOfficialYsmFacultyProfileUrl(value)
  );
}

function personSlugFromEntity(entity: Pick<DescriptionCandidateEntity, 'slug' | 'name'>): string {
  const fromSlug = cleanTextValue(entity.slug)
    .replace(/^dept-[^-]+-/i, '')
    .replace(/^ysm-/i, '')
    .replace(/^faculty-research-area-/i, '')
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  if (fromSlug) return fromSlug;

  return cleanTextValue(entity.name)
    .replace(/\b(?:Lab|Research)\b.*$/i, '')
    .replace(/[—–-]\s*Research\b.*$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function generatedOfficialProfileUrls(entity: DescriptionCandidateEntity): string[] {
  const personSlug = personSlugFromEntity(entity);
  if (!personSlug) return [];
  const slug = (entity.slug || '').toLowerCase();
  const out: string[] = [];
  if (slug.startsWith('dept-econ-')) {
    out.push(`https://economics.yale.edu/people/${personSlug}`);
    out.push(`https://som.yale.edu/faculty-research/faculty-directory/${personSlug}`);
  }
  if (slug.startsWith('dept-cs-') || slug.startsWith('dept-seas-')) {
    out.push(`https://engineering.yale.edu/research-and-faculty/faculty-directory/${personSlug}`);
  }
  return out;
}

function isDescriptionResearchHomeUrl(value: unknown): value is string {
  if (!isUsableResearchWebsiteUrl(value)) return false;
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    if (host === 'medicine.yale.edu' && path === '/labmed') return false;
    if (/^\/people(?:\/|$)/.test(path)) return false;
    if (/(?:^|\/)profile(?:\/|$)/.test(path)) return false;
    if (/\/people\/faculty(?:-|\/|$)/.test(path)) return false;
    if (/^\/academic-study\/departments\/[^/]+\/faculty\/load_faculty(?:\/|$)/.test(path)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function usableDescriptionWebsiteUrlFromDoc(doc: Record<string, any>): string {
  const seen = new Set<string>();
  for (const rawValue of rawDescriptionWebsiteValues(doc)) {
    if (typeof rawValue !== 'string') continue;
    const websiteUrl = descriptionHomeUrlFromWebsiteUrl(rawValue).trim();
    if (!websiteUrl || seen.has(websiteUrl)) continue;
    seen.add(websiteUrl);
    if (isDescriptionResearchHomeUrl(websiteUrl)) return websiteUrl;
  }
  const officialProfile = (Array.isArray(doc.sourceUrls) ? doc.sourceUrls : [])
    .filter((url): url is string => typeof url === 'string')
    .find(isOfficialProfileDescriptionUrl);
  if (officialProfile) return officialProfile;
  return '';
}

export function descriptionCandidateFromResearchEntityDoc(
  doc: Record<string, any>,
): DescriptionCandidateEntity {
  return {
    _id: doc._id,
    slug: doc.slug,
    name: doc.name,
    websiteUrl: usableDescriptionWebsiteUrlFromDoc(doc),
    sourceUrls: Array.isArray(doc.sourceUrls) ? doc.sourceUrls.filter((url) => typeof url === 'string') : [],
    archived: !!doc.archived,
    manuallyLockedFields: doc.manuallyLockedFields || [],
    description: doc.description || '',
    fullDescription: doc.fullDescription || '',
    shortDescription: doc.shortDescription || '',
    researchAreas: Array.isArray(doc.researchAreas) ? doc.researchAreas : [],
  };
}

export function candidateDescriptionSupplementalUrls(
  entity: DescriptionCandidateEntity,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const primary = normalizeCandidateUrl(entity.websiteUrl || '');
  if (primary) seen.add(primary);

  for (const sourceUrl of entity.sourceUrls || []) {
    if (
      !isOfficialProfileDescriptionUrl(sourceUrl)
    ) {
      continue;
    }
    const normalized = normalizeCandidateUrl(sourceUrl);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  for (const generatedUrl of generatedOfficialProfileUrls(entity)) {
    const normalized = normalizeCandidateUrl(generatedUrl);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

async function defaultEntityFinder(): Promise<DescriptionCandidateEntity[]> {
  const docs = await ResearchEntity.find(
    {
      archived: { $ne: true },
      $or: [
        { websiteUrl: { $exists: true, $ne: '' } },
        { website: { $exists: true, $ne: '' } },
        { sourceUrls: /^https?:\/\//i },
      ],
    },
    {
      _id: 1,
      slug: 1,
      name: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      archived: 1,
      manuallyLockedFields: 1,
      description: 1,
      fullDescription: 1,
      shortDescription: 1,
      researchAreas: 1,
    },
  ).lean();
  return (docs as any[]).map(descriptionCandidateFromResearchEntityDoc);
}

export class LabMicrositeDescriptionLLMExtractor implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'Lab microsite LLM (research descriptions)';

  private readonly fetchPage: FetchPageFn;
  private readonly renderedFetcher: RenderedFetcher | null;
  private readonly callLLM: CallDescriptionLLMFn;
  private readonly workPlanLoader: WorkPlanLoaderFn;
  private readonly entityFinder: () => Promise<DescriptionCandidateEntity[]>;
  private readonly model: string;
  private readonly apiKey: string | undefined;

  constructor(deps: LabMicrositeDescriptionLLMExtractorDeps = {}) {
    this.fetchPage = deps.fetchPage ?? defaultFetchPage;
    this.renderedFetcher = deps.renderedFetcher ?? createScraplingRenderedFetcher();
    this.callLLM = deps.callLLM ?? defaultCallDescriptionLLM;
    this.workPlanLoader = deps.workPlanLoader ?? defaultWorkPlanLoader;
    this.entityFinder = deps.entityFinder ?? defaultEntityFinder;
    this.model = deps.model ?? DEFAULT_MODEL;
    this.apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    if (!this.apiKey) {
      ctx.log(
        'OPENAI_API_KEY missing - cannot run LLM description extraction; emitting zero observations.',
      );
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes: 'OPENAI_API_KEY missing',
      };
    }

    const candidates = await this.entityFinder();
    const targets = selectDescriptionTargets(candidates, {
      only: ctx.options.only,
      limit: ctx.options.limit,
      offset: ctx.options.offset,
    });
    ctx.log(
      `Processing ${targets.length} description targets (eligible=${candidates.length}, offset=${ctx.options.offset ?? 0}, limit=${ctx.options.limit ?? DEFAULT_LIMIT}, only=${(ctx.options.only || []).join(',') || 'none'})`,
    );

    let totalObs = 0;
    let processed = 0;
    let succeeded = 0;
    let fetchFailed = 0;
    let llmFailed = 0;
    const fetchAttempts: ScraperFetchMetric[] = [];
    const workPlannerPolicy = ctx.options.ignoreWorkPlanner
      ? undefined
      : getWorkPlannerSourcePolicy(this.name);
    const workPlannerMetrics = createWorkPlannerMetrics();
    const descriptionReviewSamples: DescriptionReviewSample[] = [];

    for (const entity of targets) {
      processed++;
      if (workPlannerPolicy) {
        if (!entity.slug) {
          recordWorkPlannerNoIdentifier(workPlannerMetrics);
          ctx.log(`[${entity.name}] skipped by WorkPlanner - missing slug/entity key.`);
          continue;
        }
        const plan = await this.workPlanLoader(entity, workPlannerPolicy, ctx);
        recordWorkPlannerDecision(workPlannerMetrics, plan);
        if (!plan.shouldFetch) {
          const reasons = Array.from(new Set(plan.fields.map((field) => field.reason))).join(',');
          ctx.log(`[${entity.slug}] skipped by WorkPlanner - ${reasons || 'fresh'}.`);
          continue;
        }
      }

      const existingShortObservations = existingFullDescriptionShortObservations(
        entity,
        existingDescriptionRepairSourceUrl(entity),
        new Date(),
      );
      if (existingShortObservations.length > 0) {
        await ctx.emit(existingShortObservations);
        totalObs += existingShortObservations.length;
        succeeded++;
        if (processed % 25 === 0 || processed === targets.length) {
          ctx.log(
            `progress: ${processed}/${targets.length} targets | ${succeeded} ok | ${fetchFailed} fetch-failed | ${llmFailed} llm-failed | ${totalObs} obs`,
          );
        }
        continue;
      }

      const measuredHomePage = await measureRenderedFetch(
        entity.websiteUrl,
        'http',
        () => this.fetchPage(entity.websiteUrl),
      );
      fetchAttempts.push(measuredHomePage.metric);
      let homePage: FetchedPage | null = measuredHomePage.result;
      if (!homePage || htmlToPromptText(homePage.html).length < 200) {
        const rendered = await measureRenderedFetch(
          entity.websiteUrl,
          'scrapling',
          () =>
            fetchRenderedDescriptionPage(
              ctx.options.useCache,
              entity.websiteUrl,
              this.renderedFetcher,
            ),
          { selectorName: 'body' },
        );
        fetchAttempts.push(rendered.metric);
        if (rendered.result?.html) {
          homePage = {
            url: rendered.result.url || entity.websiteUrl,
            html: rendered.result.html,
          };
        }
      }
      if (!homePage) {
        for (const fallbackUrl of candidateDescriptionSupplementalUrls(entity)) {
          const measuredFallback = await measureRenderedFetch(
            fallbackUrl,
            'http',
            () => this.fetchPage(fallbackUrl),
          );
          fetchAttempts.push(measuredFallback.metric);
          if (measuredFallback.result?.html && htmlToPromptText(measuredFallback.result.html).length >= 200) {
            homePage = measuredFallback.result;
            break;
          }
        }
        if (!homePage) {
          fetchFailed++;
          continue;
        }
      }

      const homeText = htmlToPromptText(homePage.html);
      const subPages: PromptSourcePage[] = [];
      const fetchedSourcePages: FetchedPage[] = [homePage];
      const seenSourceUrls = new Set<string>([normalizeCandidateUrl(homePage.url)].filter(Boolean));
      const supplementalUrls = candidateDescriptionSupplementalUrls(entity);
      const crawlUrls = candidateDescriptionCrawlUrls(homePage.html, homePage.url);
      for (const candidate of [...crawlUrls, ...supplementalUrls]) {
        if (subPages.length >= MAX_SUBPAGES_FETCHED) break;
        const normalizedCandidate = normalizeCandidateUrl(candidate);
        if (!normalizedCandidate || seenSourceUrls.has(normalizedCandidate)) continue;
        seenSourceUrls.add(normalizedCandidate);
        const measuredSubPage = await measureRenderedFetch(
          candidate,
          'http',
          () => this.fetchPage(candidate),
        );
        fetchAttempts.push(measuredSubPage.metric);
        const fetched = measuredSubPage.result;
        if (!fetched) continue;
        const text = htmlToPromptText(fetched.html);
        if (!text) continue;
        fetchedSourcePages.push(fetched);
        subPages.push({ url: fetched.url, text });
      }

      const homePromptPage = { url: homePage.url, text: homeText };
      const userPrompt = buildDescriptionLLMPrompt(entity, homePromptPage, subPages);
      const sourceTextForEvidence = [homeText, ...subPages.map((page) => page.text)]
        .filter(Boolean)
        .join('\n');
      const cacheKey = `llm:${this.model}:${entity.websiteUrl}`;

      const deterministicExtractions = fetchedSourcePages
        .map((page) => descriptionExtractionFromHomePage(page))
        .filter((candidate): candidate is DescriptionLLMExtraction => !!candidate);
      const partialDeterministicExtraction = deterministicExtractions.find(
        (candidate) => normalizeDescriptionExtraction(candidate, sourceTextForEvidence).fullDescription,
      ) || null;
      const deterministicExtraction =
        fetchedSourcePages
          .map((page) => usableDeterministicExtraction(entity, page, sourceTextForEvidence))
          .find((candidate): candidate is DescriptionLLMExtraction => !!candidate) ||
        partialDeterministicExtraction ||
        descriptionExtractionFromHomePage(homePage);
      let extraction: DescriptionLLMExtraction | null = deterministicExtraction;
      if (deterministicExtraction && extractionNeedsLLMFallback(entity, deterministicExtraction, sourceTextForEvidence)) {
        extraction = null;
      }
      if (ctx.options.useCache) {
        try {
          const cached = await getCached<DescriptionLLMExtraction>(SOURCE_KEY, cacheKey);
          if (cached) extraction = cached;
        } catch {
          /* ignore cache errors */
        }
      }

      if (!extraction) {
        try {
          extraction = await this.callLLM({
            model: this.model,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt,
            apiKey: this.apiKey,
          });
        } catch (err: any) {
          ctx.log(
            `[${entity.slug}] LLM description call failed: ${err?.message || err}; skipping.`,
          );
          llmFailed++;
          continue;
        }

        if (ctx.options.useCache && extraction) {
          try {
            await setCached(SOURCE_KEY, cacheKey, extraction);
          } catch {
            /* ignore cache errors */
          }
        }
      }
      if (
        (deterministicExtraction || partialDeterministicExtraction) &&
        extraction &&
        !normalizeDescriptionExtraction(extraction, sourceTextForEvidence).fullDescription &&
        normalizeDescriptionExtraction(
          deterministicExtraction || partialDeterministicExtraction!,
          sourceTextForEvidence,
        ).fullDescription
      ) {
        extraction = deterministicExtraction || partialDeterministicExtraction;
      }
      if (!extraction) {
        llmFailed++;
        continue;
      }

      const sourceUrl = sourceUrlForDescriptionExtraction(
        homePromptPage,
        subPages,
        extraction,
      );
      if (descriptionReviewSamples.length < MAX_DESCRIPTION_REVIEW_SAMPLES) {
        descriptionReviewSamples.push(
          descriptionReviewSample(entity, sourceUrl, extraction, sourceTextForEvidence),
        );
      }
      const observations = descriptionExtractionToObservations(
        entity,
        sourceUrl,
        extraction,
        new Date(),
        sourceTextForEvidence,
      );
      if (observations.length > 0) {
        await ctx.emit(observations);
        totalObs += observations.length;
      }
      succeeded++;

      if (processed % 25 === 0 || processed === targets.length) {
        ctx.log(
          `progress: ${processed}/${targets.length} targets | ${succeeded} ok | ${fetchFailed} fetch-failed | ${llmFailed} llm-failed | ${totalObs} obs`,
        );
      }
    }

    ctx.log(
      `Done. processed=${processed}, succeeded=${succeeded}, fetchFailed=${fetchFailed}, llmFailed=${llmFailed}, observations=${totalObs}`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: succeeded,
      notes: `LLM-extracted research descriptions for ${succeeded}/${processed} entities (${fetchFailed} fetch-failed, ${llmFailed} llm-failed, ${workPlannerMetrics.skippedFresh + workPlannerMetrics.skippedManualLock} workplanner-skipped)`,
      metrics: {
        workPlanner: workPlannerMetrics,
        descriptionReviewSamples,
      },
      fetchMetrics: summarizeFetchMetrics(fetchAttempts),
    };
  }
}

async function fetchRenderedDescriptionPage(
  useCache: boolean,
  url: string,
  renderedFetcher: RenderedFetcher | null,
): Promise<RenderedFetchResult | null> {
  if (!renderedFetcher) return null;
  const cacheKey = `rendered-page:v1:${url}`;
  if (useCache) {
    const cached = await getCached<RenderedFetchResult>(SOURCE_KEY, cacheKey);
    if (cached) return cached;
  }
  const result = await renderedFetcher({
    url,
    waitSelector: 'body',
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (useCache && result?.html) await setCached(SOURCE_KEY, cacheKey, result);
  return result;
}
