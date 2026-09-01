/**
 * A description is servable when it names what the home actually studies.
 *
 * The ten source-type predicates in researchEntityDescriptionText.ts classify
 * text by where it came from (an about block, a mission statement, a person
 * bio, an appointment line). That family is exhausted: across the whole served
 * corpus it fires once, while the #2176 Horsley defect ("Our Mission Create and
 * communicate high-quality and creative science...") trips none of them because
 * it is fluent, well-formed, research-adjacent prose that simply names no
 * subject.
 *
 * Source type is also the wrong axis. Of the served descriptions containing
 * "Our Mission", most name a real subject and are good ("Our Mission is to
 * decipher immune dysregulation underlying early-life critical illness"), so
 * demoting the category would discard more good prose than bad. Symmetrically a
 * first-person bio sentence can be the best available statement of the research
 * ("My research is focused on understanding the genetic and epigenetic basis of
 * lung disease"). Voice and page section carry no signal; the named subject does.
 *
 * This module judges the extracted subject on the two axes that do carry signal:
 * whether a concrete subject is named, and whether that subject belongs to this
 * entity rather than to its parent department, center, or hospital (#2183).
 *
 * Nothing in the pipeline gates on this yet. The A/B run recorded in
 * scripts/descriptionPromptAbHarness.ts rejected gating on `subjectScope`,
 * because the model's scope judgement moved between runs and false-rejected a
 * confirmed good description. Re-measure with that harness before wiring
 * judgeResearchSubject into extraction or serving.
 *
 * ## What the extraction around this gate can and cannot see (#2272, 2026-08-29)
 *
 * `scripts/offEntityGraftAudit.ts` supplies the missing extraction and runs it
 * over the served LAB and FACULTY_RESEARCH_AREA corpus with the record name and
 * type in the prompt, `reasoning_effort: 'medium'` set explicitly, and a verdict
 * recorded only when three runs agree. At that setting the field IS stable: 289 of
 * 300 sampled student_ready records came back unanimous.
 *
 * It is also nearly silent. Unanimous `parent_org` was 1 of 300 (0.3%, Wilson
 * 0.1-1.9%), and `parent_org` or `unclear` together 3 of 300 (1.0%, 0.3-2.9%).
 * Two structural blind spots explain the gap between that and the hand-read
 * estimate of the class, and both were confirmed by re-judging known grafts:
 *
 *   1. `subjectScope` compares the prose to the record's SERVED NAME, not to the
 *      record's identity. When a graft took the name and the prose together, the
 *      two agree and the verdict is a confident, unanimous `this_entity`: a lab
 *      member's record serving "The Liu Lab" plus that lab's research paragraph
 *      scored this_entity 3 for 3, and only re-judging it under the person's real
 *      name moved it off. 25 served student_ready records carry a name that
 *      provably belongs to a different served record, so the instrument is blind
 *      by construction on more records than it flags.
 *   2. The rubric has no bucket for a PEER entity. `parent_org` is defined as an
 *      organization that CONTAINS the record, so another lab's prose has no
 *      correct answer and lands on `unclear` or splits the runs.
 *
 * So a `parent_org` rate is a floor on this defect class and never its size. An
 * instrument that measures it needs to judge prose against an identity derived
 * independently of the served name (the entity key, the roster, the profile), and
 * a scope value for a peer entity.
 */

export type ResearchSubjectScope = 'this_entity' | 'parent_org' | 'unclear';

export const RESEARCH_SUBJECT_SCOPES: readonly ResearchSubjectScope[] = [
  'this_entity',
  'parent_org',
  'unclear',
];

export function normalizeResearchSubjectScope(value: unknown): ResearchSubjectScope {
  const text =
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_')
      : '';
  return (RESEARCH_SUBJECT_SCOPES as readonly string[]).includes(text)
    ? (text as ResearchSubjectScope)
    : 'unclear';
}

/**
 * Words that describe the posture of research rather than its subject. A
 * subject built only from these names nothing a student could decide about:
 * "the nexus between hardware, computing, and data science" is indistinguishable
 * from any other engineering group, while "extracorporeal membrane oxygenation"
 * is not.
 *
 * Terms that can carry real subject matter in the right context are deliberately
 * absent (brain, gene, cell, climate, language, policy, cancer). This list is
 * only for vocabulary that never narrows a field on its own.
 */
