import { researchEntityHasDeceasedLead } from './researchEntityDeceasedLead';

const MARKER_SCAN_WINDOW = 200;
const MIN_HUMAN_LIFESPAN_YEARS = 15;
const MAX_HUMAN_LIFESPAN_YEARS = 120;
const NAME_LIFESPAN_ANYWHERE_RE =
  /((?:18|19|20)\d{2})\s*[-‒–—―−]\s*((?:19|20)\d{2})/;

const EMERITUS_URL_PATH_RE = /\bemeritus\b|\bemerita\b/i;
const EMERITUS_TEXT_RE = /\bprofessors?\s+emeritus\b|\bprofessors?\s+emerita\b|\bemeritus\b|\bemerita\b/i;

const IN_MEMORIAM_URL_PATH_RE = /\bin-memoriam\b|\bobituar(?:y|ies)\b/i;
const IN_MEMORIAM_TEXT_RE = /\bin memoriam\b|\bpassed away\b/i;

export type ResearchEntityYaleStatusReason = 'deceased' | 'emeritus';

export interface ResearchEntityYaleStatusSignal {
  yaleStatusCache: 'departed';
  activeAtYaleCache: false;
  reason: ResearchEntityYaleStatusReason;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sourceUrlPaths(entity: Record<string, any>): string[] {
  const sourceUrls = Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [];
  const websiteUrl = textValue(entity.websiteUrl);
  return [...sourceUrls, websiteUrl].filter((value): value is string => typeof value === 'string');
}

function descriptionOpenings(entity: Record<string, any>): string[] {
  return [entity.fullDescription, entity.shortDescription, entity.profileSynthesisDescription]
    .map(textValue)
    .filter(Boolean)
    .map((text) => text.replace(/\s+/g, ' ').trim().slice(0, MARKER_SCAN_WINDOW));
}

function anyUrlMatches(urls: string[], pattern: RegExp): boolean {
  return urls.some((url) => pattern.test(url));
}

function anyOpeningMatches(openings: string[], pattern: RegExp): boolean {
  return openings.some((opening) => pattern.test(opening));
}

function nameCarriesLifespanAnywhere(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const match = name.match(NAME_LIFESPAN_ANYWHERE_RE);
  if (!match) return false;
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  const span = endYear - startYear;
  return (
    span >= MIN_HUMAN_LIFESPAN_YEARS &&
    span <= MAX_HUMAN_LIFESPAN_YEARS &&
    endYear <= new Date().getUTCFullYear()
  );
}

function hasInMemoriamMarker(entity: Record<string, any>): boolean {
  return (
    anyUrlMatches(sourceUrlPaths(entity), IN_MEMORIAM_URL_PATH_RE) ||
    anyOpeningMatches(descriptionOpenings(entity), IN_MEMORIAM_TEXT_RE) ||
    nameCarriesLifespanAnywhere(entity.name) ||
    nameCarriesLifespanAnywhere(entity.displayName)
  );
}

function hasEmeritusMarker(entity: Record<string, any>): boolean {
  return (
    anyUrlMatches(sourceUrlPaths(entity), EMERITUS_URL_PATH_RE) ||
    anyOpeningMatches(descriptionOpenings(entity), EMERITUS_TEXT_RE)
  );
}

export function deriveResearchEntityYaleStatus(
  entity: Record<string, any> | null | undefined,
): ResearchEntityYaleStatusSignal | null {
  if (!entity) return null;
  if (researchEntityHasDeceasedLead(entity) || hasInMemoriamMarker(entity)) {
    return { yaleStatusCache: 'departed', activeAtYaleCache: false, reason: 'deceased' };
  }
  if (hasEmeritusMarker(entity)) {
    return { yaleStatusCache: 'departed', activeAtYaleCache: false, reason: 'emeritus' };
  }
  return null;
}
