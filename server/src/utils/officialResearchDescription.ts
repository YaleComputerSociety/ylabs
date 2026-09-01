import * as cheerio from 'cheerio';
import {
  deriveShortDescriptionFromFullDescription,
  shortDescriptionQuality,
} from './researchEntityDescriptionQuality';
import {
  selectResearchHomeDescription,
  type DescriptionEntityKind,
} from './researchHomeDescriptionSelection';
import { extractElementTextWithBlockSeparators } from '../scrapers/utils/htmlText';

export interface OfficialResearchDescription {
  fullDescription: string;
  shortDescription: string;
}

export interface ExtractOfficialResearchDescriptionOptions {
  kind?: DescriptionEntityKind;
  minLength?: number;
}

const MAX_CANDIDATE_LENGTH = 2400;
const CONTENT_BLOCK_SELECTORS = [
  'main',
  'article',
  '[role="main"]',
  'section',
  '[class*="about" i]',
  '[id*="about" i]',
  '[class*="mission" i]',
  '[class*="overview" i]',
  '[class*="intro" i]',
  '[class*="welcome" i]',
];

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function truncateToBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const slice = value.slice(0, maxLength);
  const lastSentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  );
  if (lastSentenceEnd >= maxLength / 2) {
    return slice.slice(0, lastSentenceEnd + 1).trim();
  }
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
}

const sentenceCount = (value: string): number =>
  value.split(/[.!?](?:\s|$)/u).filter((part) => part.trim().length > 0).length;

function jsonLdDescriptions($: cheerio.CheerioAPI): string[] {
  const descriptions: string[] = [];
  const visit = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    descriptions.push(clean(record.description));
    visit(record['@graph']);
    visit(record.mainEntity);
  };
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      visit(JSON.parse($(el).contents().text()));
    } catch {
      /* Ignore malformed embedded metadata. */
    }
  });
  return descriptions.filter(Boolean);
}

export function collectVisibleDescriptionCandidates(html: string): string[] {
  const $ = cheerio.load(html);
  const structuredDescriptions = jsonLdDescriptions($);
  $('script, style, noscript, svg, iframe, nav, header, footer, aside, form, button').remove();

  const candidates: string[] = [
    ...structuredDescriptions,
    clean($('meta[property="og:description"]').attr('content')),
    clean($('meta[name="description"]').attr('content')),
  ];

  for (const selector of CONTENT_BLOCK_SELECTORS) {
    $(selector)
      .toArray()
      .forEach((el) => {
        const paragraphs = $(el)
          .find('p')
          .toArray()
          .map((p) => clean($(p).text()))
          .filter((text) => text.length >= 40);
        if (paragraphs.length > 0) {
          candidates.push(truncateToBoundary(paragraphs.join(' '), MAX_CANDIDATE_LENGTH));
          candidates.push(
            ...paragraphs.map((text) => truncateToBoundary(text, MAX_CANDIDATE_LENGTH)),
          );
        }
        const blockText = clean(extractElementTextWithBlockSeparators(el));
        if (blockText && sentenceCount(blockText) >= 2) {
          candidates.push(truncateToBoundary(blockText, MAX_CANDIDATE_LENGTH));
        }
      });
  }

  $('p')
    .toArray()
    .forEach((p) => {
      const text = clean($(p).text());
      if (text.length >= 40) candidates.push(truncateToBoundary(text, MAX_CANDIDATE_LENGTH));
    });

  return candidates.filter(Boolean);
}

export function extractOfficialResearchDescription(
  html: string,
  options: ExtractOfficialResearchDescriptionOptions = {},
): OfficialResearchDescription | null {
  const candidates = collectVisibleDescriptionCandidates(html);
  const fullDescription = selectResearchHomeDescription(candidates, {
    kind: options.kind ?? 'organization',
    minLength: options.minLength,
  });
  if (!fullDescription) return null;

  const $ = cheerio.load(html);
  const metaShort = clean(
    $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content'),
  );
  const derivedShort = deriveShortDescriptionFromFullDescription(fullDescription);
  const shortCandidates = [derivedShort, metaShort].filter(Boolean);
  const shortDescription =
    shortCandidates.find(
      (candidate) => shortDescriptionQuality(candidate, fullDescription).isUseful,
    ) || '';

  return { fullDescription, shortDescription };
}

function normalizeForGrounding(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isDescriptionGroundedInSource(candidate: unknown, sourceText: unknown): boolean {
  const normalizedCandidate = normalizeForGrounding(clean(candidate));
  const normalizedSource = normalizeForGrounding(clean(sourceText));
  if (!normalizedCandidate || !normalizedSource) return false;
  if (normalizedSource.includes(normalizedCandidate)) return true;

  const sentences = clean(candidate)
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => normalizeForGrounding(sentence))
    .filter((sentence) => sentence.split(' ').filter(Boolean).length >= 4);
  if (sentences.length === 0) return false;
  return sentences.every((sentence) => normalizedSource.includes(sentence));
}
