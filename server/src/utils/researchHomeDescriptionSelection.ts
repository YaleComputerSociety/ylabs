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

// The off-topic markers below scan the whole passage, so on their own they also
// fire on research prose that merely closes with a mission line, a recruiting
// invitation, or a pointer to another page ("The Smith Lab studies the neural
// circuits underlying decision-making. If you're interested in joining, reach
// out."). A passage that opens by saying what the home studies reads as a
// research description whatever follows, so it is exempt from the marker-based
// demotions. The lead patterns stay absolute: they describe the opening itself.
function opensWithResearchFocus(value: string): boolean {
  return describesResearchFocus(firstSentence(value));
}

const CULTURE_SECTION_LEAD =
  /^(?:(?:our|the|lab|laboratory|group)\s+)?(?:core\s+values|guiding\s+principles|diversity(?:\s+(?:statement|,\s*equity))?|code\s+of\s+conduct|lab(?:oratory)?\s+(?:culture|policies|philosophy))\b/i;

// "Mission", "Vision", and "Values" are section headings only when punctuation
// or a run-in capital follows them ("Our Mission Create and communicate ...";
// "Our Values: we believe ..."). The same words open ordinary research prose
// ("Vision is our most important sense ..."; "The mission of the Center is to
// advance the diagnosis and treatment of ..."), which must not be demoted.
const MISSION_TOPIC_WORD_LEAD =
  /^(?:(?:our|the|lab|laboratory|group)\s+)?(?:mission|vision|values)(?:\s+statement)?\b/i;

const HEADING_RUN_IN = /^(?:\s*[:\-–—]|\s+[A-Z])/;

function hasMissionTopicHeadingLead(value: string): boolean {
  const lead = value.match(MISSION_TOPIC_WORD_LEAD);
  if (!lead) return false;
  return HEADING_RUN_IN.test(value.slice(lead[0].length));
}

