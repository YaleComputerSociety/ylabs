import {
  buildResearchAreasCardSummary,
  describesResearchFocus,
  deriveShortDescriptionFromFullDescription,
  fullDescriptionQuality,
  shortDescriptionQuality,
} from './researchEntityDescriptionQuality';
import { isMidCvContinuationOpener } from './researchEntityDescriptionText';

const INITIAL_DOT_TOKEN = '<initialdot>';

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

const PROTECTED_ABBREVIATIONS = [
  'Ph.D.',
  'M.Phil.',
  'D.Phil.',
  'Sc.D.',
  'Ed.D.',
  'Psy.D.',
  'M.D.',
  'B.S.',
  'B.A.',
  'M.S.',
  'M.A.',
  'M.Sc.',
  'B.Sc.',
  'J.D.',
  'U.S.',
  'U.K.',
  'D.C.',
  'N.I.H.',
];

function protectAbbreviations(value: string): string {
  let protectedText = value;
  for (const abbreviation of PROTECTED_ABBREVIATIONS) {
    const withToken = abbreviation.split('.').join(INITIAL_DOT_TOKEN);
    protectedText = protectedText.split(abbreviation).join(withToken);
  }
  return protectedText
    .replace(/\b(Dr|Prof|Mr|Mrs|Ms)\./g, `$1${INITIAL_DOT_TOKEN}`)
    .replace(/\b(?:[A-Z]\.){2,}/g, (match) => match.split('.').join(INITIAL_DOT_TOKEN))
    .replace(/\b([A-Z])\.(?=\s*[A-Z][A-Za-z.'-]*)/g, `$1${INITIAL_DOT_TOKEN}`)
    // A genuine sentence-ending period is always followed by whitespace or
    // end-of-string; anything else (glued abbreviation, decimal, a period
    // before a closing bracket/quote) is not a sentence boundary.
    .replace(/\.(?!\s|$)/g, INITIAL_DOT_TOKEN);
}

export function protectedSentenceList(value: string): string[] {
  const protectedText = protectAbbreviations(value);
  return (
    protectedText
      .match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)
      ?.map((sentence) => sentence.split(INITIAL_DOT_TOKEN).join('.').trim())
      .filter(Boolean) || []
  );
}

const PROFILE_CHROME_OPENER_PATTERN = /^(?:Welcome!\s*|Bio:\s*|Titles[\s\S]{0,300}?Biography\s*)+/i;

export function isProfileBiographyChromeOpener(value: unknown): boolean {
  const text = textValue(value);
  return Boolean(text) && PROFILE_CHROME_OPENER_PATTERN.test(text);
}

export function stripProfileBiographyChromeOpener(value: unknown): string {
  const text = textValue(value);
  if (!text) return '';
  return text.replace(PROFILE_CHROME_OPENER_PATTERN, '').trim();
}

const TRAILING_PROFILE_CHROME_PATTERN =
  /\s*Last Updated on [^.]+\.\s*Departments\s*&\s*Organizations[\s\S]*$/i;

/**
 * A profile-page "Education & Training" / "Departments & Organizations"
 * footer glued directly onto the last sentence with no separating
 * whitespace, so it survives sentence splitting as unreadable chrome
 * (#1456: "...opioid use disorder.Last Updated on June 02,
 * 2026.Departments & OrganizationsInternal MedicineJaneway
 * SocietyEducation & Training...").
 */
export function stripTrailingProfileChromeFooter(value: unknown): string {
  const text = textValue(value);
  if (!text) return '';
  return text.replace(TRAILING_PROFILE_CHROME_PATTERN, '').trim();
}

/**
 * Unambiguous education-timeline, career-timeline, and personal-life-narrative
 * markers (#1456: "was born in Boston...", "received her doctoral degree
 * from...", "joined the Yale faculty in..."). Every pattern here identifies a
 * biography/CV fact rather than a description of what the lab or researcher
 * currently studies, so a matching sentence is dropped outright with no
 * research-focus override: a CV sentence that happens to also contain the
 * word "studies" ("completed his graduate studies on X") is still a CV
 * sentence, not a research statement.
 */
const EDUCATION_OR_CAREER_TIMELINE_SENTENCE_PATTERNS: RegExp[] = [
  /\bwas born in\b/i,
  /\bmoved,?\s+as a teenager\b/i,
  /\b(?:received|earned|obtained)\s+(?:the|his|her|their|an?)\b[^.!?]{0,80}\b(?:degrees?|Ph\.?D\.?|M\.?D\.?|MPH|MBA|MSc|M\.?S\.?|M\.?A\.?|B\.?S\.?|B\.?A\.?)\b/i,
  /\b(?:completed|did)\s+(?:his|her|their)\s+(?:graduate|undergraduate|postdoctoral|clinical|doctoral)\b/i,
  /\bdid\s+(?:his|her|their)\s+(?:ph\.?d|doctorate|postdoctoral)\b/i,
  /\bpost-?doc(?:toral)?\s+(?:work|training|fellowship|research)\s+(?:with|at|on)\b/i,
  /\bunder\s+the\s+(?:supervision|guidance|direction|mentorship)\s+of\b/i,
  // Any institution's faculty/staff, not just Yale's - a CV career-timeline
  // fact regardless of which employer is named (#1791: Holly Rushmeier's bio
  // lists Georgia Tech, NIST, and IBM in the same pattern before ever joining
  // Yale).
  /\bjoined\s+(?:the\s+)?[\p{L}][\p{L} .,&'-]{0,80}?\b(?:faculty|staff)\b/iu,
  /\bwas\s+a\s+research\s+staff\s+member\b/i,
  /\b(?:before|prior\s+to)\s+joining\b/i,
  /\bwas\s+appointed\s+(?:as\s+)?(?:an?\s+)?(?:assistant|associate|full)?\s*professor\b/i,
  /\bserved\s+as\s+(?:Senior|Associate|Assistant|Director|Dean|Chief|Section\s+Chief)\b/i,
  /\b(?:served|serves)\s+as\s+(?:the\s+)?[\p{L} .,'-]{0,40}?\b(?:chair|co-chair|editor-in-chief)\b/iu,
  /\bwas\s+Editor-in-Chief\s+of\b/i,
  /\bmoved\s+to\s+[\p{L} .-]+,?\s+(?:with\s+(?:his|her|their)\s+family\s+)?in\s+\d{4}\b/iu,
  /^(?:Next,|Subsequently,|After completing\b|In \d{4},\s+(?:he|she|they)\b)/i,
];

export function isEducationOrCareerTimelineSentence(sentence: string): boolean {
  return EDUCATION_OR_CAREER_TIMELINE_SENTENCE_PATTERNS.some((pattern) => pattern.test(sentence));
}

function isSalvageableShortDescription(candidate: string, contextFullDescription: string): boolean {
  if (!candidate) return false;
  if (isMidCvContinuationOpener(candidate)) return false;
  if (isEducationOrCareerTimelineSentence(candidate)) return false;
  // Exclude 'full-not-useful': it reflects fullDescriptionQuality's whole-text
  // verdict on contextFullDescription, which can false-flag a rebuilt full
  // that opens with a legitimate appointment sentence (see
  // rebuiltFullIsUsable above) - that is not a defect of the candidate short
  // itself.
  return shortDescriptionQuality(candidate, contextFullDescription).flags.every(
    (flag) => flag === 'full-not-useful',
  );
}

export interface BiographyDescriptionRepairInput {
  fullDescription: unknown;
  shortDescription: unknown;
  researchAreas: unknown;
}

export interface BiographyDescriptionRepairResult {
  outcome: 'unchanged' | 'resynthesized' | 'blanked';
  fullDescription: string;
  shortDescription: string;
  strippedSentenceCount: number;
  totalSentenceCount: number;
}

/**
 * Repairs a served lab/research-entity description that leaked a PI resume or
 * biography (education timeline, personal-life narrative, profile-layout
 * chrome) instead of describing what the lab studies (#1456). Strips
 * biography/CV/chrome sentences and rebuilds a research-focused description
 * from whatever genuine research content remains; falls back to a
 * researchAreas-derived card summary, and finally to a blank description when
 * nothing usable can be derived so the caller can route the record through
 * the existing no-usable-description visibility floor (#1449) instead of
 * serving the bio verbatim.
 */
export function repairPersonBiographyLeakedDescription({
  fullDescription,
  shortDescription,
  researchAreas,
}: BiographyDescriptionRepairInput): BiographyDescriptionRepairResult {
  const originalFull = textValue(fullDescription);
  const originalShort = textValue(shortDescription);
  const dechromed = stripTrailingProfileChromeFooter(stripProfileBiographyChromeOpener(originalFull));
  const sentences = protectedSentenceList(dechromed);
  const keptSentences = sentences.filter((sentence) => !isEducationOrCareerTimelineSentence(sentence));
  const strippedSentenceCount = sentences.length - keptSentences.length;
  const hadChrome = dechromed !== originalFull;

  if (strippedSentenceCount === 0 && !hadChrome && !isMidCvContinuationOpener(originalShort)) {
    return {
      outcome: 'unchanged',
      fullDescription: originalFull,
      shortDescription: originalShort,
      strippedSentenceCount: 0,
      totalSentenceCount: sentences.length,
    };
  }

  const rebuiltFull = keptSentences.join(' ').trim();
  const rebuiltFullQuality = fullDescriptionQuality(rebuiltFull);
  // fullDescriptionQuality assesses a description as one unit, so a single
  // legitimate "X is a Professor of Y" orienting sentence at the head of an
  // otherwise research-focused rebuilt text can flip the whole-text verdict
  // to appointment-only/synthetic-placeholder. describesResearchFocus is the
  // narrower, more reliable signal here: does genuine research-focus language
  // survive anywhere in what was kept.
  const rebuiltFullIsUsable = rebuiltFullQuality.isUseful || describesResearchFocus(rebuiltFull);

  if (rebuiltFull && rebuiltFullIsUsable) {
    const rebuiltShort = isSalvageableShortDescription(originalShort, rebuiltFull)
      ? originalShort
      : deriveShortDescriptionFromFullDescription(rebuiltFull) ||
        buildResearchAreasCardSummary(researchAreas) ||
        '';
    return {
      outcome: 'resynthesized',
      fullDescription: rebuiltFull,
      shortDescription: rebuiltShort,
      strippedSentenceCount,
      totalSentenceCount: sentences.length,
    };
  }

  const areaSummary = buildResearchAreasCardSummary(researchAreas);
  if (areaSummary) {
    return {
      outcome: 'resynthesized',
      fullDescription: areaSummary,
      shortDescription: areaSummary,
      strippedSentenceCount,
      totalSentenceCount: sentences.length,
    };
  }

  return {
    outcome: 'blanked',
    fullDescription: '',
    shortDescription: '',
    strippedSentenceCount,
    totalSentenceCount: sentences.length,
  };
}
