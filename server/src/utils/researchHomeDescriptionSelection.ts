import {
  describesResearchFocus,
  fullDescriptionQuality,
  isTeachingOrAdvisingStatementProse,
  type DescriptionQualityFlag,
} from './researchEntityDescriptionQuality';
import {
  isDirectoryIndexChromeText,
  isFacultyResearchTextEntity,
} from './researchEntityDescriptionText';
import { isPersonProfileOrDirectoryUrl } from './researchHomeWebsiteUrl';
import { containsHtmlTagMarkup, isPhilanthropicFundAppealText } from './descriptionHygiene';

export type DescriptionEntityKind = 'organization' | 'person';

export interface DescriptionEntityKindEvidence {
  entityType?: unknown;
  kind?: unknown;
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
}

const citedUrls = (entity: DescriptionEntityKindEvidence): string[] => {
  const urls = Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [];
  return urls.map((value) => textValue(value)).filter(Boolean);
};

/**
 * Whether the record cites nothing but pages that render one person.
 *
 * This is the evidence question the stored `entityType` cannot answer. A faculty
 * directory lane mints a row from a profile page and labels it `LAB` with a
 * templated `<Person> Lab` name, even where the page names no lab, so the enum
 * records what a lane guessed rather than what the sources show. The sources are
 * unambiguous: a record whose only citations are profile or people-directory
 * pages, and which has found no research site of its own, is a faculty research
 * profile whatever the enum says.
 *
 * A row with a research site is excluded even when it also cites a profile page,
 * because that site is the organization's own page and its prose is organization
 * prose. That keeps an eponymous lab with a real microsite ("The Pyle Lab
 * studies RNA structure and RNA recognition by proteins") on the organization
 * bar, where a CV biography of its PI must keep losing.
 */
export function citesOnlyPersonPages(entity?: DescriptionEntityKindEvidence | null): boolean {
  if (!entity) return false;
  if (textValue(entity.websiteUrl) || textValue(entity.website)) return false;
  const urls = citedUrls(entity);
  if (urls.length === 0) return false;
  return urls.every((url) => isPersonProfileOrDirectoryUrl(url));
}

/**
 * The voice a record's description is expected to be written in.
 *
 * `person` means person-voiced research prose is the expected shape, so the
 * organization-only person-centric penalty must not be charged against it. The
 * penalty is right for an organization - "Jane Doe received her Ph.D. from ..."
 * is not a description of a centre - and wrong for a faculty research profile,
 * where the page's own research paragraph is written about the person by
 * construction ("Professor Lauenroth studies ecosystems in dry areas"). Charging
 * it there ranks the research paragraph below whatever else the page publishes,
 * which on a profile with a teaching statement means the course inventory wins.
 *
 * Two independent routes to `person`, because the enum and the evidence each
 * catch rows the other misses: `isFacultyResearchTextEntity` reads the declared
 * type, and `citesOnlyPersonPages` reads what the record actually cites.
 */
export function descriptionEntityKindForResearchEntity(
  entity?: DescriptionEntityKindEvidence | null,
): DescriptionEntityKind {
  if (!entity) return 'organization';
  if (
    isFacultyResearchTextEntity({
      entityType: textValue(entity.entityType),
      kind: textValue(entity.kind),
    })
  ) {
    return 'person';
  }
  return citesOnlyPersonPages(entity) ? 'person' : 'organization';
}

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

const ACADEMIC_CREDENTIAL =
  'M\\.?D|Ph\\.?D|MBBS|MPH|D\\.?O|DVM|DDS|Sc\\.?D|Pharm\\.?D|D\\.?Phil|Dr\\.?PH';

const CREDENTIAL_NAME_LEAD = new RegExp(
  `\\b[A-Z][a-z]+(?:\\s+(?:[A-Z]\\.?|van|von|de|del|della|di|da|la|le|[A-Z][a-z]+)){1,3},\\s*(?:${ACADEMIC_CREDENTIAL})\\b`,
);

// Split by what the verb asserts, because the two halves separate differently on
// a person-scoped record. A career verb says who someone is; a research verb says
// what they study, which on a faculty research profile is the description we
// want. On an organization both halves are equally wrong, so both still apply.
const CAREER_LEAD_VERB =
  'is|was|received|earned|holds|joined|serves|completed|obtained|graduated|attended|has';
const RESEARCH_LEAD_VERB = 'studies|investigates|examines|explores|focuses|researches|works';

