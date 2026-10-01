/**
 * The year of study a Student Grants Database fund admits, read from the page's own
 * eligibility prose before its "Current Year of Study" search filter (#4216).
 *
 * The filter is set by whoever listed the fund and often disagrees with the prose: it
 * lists a year the prose excludes, or omits a level the prose admits. The prose is the
 * fund's own statement, so it decides whenever it names years or levels; the filter is
 * used only when the prose is silent. A prose level with no exact value in the stored
 * vocabulary (a "graduate affiliate", or an incoming student described as rising into
 * their first year) cannot be reconciled with either, so no value is emitted.
 */

export const YEAR_OF_STUDY_VOCABULARY = [
  'First-Year Student',
  'Sophomore',
  'Junior',
  'Senior',
  'Master’s Student',
  'PhD Pre-Candidacy',
  'PhD Post-Candidacy',
  'JD',
  'MD',
  'Alumni',
] as const;

export type YearOfStudy = (typeof YEAR_OF_STUDY_VOCABULARY)[number];

export interface FundEligibilityProse {
  text: string;
  isEligibilitySection: boolean;
}

export type FundYearOfStudyResolution =
  | { kind: 'prose'; values: YearOfStudy[] }
  | { kind: 'filter'; values: string[] }
  | { kind: 'unreconcilable' };

const UNDERGRADUATE_YEARS: YearOfStudy[] = ['First-Year Student', 'Sophomore', 'Junior', 'Senior'];
const DOCTORAL: YearOfStudy[] = ['PhD Pre-Candidacy', 'PhD Post-Candidacy'];
const PROFESSIONAL: YearOfStudy[] = ['JD', 'MD'];
const GRADUATE_SCHOOL: YearOfStudy[] = ['Master’s Student', ...DOCTORAL];

type GenericLevel = 'undergraduate' | 'graduate' | 'professional' | 'doctoral';

const GENERIC_LEVEL_VALUES: Record<GenericLevel, YearOfStudy[]> = {
  undergraduate: UNDERGRADUATE_YEARS,
  graduate: GRADUATE_SCHOOL,
  professional: PROFESSIONAL,
  doctoral: DOCTORAL,
};

// "Graduate students" is read as the graduate school when it stands alone, because pages
// that mean law and medical students too say "graduate and professional"; a filter that
// also lists JD or MD under a bare "graduate" is compatible with the wider reading.
const GENERIC_LEVEL_REFINABLE_VALUES: Record<GenericLevel, YearOfStudy[]> = {
  ...GENERIC_LEVEL_VALUES,
  graduate: [...GRADUATE_SCHOOL, ...PROFESSIONAL],
};

type LevelTerm =
  | { kind: 'year'; values: YearOfStudy[] }
  | { kind: 'generic'; level: GenericLevel }
  | { kind: 'degree'; values: YearOfStudy[] }
  | { kind: 'alumni' }
  | { kind: 'unmapped' };

interface TermPattern {
  pattern: RegExp;
  term: LevelTerm;
  standsAlone: boolean;
}

const year = (value: YearOfStudy): LevelTerm => ({ kind: 'year', values: [value] });
const generic = (level: GenericLevel): LevelTerm => ({ kind: 'generic', level });
const degree = (value: YearOfStudy): LevelTerm => ({ kind: 'degree', values: [value] });
const ALUMNI: LevelTerm = { kind: 'alumni' };
const UNMAPPED: LevelTerm = { kind: 'unmapped' };

