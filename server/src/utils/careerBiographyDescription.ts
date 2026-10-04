/**
 * Whether a served `fullDescription` is a career biography rather than a
 * description of the research.
 *
 * `isHighConfidencePersonBio` is the right check on a synthesis lane's OUTPUT (we
 * want no person-voiced prose at all in a synthesized description) but the wrong
 * check for deciding which entities to REWRITE. It fires on name-framed research
 * prose, which is perfectly good content: "Dr. Sauler's research investigates
 * mechanisms of lung injury and cytoprotection in chronic lung disease" is exactly
 * what a student needs and must never be replaced.
 *
 * Measured on the served corpus, that detector over-reports roughly four to one:
 * of 155 org-type entities it flags, only 35 are genuine biographies. Scoping a
 * rewrite lane to it caused a real regression on Development - alfred-lee's
 * correct "research focuses on classical hematology, particularly thrombosis" was
 * replaced by one paper's narrow topic ("hematology consultation patterns in
 * intensive care units") - and 99 such rewrites had to be reverted.
 *
 * A career biography is identified by career facts, not by mentioning a person:
 * where they trained, what they were appointed to, what they have been awarded.
 *
 * Lives in `utils/` rather than beside the lane that selects on it because
 * `confidenceResolver` must demote exactly the values this predicate selects. A
 * selector wider than the resolver's demotion leaves the lane reporting success
 * while the biography stays served, since the profile bio outranks every
 * synthesis lane on weight alone (#2200).
 */
const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const CAPITALIZED_PRONOUN_SUBJECT = 'He|She|They|His|Her|Their|Him|Hers|Theirs';

/**
 * A bare `/(?<=[.!?])\s+/` split cuts "the epidemiology of HIV in the U.S. and
 * develop statistical methods" into two sub-floor fragments and drops both, so a
 * page whose only research sentence contains an abbreviation ("U.S.",
 * "M. tuberculosis", "Dr. Smith") reports zero snippets. A boundary therefore
 * needs both a non-abbreviation left side and a sentence-opening right side.
 *
 * The second alternative exists because the single-capital abbreviation guard
 * also suppresses the boundary after ordinary biomedical prose ending in a
 * letter-suffixed term: "the immunology of hepatitis C. She directs ..." stayed
 * one sentence, which hid the orphan pronoun from both the repair pass and the
 * residual check. No abbreviation is ever followed by a capitalised pronoun, so
 * that right-hand side is always a real sentence start.
 */
const SENTENCE_BOUNDARY = new RegExp(
  '(?<!\\b(?:[A-Z]|Dr|Mr|Ms|Mrs|Mx|Prof|St|Jr|Sr|vs|no|al|e\\.g|i\\.e|approx|Fig|eds?)\\.)' +
    '(?<=[.!?])\\s+(?=["\'“‘(]?[A-Z])' +
    `|(?<=[.!?])\\s+(?=(?:${CAPITALIZED_PRONOUN_SUBJECT})\\b)`,
);

