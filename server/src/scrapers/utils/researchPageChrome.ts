import { isCitationAuthorListDumpText } from '../../utils/descriptionHygiene';
import { foldWriterTextForms } from './writerEvidenceText';

const SKIP_LINK =
  /\bskip to (?:the )?(?:main |primary )?(?:main site |site )?(?:content|navigation|search|main content)\b/gi;

const NAVIGATION_LABEL = new RegExp(
  [
    'main menu',
    'sub ?menu',
    'quick links',
    'search this site',
    'all news',
    'all events',
    'see all\\b[^.!?]*',
    'log ?in(?: required)?',
    'sign (?:in|up)',
    'su(?:b)?scribe',
    'newsletter',
    'follow us',
    'terms(?:,| and| &)? privacy',
    'privacy (?:policy|notice)',
    'careers',
    'career (?:outcomes|faqs?|management|mentorship|services|cent(?:er|re)|opportunities|networking)',
    'open positions',
    'job openings?',
    'apply now',
    'give now',
    'make a gift',
    'donat(?:e|ion|ions|ing)',
    'support (?:our|the) (?:students|faculty|mission|research|work|lab|school)',
    'cookies? (?:disabled|policy|settings|preferences|notice)',
  ]
    .map((label) => `\\b${label}\\b`)
    .join('|'),
  'i',
);

const JOB_ADVERTISEMENT_TITLE =
  /^(?:(?:post(?:doctoral|graduate)|research|staff|policy|project|program|faculty)\s+)?(?:associate|fellow|scientist|assistant|coordinator|manager|analyst)s?\b(?:\s+position)?(?:\s*\([^)]*\))?(?:,\s*[^-]+)?\s+-\s+\S|^post(?:doctoral|graduate)\s+(?:associate|fellow)\s+in\s+\S/i;

const HIRING_SENTENCE = /\b(?:we are|we're|is|are|now) hiring\b|\bjob openings?\b/i;

const DONATION_APPEAL_SENTENCE =
  /\bmake a (?:tax[- ]deductible )?(?:donation|gift)\b|\bdonate (?:today|now|online|to (?:our|the|this))\b|\byour (?:gift|donation|support) (?:helps|makes|will|can)\b|\bhelp support the research\b/i;

const COOKIE_OR_SIGN_ON_TEXT =
  /\bcookies?\b[^.!?]*\b(?:browser|enable|disable|accept|consent|essential|store or read)\b|\bsingle sign-on\b|\bquit your (?:web )?browser\b/i;

const MAX_CHROME_LINE_WORDS = 16;

const wordCount = (line: string): number => line.split(/\s+/).filter(Boolean).length;
const endsAsSentence = (line: string): boolean => /[.!?]["')\]]?$/.test(line);

function isChromeLine(line: string): boolean {
  const text = foldWriterTextForms(line);
  if (!text) return true;
  if (!text.replace(SKIP_LINK, ' ').trim()) return true;
  if (COOKIE_OR_SIGN_ON_TEXT.test(text)) return true;
  if (HIRING_SENTENCE.test(text) || DONATION_APPEAL_SENTENCE.test(text)) return true;
  if (endsAsSentence(text) || wordCount(text) > MAX_CHROME_LINE_WORDS) return false;
  return NAVIGATION_LABEL.test(text) || JOB_ADVERTISEMENT_TITLE.test(text);
}

/**
 * Stored research page text with the site chrome it still carries (#5577) removed line by
 * line: skip links, navigation and menu labels, job advertisements, donation appeals and
 * cookie or sign-on notices. A label is removed only as a whole short line that is not a
 * sentence, so research prose that mentions applying or donating inside a sentence stays.
 */
export function withoutResearchPageChrome(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(SKIP_LINK, ' ').replace(/\s+/g, ' ').trim())
    .filter((line, index, lines) => line && !isChromeLine(lines[index]))
    .join('\n');
}

const AUTHOR_TOKEN = String.raw`\p{Lu}[\p{L}'’\-]+(?: \p{Lu}[\p{L}'’\-]+)* \p{Lu}{1,3}`;
const LEADING_AUTHORS = new RegExp(
  String.raw`^(?:\d{1,3}[.)]\s+)?(?:${AUTHOR_TOKEN}(?:,\s*|\.\s+|\s+et al\b))+`,
  'u',
);
const CITATION_RECORD_MARKER =
  /\bPMID:?\s*\d|\bPMCID\b|\bDOI:?\s*10\.|\b(?:19|20)\d\d\s*[,;:]\s*\d+\s*[:(-]|\bet al\.?/i;
const MESH_KEYWORDS_HEADING = /^mesh (?:keywords|terms|headings)$/i;
const MIN_GLUED_TERM_SEAMS = 3;

const gluedTermSeams = (line: string): number => (line.match(/\p{Ll}\p{Lu}/gu) ?? []).length;

/** A bibliography entry: an author list followed by a journal record, never a sentence about a paper. */
export function isPublicationCitationLine(line: string): boolean {
  const text = foldWriterTextForms(line);
  if (isCitationAuthorListDumpText(text)) return true;
  return LEADING_AUTHORS.test(text) && CITATION_RECORD_MARKER.test(text);
}

/**
 * Research page text without its auto-listed publications: bibliography entries and a MeSH
 * keyword block with its run-together terms. A profile page lists papers by name match, so a
 * namesake's papers can sit among the person's own, which makes the listing unsafe evidence
 * for what this person studies; a prose sentence that mentions a paper stays.
 */
export function withoutPublicationListings(text: string): string {
  const kept: string[] = [];
  let inMeshBlock = false;
  for (const line of text.split('\n')) {
    const folded = foldWriterTextForms(line);
    if (MESH_KEYWORDS_HEADING.test(folded)) {
      inMeshBlock = true;
      continue;
    }
    if (inMeshBlock && gluedTermSeams(folded) >= MIN_GLUED_TERM_SEAMS && !/[.!?]$/.test(folded)) {
      continue;
    }
    inMeshBlock = false;
    if (isPublicationCitationLine(folded)) continue;
    kept.push(line);
  }
  return kept.join('\n');
}
