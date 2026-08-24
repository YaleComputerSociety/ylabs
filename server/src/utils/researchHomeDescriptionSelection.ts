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

export function describesResearchHome(text: string): boolean {
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

const DEGREE_ABBREVIATION = `B\\.?A\\.?|B\\.?S\\.?E?\\.?|M\\.?A\\.?|M\\.?S\\.?|J\\.?D\\.?|M\\.?B\\.?A\\.?|${ACADEMIC_CREDENTIAL}`;

// A single first name is easy to miss with the name-lead heuristics below
// ("Jamie received a B.S.E. ... and a Ph.D. ..."), but no organization
// describes itself as having received a degree, so this fires regardless of
// how many capitalized words lead the sentence.
const DEGREE_EARNED_NARRATIVE = new RegExp(
  `\\b(?:received|earned|obtained|holds?|completed)\\s+(?:a|an|his|her|their)?\\s*(?:${DEGREE_ABBREVIATION})\\b`,
  'i',
);

const ACADEMIC_TITLE_NOUN =
  'Professor|Instructor|Lecturer|Fellow|Scientist|Physician|Researcher|Investigator|Director|Chair';

// A first-person job-title/affiliation lead ("I am an Associate Professor of
// Economics at Yale University") is the same CV-lead signal as
// CREDENTIAL_NAME_LEAD, just phrased in first person from a faculty profile
// page rather than third person from a lab page.
const FIRST_PERSON_TITLE_LEAD = new RegExp(
  `^I\\s+(?:am|was)\\s+(?:currently\\s+)?(?:an?|the)\\s+(?:[\\p{L}][\\p{L}'’-]*[\\s,/-]+){0,6}(?:${ACADEMIC_TITLE_NOUN})\\b`,
  'iu',
);

// A leading title/affiliation clause ("As an emeritus professor of medicine
// at Yale School of Medicine, Dr. Russi focuses on ...") pushes the Dr./Prof.
// name out of sentence-initial position, but it is the same third-person
// credential lead as the bare "Dr./Prof. ..." check above.
const TITLE_CLAUSE_THEN_NAME_LEAD = /^as\s+(?:an?|the)\s+[^,]{0,120},\s*(?:dr|prof|professor)\.?\s+[A-Z]/i;

// A first-person career/experience narrative ("I have a broad background in
// ..."; "I have twenty five plus years of experience in ...") is a CV lead
// like the degree-earned narrative above, just without a specific degree.
const FIRST_PERSON_EXPERIENCE_LEAD =
  /^I\s+have\s+(?:[\p{L}][\p{L}'’-]*[\s,.'-]*){0,6}(?:background|experience)\s+in\b/iu;

// A bare [.!?] boundary would also cut off a mid-initial period ("Carrie A.
// Redlich, MD, ...") or a title abbreviation ("... Dr. Bakshi's research
// ...") before the credential clause, so those are treated as part of the
// name, not a sentence end.
const firstSentence = (value: string): string =>
  value.match(/^(?:[A-Z]\.(?=\s)|(?:Dr|Mr|Ms|Mrs|Prof)\.(?=\s)|[^.!?])+[.!?]?/)?.[0] ?? value;

// Only the signals that never fire on organization prose gate the fail-closed
// path, so blanking a sole surviving candidate can never drop a real research
// description. Do not widen this with the looser name-verb lead below.
export function isHighConfidencePersonBio(text: string): boolean {
  const value = textValue(text);
  if (!value) return false;
  if (/^(?:he|she|they|his|her|their)\s/i.test(value)) return true;
  if (/^(?:dr|prof|professor)\.?\s+[A-Z]/i.test(value)) return true;
  if (CREDENTIAL_NAME_LEAD.test(firstSentence(value))) return true;
  if ((value.match(PERSONAL_QUOTE_ATTRIBUTION) ?? []).length >= 2) return true;
  if (DEGREE_EARNED_NARRATIVE.test(value)) return true;
  if (FIRST_PERSON_TITLE_LEAD.test(firstSentence(value))) return true;
  if (TITLE_CLAUSE_THEN_NAME_LEAD.test(firstSentence(value))) return true;
  if (FIRST_PERSON_EXPERIENCE_LEAD.test(firstSentence(value))) return true;
  return false;
}

export function isPersonCentricLead(text: string): boolean {
  const value = textValue(text);
  if (!value) return false;
  // A high-confidence signal can appear later in the passage even when the
  // sentence itself opens with organization-voice wording ("The PI, Dr. Deng
  // obtained his PhD from ..."), so that check must run before the
  // organization-voice lead words below are allowed to short-circuit it.
  if (isHighConfidencePersonBio(value)) return true;
  if (/^(?:the|our|this|a|an|in|within|at)\b/i.test(value)) return false;
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