export function splitDescriptionSentences(value: string): string[] {
  return value
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

// Specialist role nouns are open-ended (immunologist, nephrologist, geneticist,
// ...), so morphology carries the suffix families that only ever form a role
// noun. Bare `ist` and `ian` are deliberately excluded: they also end ordinary
// biomedical vocabulary ("ovarian", "mammalian", "Bayesian", "agonist"), and a
// morphology-only match on them flagged research prose such as "Our research is
// focused on the mammalian circadian clock" as a biography. The handful of
// genuine role nouns those two suffixes do form are enumerated instead.
const CAREER_ROLE_NOUN = [
  '\\w*(?:ologists?|iatrists?|iatricians?|icians?|icists?)',
  'scientists?|historians?|internists?|dentists?|therapists?|specialists?',
  'veterinarians?|librarians?|archivists?|economists?|linguists?|chemists?',
  'professors?|lecturers?|instructors?|surgeons?|deans?|attendings?|fellows?',
  // A person's post, not a superlative: "is the chief cause of mortality" and
  // "is a key driver" are research prose, so these need a post-modifying
  // preposition or a clause end after them.
  '(?:chairs?|chiefs?|directors?|heads?)(?=\\s+(?:of|for|at|in)\\b|\\s*[,.;])',
].join('|');

// Deliberately NOT a marker: teaching, mentoring, and advising verbs. They read
// like career duties but fire on good organization prose that merely lists
// activities after leading with research ("YCEC conducts research on the
// psychological, cultural, and political factors ...; teaches students and trains
// working professionals"). Every genuine bio opener they would have caught is
// already caught by the role-noun marker ("Dr. Avery Lin is an immunologist ...
// where she teaches").
const CAREER_BIOGRAPHY_MARKERS: readonly RegExp[] = [
  // Training and degrees: no research description says who granted a degree.
  // Spelled-out degrees matter as much as abbreviations: "received his
  // undergraduate degree at Fairfield University" carries no "B.A." token.
  /\b(?:received|earned|obtained|completed|holds?)\s+(?:his|her|their|an?|the)\s+[^.]{0,40}\b(?:B\.?A\.?|B\.?S\.?|M\.?A\.?|M\.?S\.?|M\.?D\.?|Ph\.?D\.?|J\.?D\.?|M\.?P\.?H\.?|degrees?|doctorate|diploma|residency|fellowship|postdoc(?:toral)?|training)\b/i,
  /\bsubspecialty\s+training\s+in\b/i,
  // Appointment and tenure history.
  /\bjoined\s+(?:the\s+)?(?:Yale|faculty|department|university)\b/i,
  /\bbefore\s+(?:coming|joining|arriving)\b/i,
  /\bwas\s+(?:appointed|named|promoted|recruited)\b/i,
  // The nominalised form of the same fact, which the verb markers above miss:
  // "trained at three universities before an appointment to the faculty in 2001"
  // names no appointing verb at all (#2973).
  /\bappointment\s+to\s+the\s+(?:[\p{L}][\p{L}'’.-]*\s+){0,4}faculty\b/iu,
  // "holds a joint appointment", but also "with a secondary appointment as ...".
  /\b(?:holds?|with|has)\s+(?:a\s+)?(?:joint|secondary|primary|additional|courtesy)\s+appointment\b/i,
  new RegExp(`\\bserved?\\s+as\\s+(?:an?|the)?\\s*[^.]{0,40}\\b(?:${CAREER_ROLE_NOUN})\\b`, 'i'),
  // Honours and recognition.
  /\bis\s+the\s+recipient\s+of\b/i,
  /\bwas\s+awarded\s+the\b/i,
  /\belected\s+to\s+the\b/i,
  /\bis\s+(?:one\s+of\s+)?the\s+nation['’]s\s+(?:foremost|leading)\b/i,
];

/**
 * "is <a role noun>" is a career fact only when the subject is a person. The
 * clause itself is the most common construction in all of English research prose
 * ("The technique is a clinician-facing assay", "is a specialist protease"), so
 * these two markers are the only ones gated on a person subject.
 */
const PERSON_SUBJECT_CAREER_MARKERS: readonly RegExp[] = [
  new RegExp(
    `\\bis\\s+(?:currently\\s+)?(?:an?|the)?\\s*[^.]{0,60}\\b(?:${CAREER_ROLE_NOUN})\\b`,
    'i',
  ),
  // An endowed chair ("is William K. Townsend Professor of Law"). The initials
  // carry periods, so the span above stops at "K." and never reaches the title;
  // this matches the capitalized chair name directly instead.
  /\bis\s+(?:the\s+)?[A-Z][\w'’-]*\.?(?:\s+[A-Z][\w'’-]*\.?){0,4}\s+(?:Professor|Chair|Fellow)\b/,
];

/**
 * Career markers are matched against the OPENING only, not the whole passage.
 *
 * The defect is a biography *displacing* the research, and a career bio always
 * leads with career facts. Scanning the full text instead flags descriptions that
 * merely mention an affiliation in passing: "PittLab studies the contributions of
 * the basal ganglia to normal behavior and to neuropsychiatric disease" and "The
 * Thinking Lab is directed by Woo-kyoung Ahn, Professor of Psychology" are both
 * good copy that a whole-text scan rejected.
 *
 * Two sentences, because the common shape is a one-line credential followed by a
 * second career sentence before any research ("Dr Mirza is a physician-scientist.
 * He is a practicing pathologist with subspecialty training in GI & Liver
 * Pathology. In his laboratory he studies ...").
 */
const CAREER_MARKER_SENTENCE_WINDOW = 2;

const RESEARCH_HOME_HEAD_NOUN =
  'lab|laborator(?:y|ies)|cent(?:er|re)|institute|program(?:me)?|initiative|group|project|clinic|core|facility|consortium|network|department|division|school|college';

/**
 * The role-noun and endowed-chair markers key on "is ... Professor", but that
 * clause belongs to an organization rather than a person in "The Thinking Lab is
 * directed by Woo-kyoung Ahn, Professor of Psychology". A description whose
 * subject is the research home is describing the home, so naming its director's
 * title does not make it a biography.
 *
 * Anchored to the subject noun phrase - the article plus at most a few modifiers
 * before the head noun - rather than to a character window over the opening. A
 * window admits the head noun as an object too, which exempted the genuine
 * biography "Jane Doe is Professor of Neurology and chief of the Sleep Program".
 */
const ORG_SUBJECT_LEAD = new RegExp(
  `^(?:welcome\\s+to\\s+)?(?:the|our|this)?\\s*(?:[\\p{L}][\\p{L}'’&-]*\\s+){0,3}(?:${RESEARCH_HOME_HEAD_NOUN})s?\\b`,
  'iu',
);

const LED_BY_CONSTRUCTION = /\bis\s+(?:directed|led|headed|chaired|co-directed)\s+by\b/i;

const PERSON_TITLE_SUBJECT = /^(?:[^.]{0,80},\s*)?(?:dr|prof|professor|mr|ms|mrs)\.?\s+[A-Z]/i;
const PERSON_PRONOUN_SUBJECT = /^(?:he|she|they)\b/i;
// The capitalized run before a career verb, as in "Nicholas R. Parrillo is" or
// "Carrie A. Redlich, MD, is". Excluded when that run is itself a research home,
// so "The Smith Lab joined the Yale Cancer Biology Institute" is not read as a
// person joining a faculty.
const PERSON_NAME_SUBJECT = new RegExp(
  `^([A-Z][\\p{L}'’.-]+(?:\\s+[A-Z][\\p{L}'’.-]*\\.?){1,3})(?:,\\s*[^,.]{1,40})?,?\\s+` +
    '(?:is|was|serves?|served|joined|holds?|has|had|became|received|earned|completed|obtained|graduated|practices?|specializes?)\\b',
  'u',
);
const RESEARCH_HOME_HEAD_NOUN_RE = new RegExp(`\\b(?:${RESEARCH_HOME_HEAD_NOUN})s?\\b`, 'i');

function hasPersonSubjectLead(opening: string): boolean {
  if (PERSON_PRONOUN_SUBJECT.test(opening) || PERSON_TITLE_SUBJECT.test(opening)) return true;
  const named = PERSON_NAME_SUBJECT.exec(opening);
  return Boolean(named) && !RESEARCH_HOME_HEAD_NOUN_RE.test(named![1]);
}

/**
 * Whether one sentence states a career fact on its own: where the subject
 * trained, what they were appointed to, what they have been awarded.
 *
 * Deliberately the unconditional marker list only. The person-subject markers are
 * excluded because "is <a role noun>" is how a good body orients the reader before
 * describing the work ("Justin Willson is a historian of Byzantine and early
 * Slavic art", "Ryan Rimmer, MD is a subspecialty-trained otolaryngologist"), and
 * on Development 10 of the bodies whose credential opener is stripped lead with
 * exactly that sentence. Judging a promoted opener on the whole predicate would
 * withdraw those strips.
 */
export function isCareerFactSentence(sentence: unknown): boolean {
  const text = textValue(sentence);
  if (!text) return false;
  return CAREER_BIOGRAPHY_MARKERS.some((marker) => marker.test(text));
}

export function opensOnResearchHomeSubject(opening: string): boolean {
  return LED_BY_CONSTRUCTION.test(opening) || ORG_SUBJECT_LEAD.test(opening);
}

export function careerBiographyOpening(value: unknown): string[] {
  return splitDescriptionSentences(textValue(value)).slice(0, CAREER_MARKER_SENTENCE_WINDOW);
}

export function isCareerBiographyDescription(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  const opening = careerBiographyOpening(text).join(' ');
  if (opensOnResearchHomeSubject(opening)) return false;
  if (CAREER_BIOGRAPHY_MARKERS.some((marker) => marker.test(opening))) return true;
  return (
    hasPersonSubjectLead(opening) &&
    PERSON_SUBJECT_CAREER_MARKERS.some((marker) => marker.test(opening))
  );
}

const RESEARCH_STATEMENT_SUBJECT = [
  "(?:[Hh]is|[Hh]er|[Tt]heir|[Mm]y|[Oo]ur|(?:[A-Z][A-Za-z.'’-]+\\s+){0,3}[A-Z][A-Za-z.'’-]*?(?:['’]s|s['’]))\\s+(?:(?:current|primary|main|principal|recent|ongoing|academic|other)\\s+)?" +
    '(?:(?:areas?|fields?)\\s+of\\s+(?:academic\\s+)?(?:research|study|expertise)' +
    '|(?:teaching\\s+and\\s+)?research(?:\\s+and\\s+teaching)?(?:\\s+(?:interests?|program|agenda))?' +
    '|scholarship)',
  'The\\s+(?:(?:primary|main|central|principal)\\s+)?focus\\s+of\\s+(?:his|her|their|my|our)\\s+' +
    '(?:(?:current|recent)\\s+)?(?:research|scholarship)',
].join('|');

const RESEARCH_STATEMENT_LEAD_IN =
  '(?:(?:Most\\s+recently|More\\s+recently|Recently|Currently|Today|In\\s+addition|Additionally|' +
  'In\\s+(?:the\\s+)?(?:area|field|context)\\s+of\\s+[^,.]{1,80}),?\\s+)?';

const RESEARCH_STATEMENT_SENTENCE = new RegExp(
  `^${RESEARCH_STATEMENT_LEAD_IN}(?:${RESEARCH_STATEMENT_SUBJECT})\\s+(?:(?:has|have)\\s+)?(?:\\w+ly\\s+)?` +
    '(?:(?:is|are|was|were)(?!\\s+(?:\\w+ly\\s+)?(?:supported|funded|sponsored|published|featured|recognized|cited|' +
    'covered|highlighted|awarded))|focus(?:es|ed)?|cent(?:er|re)(?:s|d)?|examines?|explores?|investigates?|' +
    'includes?|spans?|concerns?|addresses?|lies|revolves|engages?|seeks?|aims?)\\b',
);

const RESEARCH_TOPICS_SENTENCE =
  /^(?:(?:Active|Current|Ongoing|Recent)\s+)*(?:current\s+)?(?:research\s+(?:topics|areas|projects|questions)|projects)\s+(?:are|include)\b/i;

const RESEARCH_ACTIVITY_SENTENCE =
  /^(?:He|She|They|We|I|(?:His|Her|Their|Our|My)\s+(?:(?:recent|current)\s+)?(?:work|lab|group|research|scholarship)|(?:Dr\.?\s+|Professor\s+)?[A-Z][\p{L}'’-]+(?:['’]s\s+(?:(?:recent|current)\s+)?(?:work|lab|group|research))?)\s+(?:has\s+|have\s+)?(?:(?:also|currently|primarily|mainly|further)\s+)?(?:studies|investigates|examines|explores|analy[sz]es|evaluates|models|develops|focus(?:es|ed)|concerns|addresses|asks|seeks|aims|works\s+on|combines|employs|applies|uses\s+(?:diverse\s+|a\s+)?(?:research\s+)?(?:methods|methodologies|approaches|techniques)|uses\s+\w+(?:\s+\w+)?\s+to\s+(?:study|understand|examine|investigate))\b/u;

const CV_RECORD_SENTENCE =
  /\b(?:teach(?:es|ing)?\s+(?:\w+\s+){0,2}(?:courses?|classes|seminars?)|(?:has|have|holds?)\s+(?:an?\s+)?(?:B\.?A|B\.?S|M\.?A|M\.?S|M\.?B\.?A|J\.?D|M\.?D|Ph\.?\s?D)\b|(?:has|have)\s+published\b|author\s+of\b|(?:co-?)?editors?\s+of\b|(?:received|won)\s+(?:the|an?)\s+[^.]{0,60}\b(?:awards?|prizes?|medals?)\b)/i;

/**
 * The sentences of a biography that state, in their own subject, what the person
 * researches: "Her area of academic research is ...", "The focus of his current
 * research is ...", and the prose that follows such a statement ("She studies how
 * firms respond ...", "Using spectroscopy, her group has uncovered ..."), less the
 * career facts and CV records (teaching load, degrees, publication record, editorships,
 * prizes) mixed into it. A profile that pastes a CV (degree line, book list, awards,
 * past appointments) usually still carries such sentences, and they are the only
 * part a student opened the page to read. Returns nothing unless at least one
 * explicit research statement is present, because a subject frame is what makes
 * lifting sentences out safe: its start is a real sentence start, so a false
 * boundary inside a book title or degree cannot produce the fragment that
 * opener-stripping did.
 */
export function researchStatementSentences(value: unknown): string[] {
  const sentences = splitDescriptionSentences(textValue(value));
  const firstStatement = sentences.findIndex((sentence) =>
    RESEARCH_STATEMENT_SENTENCE.test(sentence),
  );
  if (firstStatement < 0) return [];
  return sentences.filter(
    (sentence, index) =>
      RESEARCH_STATEMENT_SENTENCE.test(sentence) ||
      RESEARCH_TOPICS_SENTENCE.test(sentence) ||
      (!isCareerFactSentence(sentence) &&
        (RESEARCH_ACTIVITY_SENTENCE.test(sentence) ||
          (index > firstStatement && !CV_RECORD_SENTENCE.test(sentence)))),
  );
}
