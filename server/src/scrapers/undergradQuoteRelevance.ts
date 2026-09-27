import { laneQuoteStatesUndergraduates } from './undergradEvidenceQuoteValidation';
import {
  isPersonProfileOrDirectoryUrl,
  isUmbrellaPageCitedByPerson,
  type ResearchEntityHostOwnerIdentity,
} from '../utils/researchHomeWebsiteUrl';

const NON_ACCESS_UNDERGRADUATE_SPANS: readonly RegExp[] = [
  /\b(?:co-?)?(?:teach(?:es|ing)?|taught|instructs?|lectur(?:es|ing))\b[^.;]{0,100}?\bundergrad(?:uate)?s?\b(?:[^.;]{0,60}?\b(?:courses?|classes|seminars?|surveys?|lectures?|curriculum|students?|levels?))?/gi,
  /\b(?:courses?(?:\s+and\s+seminars?)?|course\s+type)\s*:?\s*undergrad(?:uate)?\b[^.;]*/gi,
  /\bundergrad(?:uate)?\s+(?:and\s+graduate\s+)?(?:courses?|teaching|classes|seminars?|curriculum|lectures?)\b[^.;]*/gi,
  /\b(?:(?:associate|assistant|deputy|co-)\s*)?(?:director|dean|registrar|chair)\s+of\s+(?:[\w&,]+\s+){0,6}?undergrad(?:uate)?\s+(?:studies|education|research|affairs|admissions|programs?|curriculum)\b/gi,
  /\bundergrad(?:uate)?\s+(?:major|majors|programs?|degrees?|curriculum|concentrations?|certificates?|admissions?)\b/gi,
  /(?<!\b(?:his|her|their|my|during)\s+)\bundergrad(?:uate)?\s+(?:studies|education)\b/gi,
  /\b(?:his|her|their|my)\s+undergrad(?:uate)?\s+(?:degree|education|training)\b[^.;]*/gi,
];

export function quoteStatesAnUndergraduateAccessFact(quote: string | undefined | null): boolean {
  let rest = (quote || '').trim();
  for (const span of NON_ACCESS_UNDERGRADUATE_SPANS) rest = rest.replace(span, ' ');
  return laneQuoteStatesUndergraduates(rest.replace(/\s+/g, ' ').trim());
}

const LAB_HOST_LABEL = /(?:lab|labs|group|project)/i;

const DEPARTMENT_AUDIENCE_PATH_SEGMENT =
  /^(?:undergrad(?:uate)?s?|diversity|academics|admissions|opportunit(?:y|ies)|[\w-]*-opportunit(?:y|ies)(?:-[\w-]+)?|jobs?|employment|careers?|scholarship-and-funding|funding|fellowships?|resources|search|directory|courses)$/i;

const OWN_PAGE_PATH_SEGMENT = /^(?:lab|labs|homes|~[\w.-]+)$|lab-members/i;

interface PageLocation {
  host: string;
  path: string;
  segments: string[];
}

function pageLocation(value: unknown): PageLocation | null {
  try {
    const url = new URL(String(value || ''));
    const path = url.pathname.replace(/\/+$/, '');
    return {
      host: url.hostname.toLowerCase().replace(/^www\./, ''),
      path,
      segments: path.split('/').filter(Boolean),
    };
  } catch {
    return null;
  }
}

function isUnderOwnSite(page: PageLocation, websiteUrl: unknown): boolean {
  const own = pageLocation(websiteUrl);
  return Boolean(own && own.host === page.host && `${page.path}/`.startsWith(`${own.path}/`));
}

export type QuotePageEntity = ResearchEntityHostOwnerIdentity & { websiteUrl?: unknown };

export function quotePageIsAboutAnotherEntity(
  sourceUrl: unknown,
  entity: QuotePageEntity | null | undefined,
): boolean {
  const page = pageLocation(sourceUrl);
  if (!page || !entity) return false;
  if (isUnderOwnSite(page, entity.websiteUrl)) return false;
  if (isUmbrellaPageCitedByPerson(sourceUrl, entity)) return true;
  const labels = page.host.split('.');
  if (labels.length !== 3 || labels[1] !== 'yale' || labels[2] !== 'edu') return false;
  if (LAB_HOST_LABEL.test(labels[0])) return false;
  if (isPersonProfileOrDirectoryUrl(sourceUrl)) return false;
  if (page.segments.some((segment) => OWN_PAGE_PATH_SEGMENT.test(segment))) return false;
  return page.segments.some((segment) => DEPARTMENT_AUDIENCE_PATH_SEGMENT.test(segment));
}