const GENERIC_SUBJECT_TERMS = new Set([
  'a',
  'advance',
  'advances',
  'advancing',
  'an',
  'analysis',
  'and',
  'application',
  'applications',
  'applied',
  'approach',
  'approaches',
  'area',
  'areas',
  'art',
  'at',
  'basic',
  'benchside',
  'best',
  'bold',
  'breakthrough',
  'breakthroughs',
  'broad',
  'care',
  'center',
  'centre',
  'challenge',
  'challenges',
  'change',
  'collaboration',
  'collaborations',
  'collaborative',
  'commitment',
  'committed',
  'community',
  'complex',
  'comprehensive',
  'computing',
  'contemporary',
  'creative',
  'critical',
  'cross',
  'cutting',
  'data',
  'design',
  'develop',
  'developing',
  'development',
  'discipline',
  'disciplines',
  'discovery',
  'discoveries',
  'disseminate',
  'dissemination',
  'diverse',
  'diversity',
  'edge',
  'education',
  'educational',
  'effort',
  'efforts',
  'emerging',
  'engage',
  'engagement',
  'enterprise',
  'equity',
  'excellence',
  'expertise',
  'field',
  'fields',
  'focus',
  'for',
  'foundational',
  'frontier',
  'frontiers',
  'fundamental',
  'future',
  'generation',
  'global',
  'goal',
  'goals',
  'groundbreaking',
  'group',
  'growth',
  'hardware',
  'healthcare',
  'high',
  'impact',
  'impactful',
  'improve',
  'improving',
  'in',
  'inclusion',
  'inclusive',
  'influential',
  'informatics',
  'initiative',
  'initiatives',
  'innovation',
  'innovations',
  'innovative',
  'inquiry',
  'insight',
  'insights',
  'institute',
  'integrate',
  'integrated',
  'interdisciplinary',
  'international',
  'interest',
  'interests',
  'investigation',
  'investigations',
  'issue',
  'issues',
  'knowledge',
  'lab',
  'laboratory',
  'lead',
  'leader',
  'leaders',
  'leadership',
  'leading',
  'method',
  'methods',
  'mission',
  'modern',
  'multidisciplinary',
  'nexus',
  'next',
  'novel',
  'of',
  'on',
  'or',
  'organization',
  'outcome',
  'outcomes',
  'outreach',
  'partnership',
  'partnerships',
  'people',
  'pioneering',
  'practice',
  'preeminent',
  'premier',
  'principle',
  'principles',
  'priority',
  'problem',
  'problems',
  'process',
  'processes',
  'program',
  'programs',
  'project',
  'projects',
  'promote',
  'promoting',
  'question',
  'questions',
  'quality',
  'renowned',
  'research',
  'researcher',
  'researchers',
  'resource',
  'resources',
  'rigorous',
  'scholarship',
  'science',
  'sciences',
  'scientific',
  'scientist',
  'scientists',
  'service',
  'society',
  'solution',
  'solutions',
  'state',
  'strategic',
  'strength',
  'strengths',
  'student',
  'students',
  'study',
  'studies',
  'support',
  'sustainable',
  'system',
  'systems',
  'teaching',
  'team',
  'technique',
  'techniques',
  'technologies',
  'technology',
  'the',
  'their',
  'theme',
  'themes',
  'to',
  'tool',
  'tools',
  'topic',
  'topics',
  'traditional',
  'train',
  'training',
  'transform',
  'transformation',
  'transforming',
  'translational',
  'understand',
  'understanding',
  'unique',
  'various',
  'vision',
  'we',
  'with',
  'work',
  'works',
  'world',
]);

/**
 * Function words carry no subject matter but are long enough to clear the
 * short-token floor, so without them "the nexus between hardware, computing, and
 * data science" scores as specific on the strength of "between". The same list
 * guards the acronym path, where all-caps headings ("WHO WE ARE", "OUR MISSION")
 * would otherwise read as subject-bearing acronyms, so short function words that
 * the floor already drops belong here too.
 */
const FUNCTION_WORDS = new Set([
  'about',
  'above',
  'across',
  'after',
  'against',
  'all',
  'along',
  'also',
  'am',
  'among',
  'any',
  'are',
  'around',
  'as',
  'be',
  'because',
  'been',
  'before',
  'behind',
  'being',
  'below',
  'beneath',
  'best',
  'better',
  'between',
  'beyond',
  'both',
  'but',
  'by',
  'can',
  'could',
  'developed',
  'did',
  'do',
  'does',
  'during',
  'each',
  'either',
  'especially',
  'every',
  'few',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'here',
  'his',
  'how',
  'however',
  'if',
  'including',
  'inside',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'less',
  'like',
  'made',
  'main',
  'major',
  'many',
  'may',
  'me',
  'might',
  'more',
  'most',
  'much',
  'must',
  'my',
  'near',
  'neither',
  'new',
  'no',
  'nor',
  'not',
  'now',
  'off',
  'one',
  'only',
  'onto',
  'other',
  'others',
  'our',
  'ours',
  'out',
  'over',
  'own',
  'particular',
  'per',
  'range',
  'ranging',
  'related',
  'same',
  'several',
  'she',
  'should',
  'since',
  'so',
  'some',
  'such',
  'than',
  'that',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'three',
  'through',
  'throughout',
  'thus',
  'two',
  'under',
  'until',
  'up',
  'upon',
  'us',
  'use',
  'used',
  'uses',
  'using',
  'very',
  'via',
  'was',
  'well',
  'were',
  'what',
  'when',
  'where',
  'whether',
  'which',
  'while',
  'who',
  'whose',
  'why',
  'wide',
  'will',
  'within',
  'without',
  'would',
  'you',
  'your',
]);

