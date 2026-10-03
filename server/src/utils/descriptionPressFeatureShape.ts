export type PressFeatureDescriptionShape =
  | 'quoted-speech'
  | 'publication-list'
  | 'press-blurb'
  | 'news-announcement';

const SPEECH_VERB =
  '(?:says|said|explains|explained|adds|added|notes|noted|recalls|recalled|remarks|remarked|observes|observed|tells|told|continues|continued|admits|admitted|jokes|joked|laughs|laughed)';

const QUOTED_SPAN = /"[^"]{2,}"|“[^”]{2,}”/g;

const ATTRIBUTED_SPEECH = new RegExp(
  [
    String.raw`[,.!?…]\s*["”]\s*,?\s*(?:${SPEECH_VERB}\s+(?:Dr\.?\s+)?[A-Z]|(?:he|she|they)\s+${SPEECH_VERB}\b|(?:Dr\.?\s+)?[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,2}\s+${SPEECH_VERB}\b)`,
    String.raw`\b(?:he|she|they|Dr\.?\s+[A-Z][\p{L}'’.-]+)\s+${SPEECH_VERB}\s*[,:]\s*["“]`,
  ].join('|'),
  'u',
);

const MIN_QUOTED_SPEECH_SHARE = 0.3;

const MIN_QUOTED_SPAN_WORDS = 6;

const RESEARCH_STATEMENT_WORD =
  /\b(?:research(?:es)?|stud(?:y|ies)|investigat(?:es|ing|ions?)|examines|explores|scholarship)\b/;

const statesResearchOutsideQuotes = (text: string): boolean =>
  RESEARCH_STATEMENT_WORD.test(text.replace(QUOTED_SPAN, ' '));

const wordCount = (value: string): number => value.split(/\s+/).filter(Boolean).length;

export function quotedSpeechShare(text: string): number {
  if (!text) return 0;
  const quoted = (text.match(QUOTED_SPAN) ?? [])
    .filter((span) => wordCount(span) >= MIN_QUOTED_SPAN_WORDS)
    .reduce((sum, span) => sum + span.length, 0);
  return quoted / text.length;
}

export function isAttributedQuotedSpeechFeatureText(text: string): boolean {
  if (!ATTRIBUTED_SPEECH.test(text)) return false;
  return quotedSpeechShare(text) >= MIN_QUOTED_SPEECH_SHARE;
}

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';

const CITATION_VENUE_MARKER = new RegExp(
  String.raw`\(?(?:${MONTH}\s+)?(?:19|20)\d\d[a-z]?\)?|\bin press\b|\bforthcoming\b|\bVol\.|\bno\.\s*\d|\bpp?\.\s*\d|\b\d+\s*[-–]\s*\d+\b|\beds?\.|\bJournal\b|\bReview\b|\bPress\b|\bConference\b|\bProceedings\b`,
);

const CITATION_VENUE_WINDOW = 240;

const OPENING_QUOTED_TITLE = /^(?:(?:19|20)\d\d[a-z]?:?\s+)?["“][^"”]{8,240}["”]/;

const OPENING_AUTHOR_QUOTED_TITLE =
  /^[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,3}\.\s+["“][^"”]{8,240}["”]/u;

const OPENING_AUTHOR_INITIALS_LIST = /^(?:[A-Z][\p{L}'’-]+,\s+(?:[A-Z]\.\s*){1,3},\s+){2,}/u;

export function isOpeningCitationText(text: string): boolean {
  if (OPENING_AUTHOR_INITIALS_LIST.test(text)) return true;
  const title = text.match(OPENING_QUOTED_TITLE) ?? text.match(OPENING_AUTHOR_QUOTED_TITLE);
  if (!title) return false;
  const venue = text.slice(title[0].length, title[0].length + CITATION_VENUE_WINDOW);
  return CITATION_VENUE_MARKER.test(venue);
}

const BLURB_ATTRIBUTION = /["”]\s*[—–]\s*[A-Z][\p{L}'’.-]+\s+[A-Z][\p{L}'’.-]+/gu;

const MIN_BLURB_ATTRIBUTIONS = 2;

export function isPressBlurbText(text: string): boolean {
  return (text.match(BLURB_ATTRIBUTION) ?? []).length >= MIN_BLURB_ATTRIBUTIONS;
}

const NEWS_ANNOUNCEMENT_LEAD =
  /^(?:(?:many|warm|hearty|big)\s+)?congratulations\s+to\b|^[^.]{0,80}\b(?:is|are)\s+(?:pleased|delighted|proud|thrilled|excited)\s+to\s+announce\b/i;

export function isNewsAnnouncementText(text: string): boolean {
  return NEWS_ANNOUNCEMENT_LEAD.test(text);
}

export function pressFeatureDescriptionShape(value: unknown): PressFeatureDescriptionShape | null {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text || statesResearchOutsideQuotes(text)) return null;
  if (isOpeningCitationText(text)) return 'publication-list';
  if (isAttributedQuotedSpeechFeatureText(text)) return 'quoted-speech';
  if (isPressBlurbText(text)) return 'press-blurb';
  if (isNewsAnnouncementText(text)) return 'news-announcement';
  return null;
}