const TERM_PATTERNS: TermPattern[] = [
  { pattern: /^graduate affiliates?$/, term: UNMAPPED, standsAlone: true },
  { pattern: /^rising (?:first years?|freshm[ae]n)$/, term: UNMAPPED, standsAlone: true },
  { pattern: /^rising sophomores$/, term: year('First-Year Student'), standsAlone: true },
  { pattern: /^rising juniors$/, term: year('Sophomore'), standsAlone: true },
  { pattern: /^rising seniors$/, term: year('Junior'), standsAlone: true },
  { pattern: /^(?:first years|freshmen)$/, term: year('First-Year Student'), standsAlone: true },
  { pattern: /^(?:first year|freshman)$/, term: year('First-Year Student'), standsAlone: false },
  { pattern: /^sophomores$/, term: year('Sophomore'), standsAlone: true },
  { pattern: /^sophomore$/, term: year('Sophomore'), standsAlone: false },
  { pattern: /^juniors$/, term: year('Junior'), standsAlone: true },
  { pattern: /^junior$/, term: year('Junior'), standsAlone: false },
  { pattern: /^seniors$/, term: year('Senior'), standsAlone: true },
  { pattern: /^senior$/, term: year('Senior'), standsAlone: false },
  { pattern: /^(?:undergraduates|undergrads)$/, term: generic('undergraduate'), standsAlone: true },
  {
    pattern: /^(?:undergraduate|undergrad|yale college)$/,
    term: generic('undergraduate'),
    standsAlone: false,
  },
  { pattern: /^graduate$/, term: generic('graduate'), standsAlone: false },
  { pattern: /^professional(?: school)?$/, term: generic('professional'), standsAlone: false },
  { pattern: /^(?:doctoral|phd)$/, term: generic('doctoral'), standsAlone: false },
  {
    pattern: /^master(?:'s|s)?(?: degree| level)?$/,
    term: degree('Master’s Student'),
    standsAlone: false,
  },
  { pattern: /^(?:law(?: school)?|jd)$/, term: degree('JD'), standsAlone: false },
  { pattern: /^(?:medical(?: school)?|md)$/, term: degree('MD'), standsAlone: false },
  {
    pattern: /^(?:alumni|alumnae|alums|recent graduates|recent alumni)$/,
    term: ALUMNI,
    standsAlone: true,
  },
];

const TERM_SOURCE =
  "graduate affiliates?(?! network)|rising (?:first years?|freshm[ae]n|sophomores|juniors|seniors)|recent (?:graduates|alumni)|first years?|freshm[ae]n|sophomores?|juniors?|seniors?|undergraduates?|undergrads?|yale college|graduate(?!s)|professional(?: school)?|master(?:'s|s)?(?: degree| level)?|doctoral|phd|law(?: school)?|jd|medical(?: school)?|md|alumni|alumnae|alums";

const CONNECTOR_SOURCE =
  '(?:\\s*(?:,|&|/|\\band/or\\b|\\band\\b|\\bor\\b|\\bthrough\\b)\\s*)+|\\s+';

const PERSON_HEAD_SOURCE = '(?:students?|scholars|candidates|applicants)';

const HEAD_SOURCE = `(?:${PERSON_HEAD_SOURCE}|programs?)`;

const GROUP = new RegExp(
  `\\b(?:${TERM_SOURCE})\\b(?:(?:${CONNECTOR_SOURCE})(?:${TERM_SOURCE})\\b)*(?:\\s+${HEAD_SOURCE}\\b)?`,
  'g',
);

const TERM = new RegExp(`\\b(?:${TERM_SOURCE})\\b`, 'g');

const ENDS_IN_PERSON_HEAD = new RegExp(`\\s${PERSON_HEAD_SOURCE}$`);

const ENDS_IN_PROGRAM_HEAD = /\sprograms?$/;

const ENROLLED_IN = /\benrolled in\s+(?:an?\s+|the\s+)?$/;

const ANY_LEVEL = /\bstudents?\s+(?:at|of)\s+(?:any|all)\s+(?:levels?|stages?)\b/;

const ELIGIBILITY_CUE =
  /\b(?:eligib\w*|open(?: only)? to|available(?: only)? to|intended(?: only)? for|designed for|limited to|restricted to|reserved for|awarded(?: only)? to|awards? to|enrolled in|welcomed? from|applications? (?:are )?(?:accepted |invited |welcomed? )?from|must be(?: an?)?)\b/;

const GROUP_MODIFIERS =
  '(?:for|to|of|the|all|any|current|currently|enrolled|yale|university|college)';

const SUPPORT_CUE = new RegExp(`\\bsupport(?:s|ing)?\\s+(?:${GROUP_MODIFIERS}\\s+)*$`);

const SENTENCE_OPENING_FOR = /^\W*for\b(?:\W+\w+){0,3}?\W*$/;

const ADMISSION_AFTER =
  /^\W*(?:\w+\W+){0,5}?(?:(?:are|is)\s+(?:also\s+|only\s+)?(?:eligible|invited|welcome)|may (?:also |only )?apply|can (?:also |only )?apply)\b/;

const QUANTIFIED_COMPLETE =
  /\b(?:any|all|every)\s+(?:(?:current|currently|enrolled|yale|university|college)\s+)*$/;

const PREFERENCE =
  /\b(?:preference|priority|preferred|prioritiz\w*|encouraged|especially|particularly)\b/;

const PREFERENCE_AFTER =
  /^[^,;]{0,40}?\b(?:receive|be given|are given|get)\s+(?:first\s+|special\s+)?(?:priority|preference)\b/;

const ADDITIVE_BEFORE =
  /\b(?:also|including|in addition to)\b(?:\W+\w+){0,6}?\W*$|\bunder (?:certain|some|special) circumstances\b/;

const ADDITIVE_AFTER =
  /^[^,;]{0,60}?\b(?:may|can|are|is|will)\s+also\b|^\W*(?:\w+\W+){0,3}?(?:also|as well)\b|\bcase by case\b|^[^;]{0,80}?\b(?:provided|as long as|so long as|only if|may (?:also )?be considered)\b/;

const REDIRECTED_AFTER =
  /^\W*(?:\w+\W+){0,4}?(?:are|is)?\s*(?:encouraged|should|may wish|might)\s+(?:to\s+)?(?:instead\s+)?(?:consider|apply (?:to|for)|look)\b/;

const ORGANIZATION_OF =
  /\b(?:association|society|council|club|network|office|committee)\s+(?:of|for)\s+(?:the\s+)?(?:yale\s+)?$/;

const NEGATION_BEFORE =
  /\b(?:not (?:open|available|eligible) to|excluding|except(?: for)?|other than|ineligible)\b(?:\W+\w+){0,4}?\W*$/;

const NEGATED_PREDICATE =
  /\b(?:(?:are|is)\s+(?:not\b|ineligible\b)|(?:may|can|could|will)\s+not\s+(?:apply|be (?:eligible|funded|considered))|cannot\s+apply|(?:are\s+|is\s+)?excluded\b|ineligible\b)/;

const IMMEDIATE_NEGATION = new RegExp(
  `^\\W*(?:(?!who\\b|that\\b|which\\b|whose\\b)\\w+\\W+){0,2}?${NEGATED_PREDICATE.source}`,
);

const NEGATED_LATER_IN_CLAUSE = new RegExp(`^[^,;()]{0,80}?${NEGATED_PREDICATE.source}`);

const QUALIFIER = /\b(?:after|unless|until|before|following|once|if|when|to be used)\b/;

const CONDITIONAL_OPENING = /^\W*(?:if|when|unless)\b/;

function normalizeProse(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\bPh\.?\s?D\.?(?=\W|$)/gi, 'PhD')
    .replace(/\bJ\.D\.(?=\W|$)/g, 'JD')
    .replace(/\bM\.D\.(?=\W|$)/g, 'MD')
    .replace(/(?<=\w)-(?=\w)/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\bstudents (?:of|in|at|from) yale college\b/g, 'yale college students');
}

