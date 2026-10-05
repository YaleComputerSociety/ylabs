/**
 * The award amount a fund page states: its Award Amount header when it carries one, and its
 * prose when it does not (#4588).
 *
 * Prose is read as statements rather than numbers (a range, a ceiling, an approximation, an
 * average or a stated sum), keeping "typically", a per-unit qualifier and the audience of each
 * of two amounts where the page states them, so one number is never picked out of a range.
 * A figure that is not the award (an earnings threshold, a tax notice, tuition, a budget, a
 * past total, a component such as a relocation stipend, a cap on one use of the funds, or a
 * figure in a notice) is not a statement. A page whose statements disagree, whose award
 * sentence carries a figure no statement accounts for, or that states only an aggregate value
 * abstains rather than guess.
 */
import { partitionSentencesForFiltering } from '../../utils/descriptionHygiene';

const AWARD_AMOUNT_MAX_CHARS = 120;

const MAX_PLAUSIBLE_AWARD_DOLLARS = 100_000;

const FIGURE = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?`;

const DOLLARS = String.raw`\$\s?${FIGURE}`;

const RANGE_END = String.raw`\$?\s?${FIGURE}`;

const ANY_DOLLAR_FIGURE = new RegExp(DOLLARS, 'g');

const SCALED_FIGURE = new RegExp(String.raw`${DOLLARS}\s*(?:million|billion|m\b|k\b)`, 'i');

const UNIT_WORD = String.raw`(?:week|month|year|academic year|semester|term|day|summer)`;

const UNIT_LINK = String.raw`(?:\s*\/\s*|\s+per\s+|\s+a\s+|\s+each\s+)`;

const UNIT_AFTER_FIGURE = new RegExp(String.raw`^${UNIT_LINK}(${UNIT_WORD})\b`, 'i');

const AUDIENCE_AFTER_STATEMENT =
  /^(?:\s+each)?\s+for\s+((?:the\s+|an?\s+)?[a-z][\w'-]*(?:\s+(?!and\b|or\b|with\b|to\b|in\b)[a-z][\w'-]*){0,3})/i;

const AWARD_NOUN =
  /\b(?:awards?|awarded|grants?|fellowships?|stipends?|scholarships?|prizes?|funding|funds?|funded|support|amounts?)\b/i;

const AWARD_NOUN_SOURCE = String.raw`(?:awards?|grants?|fellowships?|stipends?|scholarships?|prizes?|funding)`;

const TYPICAL = /\b(?:typical(?:ly)?|usually|generally|normally|in most cases)\b/i;

const PAST_FIGURE =
  /\b(?:in (?:19|20)\d{2}|last year|previous(?:ly)?|prior (?:year|years|cycle)|to date|since (?:19|20)\d{2}|have been awarded|has awarded|have awarded|have ranged|has ranged|endowment|endowed|raised|donat\w+|gifts?)\b/i;

const AGGREGATE_VALUE = /\b(?:cumulative|in total|totall?ing|total value)\b/i;

const USE_OF_FUNDS = /\b(?:may|can|must|will|should) (?:only )?be used\b/i;

const SCOPED_ASIDE = /^\W*(?:notice|note|if|when|unless)\b/i;

const COMPONENT_OF_AWARD = String.raw`(?:relocation|travel|housing|meal|moving|dependent|childcare|health(?:-care)?|insurance|conference|additional|supplemental)\s+(?:stipends?|allowances?|support|funding|contributions?|payments?)(?:\s+of)?`;

const NOT_AWARD_BEFORE = new RegExp(
  String.raw`\b(?:${COMPONENT_OF_AWARD}|earn(?:s|ed|ing)?|income|salar(?:y|ies)|wages?|paid|pays?|tuition|fees?|costs?|budgets?(?: \w+){0,3}|expenses?|1099(?:-misc)?|tax(?:es|able)?|over|above|more than|greater than|less than|at least|minimum(?: of)?|exceeds?|exceeding|in excess of|valued at|worth|loans?)\s*(?:of\s+|is\s+|are\s+|for\s+)?(?:about\s+|approximately\s+)?$`,
  'i',
);

const NOT_AWARD_AFTER =
  /^\s*(?:or (?:less|more|fewer|under|above)|and (?:up|above|over)|in (?:tuition|fees|income))\b/i;

type StatementKind = 'range' | 'ceiling' | 'approximate' | 'average' | 'sum';

interface AmountStatement {
  kind: StatementKind;
  low: string;
  high?: string;
  start: number;
  end: number;
  figureEnd: number;
}

interface SentenceReading {
  statements: AmountStatement[];
  unit?: string;
  audiences?: string[];
  typical: boolean;
}

const STATEMENT_PATTERNS: Array<{ kind: StatementKind; pattern: RegExp }> = [
  {
    kind: 'range',
    pattern: new RegExp(
      String.raw`\bbetween\s+(${DOLLARS})\s+and\s+(${RANGE_END})|(${DOLLARS})\s*(?:-|–|—|\bto\b)\s*(${RANGE_END})`,
      'gid',
    ),
  },
  {
    kind: 'ceiling',
    pattern: new RegExp(
      String.raw`(?:\bup to|\b(?:will |shall |does |do |to )?(?:not|never|rarely) (?:to )?exceed(?:ing)?|\bno (?:more|greater) than|\bas much as|\bat most|\bcapped at|\ba (?:cap|limit|ceiling) of|\bmaximum(?: \w+){0,3} (?:is|of)|\bmaximum(?: of)?|\bmax(?:imum)? award(?: of)?)\s+(?:a\s+|an\s+)?(${DOLLARS})|(${DOLLARS})\s+(?:maximum|max|cap|ceiling)\b`,
      'gid',
    ),
  },
  {
    kind: 'average',
    pattern: new RegExp(
      String.raw`\baverage\s+${AWARD_NOUN_SOURCE}\s+(?:is|are|of|was)\s+(?:about\s+|approximately\s+)?(${DOLLARS})|\b${AWARD_NOUN_SOURCE}\s+averag(?:e|es|ing)\s+(${DOLLARS})`,
      'gid',
    ),
  },
  {
    kind: 'approximate',
    pattern: new RegExp(String.raw`\b(?:about|approximately|around|roughly)\s+(${DOLLARS})`, 'gid'),
  },
  {
    kind: 'sum',
    pattern: new RegExp(
      String.raw`\b${AWARD_NOUN_SOURCE}\s+(?:of|is|are|will be|totals?)\s+(?:a\s+|an\s+)?(${DOLLARS})|\b(?:in the amount of|funded at)\s+(${DOLLARS})|(${DOLLARS})(?:${UNIT_LINK}${UNIT_WORD})?\s+${AWARD_NOUN_SOURCE}\b|\breceives?\s+(?:a\s+|an\s+)?(?:${AWARD_NOUN_SOURCE}\s+of\s+)?(${DOLLARS})`,
      'gid',
    ),
  },
];

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

function dollarsValue(figure: string): number {
  return Number(figure.replace(/[$,\s]/g, ''));
}

function dollarsText(figure: string): string {
  const compact = figure.replace(/\s/g, '');
  return compact.startsWith('$') ? compact : `$${compact}`;
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function statementFrom(kind: StatementKind, match: RegExpExecArray): AmountStatement | null {
  const groups = match
    .slice(1)
    .map((value, offset) => ({ value, span: match.indices?.[offset + 1] }))
    .filter((group): group is { value: string; span: [number, number] } =>
      Boolean(group.value && group.span),
    );
  if (groups.length === 0) return null;
  const start = match.index;
  const end = match.index + match[0].length;
  const figureEnd = groups[groups.length - 1].span[1];
  const low = groups[0].value;
  if (kind !== 'range') return { kind, low, start, end, figureEnd };
  const high = groups[1]?.value;
  if (!high || dollarsValue(low) >= dollarsValue(high)) return null;
  return { kind, low, high, start, end, figureEnd };
}

function isAwardFigureInContext(sentence: string, span: { start: number; end: number }): boolean {
  return (
    !NOT_AWARD_BEFORE.test(sentence.slice(Math.max(0, span.start - 40), span.start)) &&
    !NOT_AWARD_AFTER.test(sentence.slice(span.end))
  );
}

function statementsIn(sentence: string): AmountStatement[] {
  const found: AmountStatement[] = [];
  for (const { kind, pattern } of STATEMENT_PATTERNS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(sentence); match; match = pattern.exec(sentence)) {
      const statement = statementFrom(kind, match);
      if (statement && !found.some((existing) => overlaps(existing, statement))) {
        found.push(statement);
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

function unitAfter(sentence: string, statement: AmountStatement): string | undefined {
  return sentence.slice(statement.figureEnd).match(UNIT_AFTER_FIGURE)?.[1]?.toLowerCase();
}

function audienceAfter(sentence: string, statement: AmountStatement): string | undefined {
  return sentence.slice(statement.end).match(AUDIENCE_AFTER_STATEMENT)?.[1];
}

type SentenceVerdict =
  | { kind: 'silent' }
  | { kind: 'ambiguous' }
  | { kind: 'uncomposable' }
  | { kind: 'states'; reading: SentenceReading };

function composedReading(sentence: string, statements: AmountStatement[]): SentenceReading | null {
  const typical = TYPICAL.test(sentence);
  const last = statements[statements.length - 1];
  const unit = unitAfter(sentence, last);
  if (statements.length === 1) return { statements, unit, typical };
  const audiences = statements.map((statement) => audienceAfter(sentence, statement));
  if (audiences.every((audience): audience is string => Boolean(audience))) {
    return { statements, audiences, typical };
  }
  if (statements.length !== 2) return null;
  const [first, second] = statements;
  if (first.kind === 'ceiling' || second.kind !== 'ceiling') return null;
  return dollarsValue(second.low) > dollarsValue(first.high ?? first.low)
    ? { statements, unit, typical }
    : null;
}

function readSentence(sentence: string): SentenceVerdict {
  const figures = [...sentence.matchAll(ANY_DOLLAR_FIGURE)];
  if (figures.length === 0 || !AWARD_NOUN.test(sentence)) return { kind: 'silent' };
  const notTheAward = [PAST_FIGURE, USE_OF_FUNDS, SCOPED_ASIDE, SCALED_FIGURE];
  if (notTheAward.some((pattern) => pattern.test(sentence))) return { kind: 'silent' };
  if (AGGREGATE_VALUE.test(sentence)) return { kind: 'ambiguous' };
  if (figures.some((figure) => dollarsValue(figure[0]) > MAX_PLAUSIBLE_AWARD_DOLLARS)) {
    return { kind: 'silent' };
  }

  const all = statementsIn(sentence);
  const statements = all.filter((statement) => isAwardFigureInContext(sentence, statement));
  const accountedFor = (index: number) =>
    all.some((statement) => index >= statement.start && index < statement.end);
  const looseAwardFigures = figures.filter((figure) => {
    const start = figure.index ?? 0;
    return (
      !accountedFor(start) &&
      isAwardFigureInContext(sentence, { start, end: start + figure[0].length })
    );
  });

  if (looseAwardFigures.length > 0) return { kind: 'ambiguous' };
  if (statements.length === 0) return { kind: 'silent' };
  const reading = composedReading(sentence, statements);
  return reading ? { kind: 'states', reading } : { kind: 'uncomposable' };
}

function phraseFor(statement: AmountStatement): string {
  if (statement.kind === 'range') {
    return `${dollarsText(statement.low)} to ${dollarsText(statement.high || '')}`;
  }
  if (statement.kind === 'ceiling') return `up to ${dollarsText(statement.low)}`;
  if (statement.kind === 'approximate') return `about ${dollarsText(statement.low)}`;
  if (statement.kind === 'average') return `${dollarsText(statement.low)} on average`;
  return dollarsText(statement.low);
}

function readingKey(reading: SentenceReading): string {
  return JSON.stringify([
    reading.statements.map((statement) => [
      statement.kind,
      dollarsValue(statement.low),
      statement.high ? dollarsValue(statement.high) : null,
    ]),
    reading.unit || null,
    reading.audiences?.map((audience) => audience.toLowerCase()) || null,
  ]);
}

function displayFor(reading: SentenceReading): string {
  const phrases = reading.statements.map((statement, index) => {
    const audience = reading.audiences?.[index];
    return audience ? `${phraseFor(statement)} for ${audience}` : phraseFor(statement);
  });
  const phrase = phrases.join(reading.audiences ? '; ' : ', ');
  const qualified = reading.typical ? `typically ${phrase}` : phrase;
  const withUnit = reading.unit ? `${qualified} per ${reading.unit}` : qualified;
  return withUnit.charAt(0).toUpperCase() + withUnit.slice(1);
}

export type ProseAwardAmount =
  | { kind: 'stated'; value: string; high: number; bounded: boolean }
  | { kind: 'abstained'; reason: 'conflicting' | 'unaccounted' | 'uncomposable' }
  | { kind: 'silent' };

export function proseAwardAmount(sections: ReadonlyArray<string | undefined>): ProseAwardAmount {
  const stated = new Map<string, { value: string; high: number; bounded: boolean }>();
  for (const section of sections) {
    if (!section) continue;
    for (const raw of partitionSentencesForFiltering(section)) {
      const verdict = readSentence(normalizeWhitespace(raw));
      if (verdict.kind === 'silent') continue;
      if (verdict.kind === 'ambiguous') return { kind: 'abstained', reason: 'unaccounted' };
      if (verdict.kind === 'uncomposable') return { kind: 'abstained', reason: 'uncomposable' };
      const key = readingKey(verdict.reading);
      if (stated.has(key)) continue;
      const top = verdict.reading.statements[verdict.reading.statements.length - 1];
      stated.set(key, {
        value: displayFor(verdict.reading),
        high: dollarsValue(top.high ?? top.low),
        bounded: !verdict.reading.audiences && (top.kind === 'range' || top.kind === 'ceiling'),
      });
    }
  }
  if (stated.size === 0) return { kind: 'silent' };
  if (stated.size > 1) return { kind: 'abstained', reason: 'conflicting' };
  const [{ value, high, bounded }] = [...stated.values()];
  return { kind: 'stated', value: value.slice(0, AWARD_AMOUNT_MAX_CHARS), high, bounded };
}

const BARE_HEADER_FIGURE = new RegExp(String.raw`^\$?\s?${FIGURE}$`);

/**
 * A header that is one bare figure while the prose states a range or ceiling ending at that
 * figure is the top of the range rather than the award, so the prose statement is served.
 */
export function fundAwardAmount(
  header: string | undefined,
  proseSections: ReadonlyArray<string | undefined>,
): string | undefined {
  const headerText = header ? normalizeWhitespace(header) : '';
  const prose = proseAwardAmount(proseSections);
  if (!headerText) return prose.kind === 'stated' ? prose.value : undefined;
  if (
    prose.kind === 'stated' &&
    prose.bounded &&
    BARE_HEADER_FIGURE.test(headerText) &&
    dollarsValue(headerText) === prose.high
  ) {
    return prose.value;
  }
  return headerText.slice(0, AWARD_AMOUNT_MAX_CHARS);
}