const MIN_SPECIFIC_TERM_LENGTH = 3;

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * Hyphens split rather than bind, because a compound built from posture words
 * ("high-quality", "cutting-edge") would otherwise survive as one unrecognized
 * token and read as specific. Splitting also costs nothing on real compounds:
 * "non-epithelial" still contributes "epithelial".
 */
function subjectTerms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}'’]+/u)
    .map((term) => term.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

function isNonSubjectWord(term: string): boolean {
  return GENERIC_SUBJECT_TERMS.has(term) || FUNCTION_WORDS.has(term);
}

function isSubjectBearingTerm(term: string): boolean {
  if (term.length < MIN_SPECIFIC_TERM_LENGTH) return false;
  if (isNonSubjectWord(term)) return false;
  if (/^\d+$/.test(term)) return false;
  return true;
}

const ACRONYM_PATTERN = /\b[A-Z]{2,}[0-9]*\b/g;

/**
 * An acronym a lab uses for its own subject ("ECMO", "VAD", "REEES") is highly
 * specific even though it is short, so case is evidence here and the lowercased
 * term list cannot be the only input. Counted distinctly and only when the term
 * list did not already count it, so a repeated acronym and an all-caps heading of
 * ordinary words ("WHO WE ARE") cannot inflate the score.
 */
function subjectBearingAcronyms(value: string, countedTerms: Set<string>): string[] {
  const distinct = new Set<string>();
  for (const token of value.match(ACRONYM_PATTERN) ?? []) {
    const term = token.toLowerCase();
    if (isNonSubjectWord(term)) continue;
    if (countedTerms.has(term)) continue;
    distinct.add(term);
  }
  return [...distinct];
}

function subjectSpecificity(text: string): { terms: string[]; acronyms: string[] } {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of subjectTerms(text)) {
    if (!isSubjectBearingTerm(term)) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return { terms, acronyms: subjectBearingAcronyms(text, seen) };
}

export function specificResearchSubjectTerms(value: unknown): string[] {
  const text = textValue(value);
  if (!text) return [];
  return subjectSpecificity(text).terms;
}

/**
 * A subject naming nothing outside the generic-posture vocabulary. This is the
 * aidc failure mode ("our mission stands at the nexus between hardware,
 * computing, and data science") and the reason an empty extraction is the
 * correct answer for such a page rather than a description to serve.
 */
export function isGenericResearchSubject(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return true;
  const { terms, acronyms } = subjectSpecificity(text);
  return terms.length === 0 && acronyms.length === 0;
}

/**
 * Positive specificity, in distinct subject-bearing terms. Deliberately
 * unbounded at the low end and saturating at the top: the signal we need is
 * "does this name a subject at all, and roughly how narrowly", not a fine
 * ranking among already-specific candidates.
 */
export function researchSubjectSpecificityScore(value: unknown): number {
  const text = textValue(value);
  if (!text) return 0;
  const { terms, acronyms } = subjectSpecificity(text);
  return Math.min(terms.length + acronyms.length, 8);
}

export interface ResearchSubjectJudgement {
  subject: string;
  scope: ResearchSubjectScope;
  specificity: number;
  isServable: boolean;
  rejectionReason?: 'no_subject' | 'generic_subject' | 'parent_org_subject' | 'unclear_scope';
}

/**
 * The servability decision for one extracted candidate.
 *
 * `unclear` scope is rejected alongside `parent_org`: the parent-org failures in
 * the corpus (a Department of Pediatrics vision statement, a CORE center
 * marketing blurb) both sit on one person's record, and serving another
 * organization's research as this entity's is the identity defect that costs the
 * most trust. When attribution cannot be established, holding is correct.
 */
export function judgeResearchSubject(input: {
  subject: unknown;
  scope: unknown;
}): ResearchSubjectJudgement {
  const subject = textValue(input.subject);
  const scope = normalizeResearchSubjectScope(input.scope);
  const specificity = researchSubjectSpecificityScore(subject);
  const base = { subject, scope, specificity };
  if (!subject) return { ...base, isServable: false, rejectionReason: 'no_subject' };
  if (isGenericResearchSubject(subject))
    return { ...base, isServable: false, rejectionReason: 'generic_subject' };
  if (scope === 'parent_org')
    return { ...base, isServable: false, rejectionReason: 'parent_org_subject' };
  if (scope === 'unclear') return { ...base, isServable: false, rejectionReason: 'unclear_scope' };
  return { ...base, isServable: true };
}