const nameLeadPattern = (verbs: string): RegExp =>
  new RegExp(
    `^([A-Z][\\p{L}'’.-]+(?:\\s+[A-Z][\\p{L}'’.-]+){1,3})(?:['’]s)?(?:,\\s*(?:${ACADEMIC_CREDENTIAL})\\b)*,?\\s+(?:${verbs})\\b`,
    'u',
  );

const NAME_VERB_LEAD = nameLeadPattern(`${CAREER_LEAD_VERB}|${RESEARCH_LEAD_VERB}`);

const NAME_CAREER_VERB_LEAD = nameLeadPattern(CAREER_LEAD_VERB);

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
const TITLE_CLAUSE_THEN_NAME_LEAD =
  /^as\s+(?:an?|the)\s+[^,]{0,120},\s*(?:dr|prof|professor)\.?\s+[A-Z]/i;

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

const TITLED_NAME_OPENER = /^(?:dr|prof|professor)\.?\s+[A-Z]/i;

/**
 * The signals that a person biography produces and organization prose does not:
 * a dangling pronoun subject, a credentialed name, a degree or career
 * narrative, a first-person title or experience lead, or repeated personal
 * quote attribution.
 *
 * Kept separate from `isHighConfidencePersonBio` because that wider test also
 * accepts a bare `Dr./Professor <Name>` opener, which leads ordinary research
 * prose at least as often as it leads a biography ("Dr. Sauler's research
 * investigates mechanisms of lung injury"). On a labelled 40-row sample of the
 * bio-flagged descriptions the corpus actually serves, the wider test was a
 * genuine biography in 13 of 40 cases while this narrower one was in 6 of 8, so
 * only this one is safe to rank one description below another on. The wider
 * test still gates the fail-closed blanking path, where over-reporting costs a
 * description rather than mis-ordering two.
 */
export function isDemotablePersonBio(text: string): boolean {
  const value = textValue(text);
  if (!value) return false;
  if (/^(?:he|she|they|his|her|their)\s/i.test(value)) return true;
  if (CREDENTIAL_NAME_LEAD.test(firstSentence(value))) return true;
  if ((value.match(PERSONAL_QUOTE_ATTRIBUTION) ?? []).length >= 2) return true;
  if (DEGREE_EARNED_NARRATIVE.test(value)) return true;
  if (FIRST_PERSON_TITLE_LEAD.test(firstSentence(value))) return true;
  if (TITLE_CLAUSE_THEN_NAME_LEAD.test(firstSentence(value))) return true;
  if (FIRST_PERSON_EXPERIENCE_LEAD.test(firstSentence(value))) return true;
  return false;
}

// Only the signals that never fire on organization prose gate the fail-closed
// path, so blanking a sole surviving candidate can never drop a real research
// description. Do not widen this with the looser name-verb lead below.
export function isHighConfidencePersonBio(text: string): boolean {
  const value = textValue(text);
  if (!value) return false;
  if (TITLED_NAME_OPENER.test(value)) return true;
  return isDemotablePersonBio(value);
}

const ORGANIZATION_LEAD_WORD = /^(?:the|our|this|a|an|in|within|at)\b/i;

const ORGANIZATION_HEAD_NOUN_IN_LEAD =
  /\b(?:Lab|Laboratory|Center|Centre|Institute|Program|Group|Initiative|Project|Department|School|University|College|Yale)\b/;

function hasBareNameLead(value: string, pattern: RegExp): boolean {
  if (ORGANIZATION_LEAD_WORD.test(value)) return false;
  const lead = value.match(pattern);
  return Boolean(lead && !ORGANIZATION_HEAD_NOUN_IN_LEAD.test(lead[1]));
}

export function isPersonCentricLead(text: string): boolean {
  const value = textValue(text);
  if (!value) return false;
  // A high-confidence signal can appear later in the passage even when the
  // sentence itself opens with organization-voice wording ("The PI, Dr. Deng
  // obtained his PhD from ..."), so that check must run before the
  // organization-voice lead words below are allowed to short-circuit it.
  if (isHighConfidencePersonBio(value)) return true;
  return hasBareNameLead(value, NAME_VERB_LEAD);
}

/**
 * A career narrative about a named person, as distinct from that person's
 * research.
 *
 * This is the half of `isPersonCentricLead` that is still wrong on a faculty
 * research profile. The other half - a name followed by a research verb - is the
 * research paragraph such a page is expected to publish ("Professor Lauenroth
 * studies ecosystems in dry areas"), so charging it there ranks the page's own
 * research description below whatever else the page happens to say.
 *
 * `TITLED_NAME_OPENER` is deliberately not consulted. It accepts a bare
 * `Dr./Professor <Name>` opener, which the file already records as leading
 * ordinary research prose at least as often as a biography, and it is what made
 * the research paragraph unpromotable in the first place.
 */