function sentencesOf(text: string): string[] {
  return normalizeProse(text)
    .split(/(?<=[.!?;])\s+|¶/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function termFor(word: string): TermPattern | undefined {
  return TERM_PATTERNS.find(({ pattern }) => pattern.test(word));
}

type GroupRole = 'base' | 'additive' | 'excluded';

interface LevelGroup {
  terms: LevelTerm[];
  role: GroupRole;
  complete: boolean;
}

function expandYearRange(phrase: string, terms: LevelTerm[]): LevelTerm[] {
  const years = terms.flatMap((term) => (term.kind === 'year' ? term.values : []));
  if (!/\bthrough\b/.test(phrase) || years.length < 2) return terms;
  const indexes = years.map((value) => UNDERGRADUATE_YEARS.indexOf(value));
  const range = UNDERGRADUATE_YEARS.slice(Math.min(...indexes), Math.max(...indexes) + 1);
  return [...terms.filter((term) => term.kind !== 'year'), { kind: 'year', values: range }];
}

function negationOf(before: string, after: string): 'blanket' | 'qualified' | null {
  if (NEGATION_BEFORE.test(before)) return 'blanket';
  const immediate = after.match(IMMEDIATE_NEGATION);
  if (immediate) {
    return QUALIFIER.test(after.slice(immediate[0].length)) ? 'qualified' : 'blanket';
  }
  return NEGATED_LATER_IN_CLAUSE.test(after) ? 'qualified' : null;
}

function isExplicitlyCued(before: string, after: string): boolean {
  return (
    ELIGIBILITY_CUE.test(before) ||
    SUPPORT_CUE.test(before) ||
    SENTENCE_OPENING_FOR.test(before) ||
    ADMISSION_AFTER.test(after)
  );
}

function isAdmissionCued(before: string, after: string, isEligibilitySection: boolean): boolean {
  return (
    isEligibilitySection ||
    PREFERENCE.test(before) ||
    PREFERENCE_AFTER.test(after) ||
    isExplicitlyCued(before, after)
  );
}

function namesStudents(phrase: string, before: string, lastTerm: TermPattern): boolean {
  if (ENDS_IN_PERSON_HEAD.test(phrase)) return true;
  if (ENDS_IN_PROGRAM_HEAD.test(phrase)) return ENROLLED_IN.test(before);
  return lastTerm.standsAlone;
}

function roleOf(before: string, after: string): GroupRole {
  return PREFERENCE.test(before) ||
    PREFERENCE_AFTER.test(after) ||
    ADDITIVE_BEFORE.test(before) ||
    ADDITIVE_AFTER.test(after)
    ? 'additive'
    : 'base';
}

const YEAR_WORD = /\b(?:first years?|freshm[ae]n|sophomores?|juniors?|seniors?)\b/g;

function yearWordCount(text: string): number {
  return Array.from(text.matchAll(YEAR_WORD)).length;
}

function groupsIn(sentence: string, isEligibilitySection: boolean): LevelGroup[] {
  if (CONDITIONAL_OPENING.test(sentence)) return [];
  const groups: LevelGroup[] = [];
  const phrases: string[] = [];
  for (const match of sentence.matchAll(GROUP)) {
    const phrase = match[0];
    const start = match.index ?? 0;
    const before = sentence.slice(0, start);
    const after = sentence.slice(start + phrase.length);
    const words = Array.from(phrase.matchAll(TERM)).map((term) => term[0]);
    const patterns = words.map(termFor).filter((term): term is TermPattern => Boolean(term));
    if (patterns.length === 0) continue;
    if (!namesStudents(phrase, before, patterns[patterns.length - 1])) continue;
    if (ORGANIZATION_OF.test(before) || REDIRECTED_AFTER.test(after)) continue;
    const negation = negationOf(before, after);
    if (negation === 'qualified') continue;
    if (!negation && !isAdmissionCued(before, after, isEligibilitySection)) continue;
    phrases.push(phrase);
    groups.push({
      terms: expandYearRange(
        phrase,
        patterns.map(({ term }) => term),
      ),
      role: negation === 'blanket' ? 'excluded' : roleOf(before, after),
      complete:
        negation === 'blanket' ||
        (QUANTIFIED_COMPLETE.test(before) && isExplicitlyCued(before, after)),
    });
  }
  const namesUnreadYears =
    yearWordCount(sentence) > phrases.reduce((count, phrase) => count + yearWordCount(phrase), 0);
  return namesUnreadYears
    ? groups.map((group) => ({ ...group, complete: group.role === 'excluded' }))
    : groups;
}

function inVocabularyOrder(values: Iterable<string>): YearOfStudy[] {
  const present = new Set(values);
  return YEAR_OF_STUDY_VOCABULARY.filter((value) => present.has(value));
}

class LevelEvidence {
  readonly terms: LevelTerm[] = [];
  private readonly completeLevels = new Set<GenericLevel>();

  add(group: LevelGroup): void {
    this.terms.push(...group.terms);
    if (!group.complete) return;
    for (const term of group.terms) {
      if (term.kind === 'generic') this.completeLevels.add(term.level);
    }
  }

  get isEmpty(): boolean {
    return this.terms.length === 0;
  }

  values(filter: Set<string>): YearOfStudy[] {
    const years = this.terms.flatMap((term) => (term.kind === 'year' ? term.values : []));
    const degrees = this.terms.flatMap((term) => (term.kind === 'degree' ? term.values : []));
    const levels = new Set(
      this.terms.flatMap((term) => (term.kind === 'generic' ? [term.level] : [])),
    );
    const level = (name: GenericLevel): YearOfStudy[] =>
      levels.has(name) ? this.refined(name, filter) : [];

    const undergraduate = years.length > 0 ? years : level('undergraduate');
    const specificGraduate = [...degrees, ...level('doctoral')];
    const graduate = [
      ...(specificGraduate.length > 0 ? specificGraduate : level('graduate')),
      ...level('professional'),
    ];
    const alumni: YearOfStudy[] = this.terms.some((term) => term.kind === 'alumni')
      ? ['Alumni']
      : [];
    return [...undergraduate, ...graduate, ...alumni];
  }

  hasUnmapped(): boolean {
    return this.terms.some((term) => term.kind === 'unmapped');
  }

  private refined(level: GenericLevel, filter: Set<string>): YearOfStudy[] {
    const values = GENERIC_LEVEL_VALUES[level];
    if (this.completeLevels.has(level)) return values;
    const refined = GENERIC_LEVEL_REFINABLE_VALUES[level].filter((value) => filter.has(value));
    return refined.length > 0 ? refined : values;
  }
}

/**
 * Specific years named anywhere on the page outrank a generic level, so "awarded to a
 * Yale undergraduate" beside "first-years and sophomores" admits the two years named. A
 * generic level ("undergraduate students") is refined by the filter's values inside that
 * level, because the two then agree; it admits the whole level when quantified ("any
 * undergraduate") or when the filter lists nothing inside it. A preference, an inclusion,
 * or an exception ("seniors may also be considered") adds to the admitted years rather
 * than replacing them, and the filter is the base when the prose states nothing else.
 */
export function resolveFundYearOfStudy(
  prose: FundEligibilityProse[],
  filter: string[],
): FundYearOfStudyResolution {
  const evidence: Record<GroupRole, LevelEvidence> = {
    base: new LevelEvidence(),
    additive: new LevelEvidence(),
    excluded: new LevelEvidence(),
  };
  let anyLevel = false;

  for (const { text, isEligibilitySection } of prose) {
    for (const sentence of sentencesOf(text)) {
      if (!CONDITIONAL_OPENING.test(sentence) && ANY_LEVEL.test(sentence)) anyLevel = true;
      for (const group of groupsIn(sentence, isEligibilitySection)) evidence[group.role].add(group);
    }
  }

  if (Object.values(evidence).some((roleEvidence) => roleEvidence.hasUnmapped())) {
    return { kind: 'unreconcilable' };
  }

  const filterValues = new Set(filter);
  const excluded = new Set<string>(evidence.excluded.values(filterValues));
  const proseIsSilent = !anyLevel && evidence.base.isEmpty && evidence.additive.isEmpty;
  if (proseIsSilent) {
    return { kind: 'filter', values: filter.filter((value) => !excluded.has(value)) };
  }

  const base = anyLevel
    ? YEAR_OF_STUDY_VOCABULARY.filter((value) => value !== 'Alumni')
    : evidence.base.isEmpty
      ? filter
      : evidence.base.values(filterValues);
  const admitted = [...base, ...evidence.additive.values(filterValues)];
  const values = inVocabularyOrder(admitted.filter((value) => !excluded.has(value)));
  return values.length > 0 ? { kind: 'prose', values } : { kind: 'unreconcilable' };
}
