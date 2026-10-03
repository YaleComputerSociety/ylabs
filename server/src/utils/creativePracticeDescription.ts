export type CreativePracticeEvidence =
  'exhibition' | 'performance' | 'composition' | 'production' | 'writing' | 'practitioner';

const ARTS_PRACTICE_DEPARTMENTS: ReadonlySet<string> = new Set([
  'music',
  'art',
  'architecture',
  'film & media studies',
  'theater, dance, & performance studies',
  'theater and performance studies',
  'english language & literature',
]);

const ARTS_PRACTICE_SCHOOL =
  /\b(?:school of music|school of art|school of drama|school of architecture|institute of sacred music)\b/i;

const PRACTICE_EVIDENCE: ReadonlyArray<readonly [CreativePracticeEvidence, RegExp]> = [
  [
    'exhibition',
    /\b(?:exhibit(?:ed|ions?)|solo shows?|group shows?|biennale|biennial|galler(?:y|ies)|(?:has|have) been shown|permanent collections?|in the collections? of|installations?)\b/i,
  ],
  [
    'performance',
    /\b(?:has performed|performed (?:at|with|in|on|throughout|internationally|widely)|performs (?:at|with|in|regularly|internationally|widely)|performances? (?:at|with|of|in)\b|concerts?|recitals?|orchestras?|symphon(?:y|ies)|chamber music|ensembles?|toured|tours? (?:of|with)|recordings?|recorded|albums?|discography|opera(?:s|tic)?|broadway|off-broadway|stage|theat(?:er|re)s?|repertory|choreograph\w*|danced)\b/i,
  ],
  [
    'composition',
    /\b(?:composer|compositions?|commissioned|commissions? (?:from|by)|premiered|premieres?|world premiere|works have been performed|scores?)\b/i,
  ],
  [
    'production',
    /\b(?:productions?|produced|directed|playwright|plays (?:include|have)|dramaturg\w*|designed (?:sets|costumes|lighting|sound|scenery)|scenic|costume design|lighting design|sound design|screened|festivals?|feature films?|documentar(?:y|ies))\b/i,
  ],
  [
    'writing',
    /\b(?:novels?|novelist|poet(?:ry|s)?|poems?|collections? of (?:poems|stories|essays)|short stor(?:y|ies)|memoir|fiction|essayist|(?:her|his|their) books include)\b/i,
  ],
  [
    'practitioner',
    /(?:^|\bis\s+|\bas\s+)an?\s+(?:[\w-]+\s+){0,3}(?:artist|composer|pianist|violinist|violist|cellist|organist|harpsichordist|guitarist|percussionist|trombonist|trumpeter|hornist|bassoonist|oboist|clarinetist|flutist|saxophonist|bassist|conductor|soloist|recitalist|chamber musician|instrumentalist|musician|actor|actress|playwright|poet|novelist|photographer|filmmaker|choreographer|dancer|sculptor|painter|singer|soprano|mezzo-soprano|tenor|baritone|bass-baritone|vocalist|director|designer|performer|printmaker|illustrator|typographer|writer|theatre-maker|theater-maker|producer|curator)\b/i,
  ],
];

// A synthesized body written in the research voice ("Studies ...", "Examines ...") is the
// lane asserting research, so it is read as a research statement rather than overruled.
const RESEARCH_VOICE_OPENING = /^(?:studies|examines|investigates|analy[sz]es)\b/i;

// An artwork, not the person, is the subject of "work that examines memory": that is an
// artist statement, so the verb is not a research claim.
const ARTWORK_AS_SUBJECT =
  /\b(?:work|works|practice|series|films?|paintings?|sculptures?|photographs?|installations?|performances?|projects?|pieces?)\s+(?:that\s+|which\s+)?(?:often\s+)?(?:examines?|explores?|investigates?|studies)\b/gi;

// The revoicer writes "This researcher" in place of a person's name, so the phrase is the
// pipeline's own wording and says nothing about what the person does.
const REVOICED_PERSON_PLACEHOLDER = /\bthis researcher\b/gi;