export function isCareerNarrativeLead(text: string): boolean {
  const value = textValue(text);
  if (!value) return false;
  if (isDemotablePersonBio(value)) return true;
  return hasBareNameLead(value, NAME_CAREER_VERB_LEAD);
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

/**
 * Person voice is not a description of an organization: "Jane Doe received her
 * Ph.D. from ..." and "Jane Doe studies protein folding" both describe a person
 * rather than a centre, so on an organization either one disqualifies the value
 * outright.
 *
 * Deliberately organization-only, and the `person` arm is a ranking term below
 * rather than a second disqualifier here. This is the arm
 * `selectResearchHomeDescription` reads to decide whether to return nothing at
 * all, and a person-scoped record whose only prose is a biography has to keep
 * serving it (#2176, #919).
 */
function personCentricPenalty(text: string, kind: DescriptionEntityKind): number {
  return kind === 'organization' && isPersonCentricLead(text) ? PERSON_CENTRIC_PENALTY : 0;
}

const CAREER_NARRATIVE_DEMOTION = -35;

/**
 * On a faculty research profile, a career narrative ranks below every passage
 * that says what the person studies, but it is not disqualified.
 *
 * This is the half of the organization penalty that is still wrong to ignore on a
 * person-scoped record. The other half - a name followed by a research verb - is
 * the research paragraph such a page is expected to publish ("Professor
 * Lauenroth studies ecosystems in dry areas"), and charging that inverts the
 * ranking: the research paragraph scores -100 while the profile's teaching
 * statement scores 0, so the course inventory wins (#2232 in a new shape).
 *
 * A demotion rather than a penalty, because the resolver's promotion bars test
 * for a score of exactly 0 - so a career narrative still cannot be promoted over
 * research prose - while `selectResearchHomeDescription`'s fail-closed arm keys
 * on `personCentricPenalty` alone and so cannot blank a record whose only prose
 * is a biography.
 *
 * Ranked at -35: below a recruiting pitch's -30, because a pitch usually sits on
 * a page whose research prose is still there, and a CV names no research at all;
 * above a navigational cross-reference's -40, because a CV at least names the
 * person's field. Measured on Development, moving it either side of those two
 * reorders no pair, because no record carries both shapes.
 */
function careerNarrativeDemotion(text: string, kind: DescriptionEntityKind): number {
  return kind === 'person' && isCareerNarrativeLead(text) ? CAREER_NARRATIVE_DEMOTION : 0;
}

/**
 * How far a passage strays from saying what the home studies, independent of
 * whose voice it is written in. Separated from the person-centric penalty below
 * because a caller that cannot tell a faculty research home from a lab must not
 * be forced to guess: on a faculty home, person-voiced research prose is the
 * expected shape, and charging it the organization-only bio penalty ranks it
 * below a mission statement (#2232).
 */
export function offTopicResearchHomeDemotionScore(text: unknown): number {
  const value = textValue(text);
  let score = 0;
  // Below a mission statement's -20 and above a recruiting pitch's -30. A unit's
  // mission at least says what the unit is for, while a course inventory says
  // nothing about the research at all, so the mission has to beat it outright; a
  // recruiting pitch usually sits on a research page and buries prose that is
  // still there, which is the worse of the two. Unlike the three below, this term
  // is paired with a `profile-chrome` quality flag, so it ranks a teaching
  // statement down for a lane choosing between page regions and the quality bar
  // refuses it outright at write time.
  if (isTeachingOrAdvisingStatementProse(value)) score -= 25;
  // Ranked below every other demotion, including a mission statement's -20,
  // because a unit's own mission page is the correct replacement for its
  // landing-page appeal and has to beat it outright under the strictly-better
  // rule. Measured on Development, this term fires on 1 of 8,660 stored
  // descriptions, so it cannot reorder any other pair (#2957).
  if (isPhilanthropicFundAppealText(value)) score -= 60;
  if (isNavigationalCrossReferenceProse(value)) score -= 40;
  if (isRecruitingNoticeLead(value)) score -= 30;
  if (isMissionOrCultureProse(value)) score -= 20;
  return score;
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
  return (
    personCentricPenalty(value, kind) +
    careerNarrativeDemotion(value, kind) +
    offTopicResearchHomeDemotionScore(value)
  );
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
