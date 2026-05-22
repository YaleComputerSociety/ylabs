export type LongTextOptions = {
  minAutoSplitCharacters?: number;
  sentencesPerParagraph?: number;
};

const DEFAULT_MIN_AUTO_SPLIT_CHARACTERS = 420;
const DEFAULT_SENTENCES_PER_PARAGRAPH = 3;

const normalizeInlineWhitespace = (value: string): string =>
  value.replace(/[ \t\f\v]+/g, ' ').trim();

const sentenceParts = (value: string): string[] => {
  const matches = normalizeInlineWhitespace(value).match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g);
  return (matches || [value]).map(normalizeInlineWhitespace).filter(Boolean);
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

  if (/\n\n/.test(normalized)) {
    return normalized
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\n/g, ' '))
      .map(normalizeInlineWhitespace)
      .filter(Boolean);
  }

  const minAutoSplitCharacters =
    options.minAutoSplitCharacters ?? DEFAULT_MIN_AUTO_SPLIT_CHARACTERS;
  const sentencesPerParagraph =
    options.sentencesPerParagraph ?? DEFAULT_SENTENCES_PER_PARAGRAPH;

  if (normalized.length < minAutoSplitCharacters) {
    return [normalized];
  }

  const sentences = sentenceParts(normalized);
  if (sentences.length < sentencesPerParagraph + 2) {
    return [normalized];
  }

  const paragraphs: string[] = [];
  for (let index = 0; index < sentences.length; index += sentencesPerParagraph) {
    paragraphs.push(sentences.slice(index, index + sentencesPerParagraph).join(' '));
  }
  return paragraphs;
}
