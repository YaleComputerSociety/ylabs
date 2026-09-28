import {
  laneQuoteStatesUndergraduates,
  namesAnUndergraduateMarker,
} from './undergradEvidenceQuoteValidation';
import {
  isPersonProfileOrDirectoryUrl,
  isUmbrellaPageCitedByPerson,
  type ResearchEntityHostOwnerIdentity,
} from '../utils/researchHomeWebsiteUrl';

const NON_ACCESS_UNDERGRADUATE_SPANS: readonly RegExp[] = [
  /\b(?:co-?)?(?:teach(?:es|ing)?|taught|instructs?|lectur(?:es|ing))(?:\s+(?!(?:and|or|but)\b)[\w-]+){0,4}?\s+undergrad(?:uate)?s?\b(?:(?:\s+(?!undergrad)[\w-]+){0,5}?\s+(?:courses?|classes|seminars?|surveys?|lectures?|curriculum|students?|levels?)\b)?/gi,
  /\b(?:courses?(?:\s+and\s+seminars?)?|course\s+type)\s*:?\s*undergrad(?:uate)?\b/gi,
  /\bundergrad(?:uate)?\s+(?:(?:and|or|&)\s+(?:[a-z-]+\s+)?)?(?:courses?|teaching|classes|seminars?|curriculum|lectures?)\b(?!\s+credit)/gi,
  /\b(?:(?:associate|assistant|deputy|co-)\s*)?(?:director|dean|registrar|chair)\s+of\s+(?:[\w&,]+\s+){0,6}?undergrad(?:uate)?\s+(?:studies|education|research|affairs|admissions|programs?|curriculum)\b/gi,
  /\bundergrad(?:uate)?\s+(?:major|programs?|degree(?!s)|curriculum|concentrations?|certificates?|admissions?)\b/gi,
  /(?<!\b(?:his|her|their|my|during)\s+)\bundergrad(?:uate)?\s+(?:studies|education)\b/gi,
  /(?<!\bduring\s+)\b(?:his|her|their|my)\s+undergrad(?:uate)?\s+(?:degree|education|training|studies)\b/gi,
];

const withoutNonAccessSpans = (text: string | undefined | null): string => {
  let rest = (text || '').trim();
  for (const span of NON_ACCESS_UNDERGRADUATE_SPANS) rest = rest.replace(span, ' ');
  return rest.replace(/\s+/g, ' ').trim();
};

export function quoteStatesAnUndergraduateAccessFact(quote: string | undefined | null): boolean {
  return laneQuoteStatesUndergraduates(withoutNonAccessSpans(quote));
}

const NON_UNDERGRADUATE_ROSTER_ROLE =
  /\b(?:(?:senior|junior|lead|principal|staff|chief)\s+)?(?:(?:software|research|data|lab(?:oratory)?|administrative|project|clinical|program)\s+)?(?:developer|engineer|scientist|administrator|manager|technician|analyst|coordinator|director)\b|\b(?:post-?docs?|postdoctoral|ph\.?\s?d\.?(?:\s+(?:student|candidate))?|graduate\s+students?|grad\s+students?|doctoral|faculty|professor|resident|lecturer|instructor|master'?s(?:\s+(?:students?|candidates?))?|m\.?s\.?\s+(?:students?|candidates?)|m\.?p\.?h\.?|m\.d\.|md(?:\s+(?:students?|candidates?)|[-/]ph\.?d)|medical\s+students?|rotation(?:\s+students?)?|rotating\s+students?|research\s+associates?|fellows?)\b/i;

const UNDERGRADUATE_OWN_ROSTER_ROLE =
  /\b(?:undergrad(?:uate)?|yale\s+college|summer|SURF|STARS)\s+(?:(?:research|lab(?:oratory)?|summer|student)\s+){0,2}(?:fellows?|interns?|associates?|assistants?|technicians?|researchers?|scholars?|students?)\b/gi;

/**
 * Whether a roster line may be a current undergraduate (#3789). The line is read under a
 * section heading the model chose, so a bare name counts: a roster lists names, not claims. A
 * line is refused when it names a non-undergraduate role or a staff title outside the member's
 * own undergraduate role phrase, as in "Undergraduate Research Fellow", so a graduate student
 * who mentors undergraduates is not counted. A line naming the member's own past degree is
 * refused unless an undergraduate marker survives beside it. On the gold benchmark an
 * allow-list read dropped 12 of 20 real roster lines.
 */
export function rosterSnippetNamesAnUndergraduate(snippet: string | undefined | null): boolean {
  const raw = (snippet || '').trim();
  if (!raw) return false;
  if (NON_UNDERGRADUATE_ROSTER_ROLE.test(raw.replace(UNDERGRADUATE_OWN_ROSTER_ROLE, ' '))) {
    return false;
  }
  const rest = withoutNonAccessSpans(raw);
  return namesAnUndergraduateMarker(rest) || rest === raw.replace(/\s+/g, ' ');
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