const MISSION_OR_CULTURE_MARKERS = [
  /\b(?:personal|professional)\s+and\s+(?:scientific|professional|personal)\s+growth\b/i,
  /\b(?:foster|fostering|cultivate|cultivating|promote|promoting|maintain|maintaining)\s+(?:an?\s+)?(?:inclusive|welcoming|equitable|collaborative|supportive|respectful|safe)\b/i,
  /\b(?:mentoring|mentorship|training)\s+philosophy\b/i,
  /\blab(?:oratory)?['’]?s?\s+(?:policies|culture|values|code\s+of\s+conduct)\b/i,
  /\bcommitted\s+to\s+(?:building\s+|creating\s+|maintaining\s+)?(?:an?\s+)?(?:diversity|equity|inclusion|inclusive|welcoming|respectful|safe)\b/i,
];

/**
 * A research home's mission, values, or lab-culture statement is legitimate
 * prose about the group, but it does not say what the group studies. It is
 * demoted rather than rejected so a home that publishes nothing else still
 * keeps a description (#2176).
 */
export function isMissionOrCultureProse(text: unknown): boolean {
  const value = textValue(text);
  if (!value) return false;
  if (CULTURE_SECTION_LEAD.test(value) || hasMissionTopicHeadingLead(value)) return true;
  if (opensWithResearchFocus(value)) return false;
  return MISSION_OR_CULTURE_MARKERS.some((pattern) => pattern.test(value));
}

const RECRUITING_NOTICE_LEAD =
  /^(?:hiring\b|we\s+are\s+hiring\b|we\s+(?:are|have)\s+(?:currently\s+)?(?:recruiting|looking\s+for\s+(?:a\s+)?(?:new\s+)?(?:postdoc|graduate|phd|student|lab))|(?:our\s+)?(?:group|lab|laboratory)\s+(?:has|is)\s+(?:open\s+positions|hiring|recruiting)|open\s+positions\b|positions?\s+(?:are\s+)?available\b|join\s+(?:our|the)\s+(?:lab|group|team)\b)/i;

// A solicitation can also sit past the opening sentence ("The Craven Lab
// launched in fall 2025 and we're building a team. If you're excited about
// organic chemistry, reach out"). A passage whose purpose is recruitment is not
// a research description wherever the pitch appears.
// A bare "contact us" is ordinary page copy, so the reach-out phrasings only
// count as recruitment when an applicant or a position sits in the same
// sentence. Otherwise this demotion would reorder candidates on any page that
// merely invites contact.
// "We are building" and "we are looking for" are also how research prose states
// its aims ("We are building a comprehensive atlas of cell types in the
// developing human brain"), so those two need a position or an applicant in the
// same sentence before they count as a pitch.
const RECRUITING_ROLE_OBJECT =
  '(?:team|position|opening|vacancy|postdoc(?:toral)?|graduate\\s+student|phd\\s+student|rotation\\s+student|student|applicant|candidate|(?:lab|group)\\s+member|technician|to\\s+join)';

const RECRUITING_SOLICITATION_MARKERS = [
  /\bif\s+you(?:['’]re|\s+are)\s+(?:excited|interested|passionate|enthusiastic)\b/i,
  /\b(?:we\s+are|we['’]re)\s+(?:recruiting|hiring)\b/i,
  new RegExp(
    `\\b(?:we\\s+are|we['’]re)\\s+(?:building|looking\\s+for)\\b[^.]{0,60}\\b${RECRUITING_ROLE_OBJECT}\\b`,
    'i',
  ),
  /\b(?:accepting|seeking)\s+(?:new\s+)?(?:students|applicants|postdocs?|rotation\s+students)\b/i,
  /\b(?:students?|postdocs?|applicants?|candidates?)\b[^.]{0,80}\b(?:reach\s+out|get\s+in\s+touch|contact\s+(?:me|us)|apply|application)\b/i,
  /\b(?:reach\s+out|get\s+in\s+touch|contact\s+(?:me|us))\b[^.]{0,80}\b(?:position|opening|opportunit|join\s+(?:us|the|our)|apply|application)/i,
];

/**
 * A research page that sells open positions ("Hiring! Our group has open
 * positions for a postdoc ...") buries whatever research prose follows. Demoted
 * so a cleaner passage from the same site wins (#2176).
 */
export function isRecruitingNoticeLead(text: unknown): boolean {
  const value = textValue(text);
  if (!value) return false;
  if (RECRUITING_NOTICE_LEAD.test(firstSentence(value))) return true;
  if (opensWithResearchFocus(value)) return false;
  return RECRUITING_SOLICITATION_MARKERS.some((pattern) => pattern.test(value));
}

// "You can see our individual websites linked from the People page for more
// information about particular research projects" points at the research
// instead of describing it.
const NAVIGATIONAL_CROSS_REFERENCE_MARKERS = [
  /\b(?:see|find|listed|linked)\b[^.]{0,60}\b(?:People|Team|Members|Publications|Projects)\s+page\b/i,
  /\bsee\s+our\s+individual\s+(?:websites|pages)\b/i,
  /\bfor\s+more\s+information\s+about\s+(?:particular|specific|individual)\b/i,
];

/**
 * Prose that directs the reader elsewhere rather than saying what the home
 * studies. Demoted, not rejected, so it still survives as a last resort (#2176).
 */
export function isNavigationalCrossReferenceProse(text: unknown): boolean {
  const value = textValue(text);
  if (!value) return false;
  if (opensWithResearchFocus(value)) return false;
  return NAVIGATIONAL_CROSS_REFERENCE_MARKERS.some((pattern) => pattern.test(value));
}

const PERSON_CENTRIC_PENALTY = -100;

function personCentricPenalty(text: string, kind: DescriptionEntityKind): number {
  return kind === 'organization' && isPersonCentricLead(text) ? PERSON_CENTRIC_PENALTY : 0;
}

// The off-topic demotions rank a weaker passage below a research passage from
// the same site, but they must never on their own make a candidate look
// person-centric to the caller's bio guard, which would blank a description
// that has no better replacement.
export function scoreResearchHomeDescriptionCandidate(
  text: unknown,
  kind: DescriptionEntityKind = 'organization',
): number {
  const value = textValue(text);
  let score = personCentricPenalty(value, kind);
  if (isNavigationalCrossReferenceProse(value)) score -= 40;
  if (isRecruitingNoticeLead(value)) score -= 30;
  if (isMissionOrCultureProse(value)) score -= 20;
  return score;
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
  let bestScore = scoreResearchHomeDescriptionCandidate(best, kind);
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const candidateScore = scoreResearchHomeDescriptionCandidate(candidate, kind);
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  if (personCentricPenalty(best, kind) < 0 && isHighConfidencePersonBio(best)) return null;
  return best;
}