const RESEARCH_STATEMENT =
  /\b(?:research(?:es|er|ers)?|scholar(?:ship|ly)?|musicolog\w*|ethnomusicolog\w*|theorist|music theory|cognition|cognitive|neuroscien\w*|psycholog\w*|empirical|digital humanities|computational|historian|history of|studies how|studies the|investigates how|examines how|analy(?:s|z)\w*|dissertation|ph\.?d\.? (?:candidate|student)|peer-reviewed|(?:published |appears? |appeared )?in (?:the )?journals?|journals? (?:such as|including)|journal of|monographs?|case study|university press)\b/i;

const MIN_PRACTICE_EVIDENCE_KINDS = 2;

const RESEARCH_VOICE_VERB =
  /\b(?:stud(?:y|ies)|investigat\w*|examin\w*|research\w*|analy[sz]\w*)\b/;

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export interface ArtsPracticeContextInput {
  departments?: unknown;
  school?: unknown;
}

export function isArtsPracticeContext({ departments, school }: ArtsPracticeContextInput): boolean {
  const departmentList = Array.isArray(departments) ? departments : [];
  return (
    departmentList.some((department) =>
      ARTS_PRACTICE_DEPARTMENTS.has(textValue(department).toLowerCase()),
    ) || ARTS_PRACTICE_SCHOOL.test(textValue(school))
  );
}

export function creativePracticeEvidence(value: unknown): CreativePracticeEvidence[] {
  const text = textValue(value);
  if (!text) return [];
  return PRACTICE_EVIDENCE.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}

export function statesCreativePractice(value: unknown): boolean {
  return creativePracticeEvidence(value).length >= MIN_PRACTICE_EVIDENCE_KINDS;
}

export function statesResearchApartFromArtwork(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  if (RESEARCH_VOICE_OPENING.test(text)) return true;
  return RESEARCH_STATEMENT.test(
    text.replace(REVOICED_PERSON_PLACEHOLDER, ' ').replace(ARTWORK_AS_SUBJECT, ' '),
  );
}

// Lower case on purpose: "Theatre Studies Program" and "Graduate Studies" name an
// office, while "studies chamber music" and an opening "Studies ..." claim research.
export function cardSpeaksInResearchVoice(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  if (RESEARCH_VOICE_OPENING.test(text)) return true;
  return RESEARCH_VOICE_VERB.test(text.replace(ARTWORK_AS_SUBJECT, ' '));
}

export interface CreativePracticeInput extends ArtsPracticeContextInput {
  fullDescription?: unknown;
  shortDescription?: unknown;
}

export interface CreativePracticeDecision {
  creativePractice: boolean;
  evidence: CreativePracticeEvidence[];
}

export const NOT_CREATIVE_PRACTICE: Readonly<CreativePracticeDecision> = Object.freeze({
  creativePractice: false,
  evidence: [],
});

/**
 * Whether a served row's own evidence describes creative practice rather than research
 * (owner decision 2026-10-03, #4519). The body is the evidence; the card is read only when
 * no body serves, because a card is usually derived from the body and adds no evidence.
 */
export function decideCreativePractice(
  input: CreativePracticeInput,
): Readonly<CreativePracticeDecision> {
  if (!isArtsPracticeContext(input)) return NOT_CREATIVE_PRACTICE;
  const evidenceText = textValue(input.fullDescription) || textValue(input.shortDescription);
  if (!evidenceText || statesResearchApartFromArtwork(evidenceText)) return NOT_CREATIVE_PRACTICE;
  const evidence = creativePracticeEvidence(evidenceText);
  if (evidence.length < MIN_PRACTICE_EVIDENCE_KINDS) return NOT_CREATIVE_PRACTICE;
  return { creativePractice: true, evidence };
}

export const servedCreativePracticeFlag = (
  decision: Pick<CreativePracticeDecision, 'creativePractice'> | undefined,
): { creativePractice?: true } => (decision?.creativePractice ? { creativePractice: true } : {});
