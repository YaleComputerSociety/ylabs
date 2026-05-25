export type LongTextOptions = {
  minAutoSplitCharacters?: number;
  sentencesPerParagraph?: number;
};

const DEFAULT_MIN_AUTO_SPLIT_CHARACTERS = 420;
const DEFAULT_SENTENCES_PER_PARAGRAPH = 3;
const ABBREVIATION_DOT = '__LONGTEXT_DOT__';

const normalizeInlineWhitespace = (value: string): string =>
  value.replace(/[ \t\f\v]+/g, ' ').trim();

const normalizeCommonAcademicAbbreviations = (value: string): string =>
  value
    .replace(/\bPh\.\s+D\./gi, 'Ph.D.')
    .replace(/(^|[^A-Za-z])M\.\s*Phil\.\s*/g, (_match, prefix) => `${prefix}M.Phil. `)
    .replace(/\bM\.\s+A\.?/gi, 'M.A.')
    .replace(/\bM\.\s+Sc\.?/gi, 'M.Sc.')
    .replace(/\bM\.\s+S\.?/gi, 'M.S.')
    .replace(/\bB\.\s+A\.?/gi, 'B.A.')
    .replace(/\bB\.\s+Sc\.?/gi, 'B.Sc.')
    .replace(/\bB\.\s+S\.?/gi, 'B.S.')
    .replace(/\bTh\.\s+D\.?/gi, 'Th.D.')
    .replace(/\bM\.Phil(?=,|\s)/g, 'M.Phil.')
    .replace(/\bM\.A(?=,|\s)/g, 'M.A.')
    .replace(/\bM\.S(?=,|\s)/g, 'M.S.')
    .replace(/\bM\.Sc(?=,|\s)/g, 'M.Sc.')
    .replace(/\bB\.A(?=,|\s)/g, 'B.A.')
    .replace(/\bB\.S(?=,|\s)/g, 'B.S.')
    .replace(/\bB\.Sc(?=,|\s)/g, 'B.Sc.')
    .replace(/\bSc\.\s+D\./gi, 'Sc.D.')
    .replace(
      /([a-z)])(?=(?:Ph\.D\.|M\.Phil\.|M\.A\.|M\.S\.|M\.Sc\.|B\.A\.|B\.S\.|B\.Sc\.|Th\.D\.))/g,
      '$1 ',
    )
    .replace(/\s+([,;:])/g, '$1');

const protectDots = (value: string): string => value.replace(/\./g, ABBREVIATION_DOT);

const protectUrlDots = (value: string): string => {
  const trailingSentencePunctuation = value.match(/[.!?]+$/)?.[0] || '';
  const url = trailingSentencePunctuation
    ? value.slice(0, -trailingSentencePunctuation.length)
    : value;
  return `${protectDots(url)}${trailingSentencePunctuation}`;
};

const protectSentenceAbbreviations = (value: string): string =>
  value
    .replace(/https?:\/\/[^\s]+/gi, protectUrlDots)
    .replace(/\be\s*\.\s*g\s*\./gi, (match) =>
      match.replace(/[ \t\n]*/g, '').replace(/\./g, ABBREVIATION_DOT),
    )
    .replace(/\bi\s*\.\s*e\s*\./gi, (match) =>
      match.replace(/[ \t\n]*/g, '').replace(/\./g, ABBREVIATION_DOT),
    )
    .replace(/\bet\s+al\./gi, protectDots)
    .replace(/\b(?:M\.Phil|M\.Sc|B\.Sc|Th\.D)\./g, protectDots)
    .replace(/\b(?:Ph|M|B|Sc)\.\s*D\./g, protectDots)
    .replace(/\b(?:Dr|Prof|Mr|Ms|Mrs|St|vs|Fig|Eq|No|Inc|Ltd|Co|Dept|Univ)\./g, protectDots)
    .replace(/\b(?:[A-Z]\.){2,}(?=[,/\s)]|$)/g, protectDots)
    .replace(/\b(?:[A-Z]\.\s*){2,}(?=[A-Za-z])/g, protectDots)
    .replace(/\b[A-Z]\.(?=\s+[A-Za-z])/g, protectDots);

const restoreSentenceAbbreviations = (value: string): string =>
  value.split(ABBREVIATION_DOT).join('.');

const sentenceParts = (value: string): string[] => {
  const normalized = normalizeInlineWhitespace(value);
  const protectedValue = protectSentenceAbbreviations(normalized);
  const matches = protectedValue.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g);
  return (matches || [protectedValue])
    .map(restoreSentenceAbbreviations)
    .map(normalizeCommonAcademicAbbreviations)
    .map(normalizeInlineWhitespace)
    .filter(Boolean);
};

export function longTextParagraphs(
  text: string | null | undefined,
  options: LongTextOptions = {},
): string[] {
  const normalized = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return [];

  const displayText = normalizeCommonAcademicAbbreviations(normalized);

  if (/\n/.test(displayText)) {
    return displayText
      .split(/\n+/)
      .map(normalizeInlineWhitespace)
      .filter(Boolean);
  }

  const minAutoSplitCharacters =
    options.minAutoSplitCharacters ?? DEFAULT_MIN_AUTO_SPLIT_CHARACTERS;
  const sentencesPerParagraph =
    options.sentencesPerParagraph ?? DEFAULT_SENTENCES_PER_PARAGRAPH;

  if (displayText.length < minAutoSplitCharacters) {
    return [displayText];
  }

  const sentences = sentenceParts(displayText);
  if (sentences.length < sentencesPerParagraph + 2) {
    return [displayText];
  }

  const paragraphs: string[] = [];
  for (let index = 0; index < sentences.length; index += sentencesPerParagraph) {
    paragraphs.push(sentences.slice(index, index + sentencesPerParagraph).join(' '));
  }
  return paragraphs;
}
