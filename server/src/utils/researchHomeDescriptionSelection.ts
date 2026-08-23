import {
  describesResearchFocus,
  fullDescriptionQuality,
  type DescriptionQualityFlag,
} from './researchEntityDescriptionQuality';
import { isDirectoryIndexChromeText } from './researchEntityDescriptionText';
import { containsHtmlTagMarkup } from './descriptionHygiene';

export type DescriptionEntityKind = 'organization' | 'person';

export interface SelectResearchHomeDescriptionOptions {
  kind?: DescriptionEntityKind;
  minLength?: number;
}

const DEFAULT_MIN_LENGTH = 120;

const TOLERATED_QUALITY_FLAGS = new Set<DescriptionQualityFlag>(['first-person']);

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function isDownstreamUsefulDescription(text: string): boolean {
  return fullDescriptionQuality(text).flags.every((flag) => TOLERATED_QUALITY_FLAGS.has(flag));
}

function describesResearchHome(text: string): boolean {
  return (
    !containsHtmlTagMarkup(text) &&
    !isDirectoryIndexChromeText(text) &&
    isDownstreamUsefulDescription(text) &&
    describesResearchFocus(text)
  );
}

const ACADEMIC_CREDENTIAL = 'M\\.?D|Ph\\.?D|MBBS|MPH|D\\.?O|DVM|DDS|Sc\\.?D|Pharm\\.?D|D\\.?Phil|Dr\\.?PH';

const CREDENTIAL_NAME_LEAD = new RegExp(
  `\\b[A-Z][a-z]+(?:\\s+(?:[A-Z]\\.?|van|von|de|del|della|di|da|la|le|[A-Z][a-z]+)){1,3},\\s*(?:${ACADEMIC_CREDENTIAL})\\b`,
);

const NAME_VERB_LEAD = new RegExp(
  `^([A-Z][\\p{L}'’.-]+(?:\\s+[A-Z][\\p{L}'’.-]+){1,3})(?:['’]s)?(?:,\\s*(?:${ACADEMIC_CREDENTIAL})\\b)*,?\\s+(?:is|was|received|earned|holds|joined|serves|completed|obtained|graduated|attended|studies|investigates|examines|explores|focuses|researches|works|has)\\b`,
  'u',
);

const PERSONAL_QUOTE_ATTRIBUTION =
  /[,"'”’]\s*(?:he|she|they)\s+(?:says?|said|explains?|explained|notes?|noted|adds?|added|recalls?|recalled|believes?)\b/gi;

const firstSentence = (value: string): string => value.match(/^[^.!?]+[.!?]?/)?.[0] ?? value;

// Only the signals that never fire on organization prose gate the fail-closed
// path, so blanking a sole surviving candidate can never drop a real research
// description. Do not widen this with the looser name-verb lead below.
function isHighConfidencePersonBio(text: string): boolean {
  const value = textValue(text);
  if (!value) return false;
  if (/^(?:he|she|they)\s/i.test(value)) return true;
  if (/^(?:dr|prof|professor)\.?\s+[A-Z]/i.test(value)) return true;
  if (CREDENTIAL_NAME_LEAD.test(firstSentence(value))) return true;
  if ((value.match(PERSONAL_QUOTE_ATTRIBUTION) ?? []).length >= 2) return true;
  return false;
}

function isPersonCentricLead(text: string): boolean {
  const value = textValue(text);
  if (!value) return false;
  if (/^(?:the|our|this|a|an|in|within|at)\b/i.test(value)) return false;
  if (isHighConfidencePersonBio(value)) return true;
  const lead = value.match(NAME_VERB_LEAD);
  if (
    lead &&
    !/\b(?:Lab|Laboratory|Center|Centre|Institute|Program|Group|Initiative|Project|Department|School|University|College|Yale)\b/.test(
      lead[1],
    )
  ) {
    return true;
  }
  return false;
}

function scoreDescriptionCandidate(text: string, kind: DescriptionEntityKind): number {
  if (kind === 'organization' && isPersonCentricLead(text)) return -100;
  return 0;
}

export function collectDescriptionCandidates(
  values: unknown[],
  minLength = DEFAULT_MIN_LENGTH,
): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const value of values) {
    const text = textValue(value);
    if (text.length < minLength) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(text);
  }
  return candidates;
}

export function selectResearchHomeDescription(
  values: unknown[],
  options: SelectResearchHomeDescriptionOptions = {},
): string | null {
  const kind = options.kind ?? 'organization';
  const candidates = collectDescriptionCandidates(values, options.minLength).filter(
    describesResearchHome,
  );
  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestScore = scoreDescriptionCandidate(best, kind);
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const candidateScore = scoreDescriptionCandidate(candidate, kind);
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  if (bestScore < 0 && isHighConfidencePersonBio(best)) return null;
  return best;
}
