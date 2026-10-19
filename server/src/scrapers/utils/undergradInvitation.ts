import { normalizeJoinRouteText, UNDERGRADUATE_AUDIENCE } from '../undergradJoinPageAdmission';
import {
  undergradInvitationLevels,
  type UndergradInvitationLevel,
} from '../../models/storedVocabularies';

export { undergradInvitationLevels, type UndergradInvitationLevel };

export interface UndergradInvitation {
  level: UndergradInvitationLevel;
  quote: string;
}

const MAX_SENTENCE_CHARS = 450;
const MAX_CLASSIFIED_CHARS = 650;
const MAX_HEADING_CHARS = 40;

const NOT_AN_AUDIENCE_MENTION =
  /\bundergrad\w*\s+(?:degree|studies|study|education|courses?|program(?:me)?s?|majors?|teaching|curricul\w*|prizes?|admissions?|advis(?:er|or)s?|dean)\b|\bdirector\s+of\s+undergrad\w*|\b(?:teach|teaches|teaching|taught|lectur\w*)\b[^.]{0,80}\bundergrad|\b(?:during|after|through)\s+(?:(?:my|his|her|their|your)\s+)?undergrad|\b(?:for|in|from)\s+(?:my|his|her|their|your)\s+undergrad|^\s*(?:my|his|her)\s+undergrad|\bundergrad\w*\s+teach|\bexperience\s+(?:comes\s+)?from\b[^.]{0,80}\bundergrad|\bas\s+an\s+undergrad\w*\b|\b(?:BA|BS|B\.A\.|B\.S\.)[-\s/]+(?:BS[-\s/]+)?MPH\b/i;

const CLOSED_OR_DECLINED =
  /\b(?:no\s+longer|not\s+(?:currently\s+)?(?:accepting|recruiting|hiring|taking|seeking|looking)|(?:have|has)\s+(?:all\s+)?been\s+filled|(?:are|is)\s+(?:now\s+)?(?:filled|closed)|no\s+(?:open\s+)?(?:positions|openings|spots)|(?:unable|not\s+able)\s+to\s+(?:take|accept|host|supervise)|cannot\s+(?:take|accept|host|supervise)|do\s+not\s+(?:take|accept|host))\b/i;

const PAST_OR_DESCRIPTIVE =
  /\b(?:former|formerly|previously|alumni|alumnus|alumna|have\s+hosted|has\s+hosted|have\s+mentored|has\s+mentored|joined\s+the\s+lab)\b/i;

const NEWS_ITEM =
  /\bwelcom(?:e|es|ed)\s+(?:(?:a|our|the|new|back|incoming)\s+){0,3}(?:class|cohort|members?|scholars|fellows)\b|\bwelcome\s+(?:to\s+)?(?:the\s+)?20\d\d\b|^\s*\d{1,2}\/\d{1,2}\/\d{2,4}\b/i;

const PERSON_NAME =
  String.raw`(?!(?:Undergrad\w*|Graduates?|Students?|Postdoc\w*|Yale|Applicants?|Researchers?|All|Anyone|Everyone)\b)[A-Z][a-z]+`;
const WELCOMES_A_NAMED_PERSON = new RegExp(
  String.raw`\b[Ww]elcome\s+(?:to\s+)?(?:[a-z]+\s+){0,2}${PERSON_NAME}(?:\s+${PERSON_NAME})?\s*(?:[!,(]|\s+to\s+(?:the|our)\b|$)`,
);

const COURSE_ADVISING = /\b(?:in|about)\s+(?:their|his|her|my|our)\s+courses\b/i;

const ROSTER_ENTRY =
  /\b(?:first|second|third|fourth|senior|junior)[-\s]year\s+undergrad|\bclass\s+of\s+20\d\d\b|\b(?:is|was)\s+an?\s+(?:\w+\s+){0,2}undergrad\w*|\bbachelor\w*\s+(?:and|or|&)\s+master|,\s*undergrad\w*\s+at\s+(?:yale|the\s+university)\b/i;

const NOT_THIS_LAB =
  /\bsome\s+(?:of\s+)?(?:the\s+)?(?:\w+\s+)?(?:groups|labs|laboratories|faculty|investigators)\b/i;

const AWARD_NOT_A_POSITION = /\b(?:awards?|prizes?|scholarships?|stipends?\s+of|grants?\s+of)\b/i;
const LAB_MEMBERSHIP = /\b(?:lab|laboratory|group|team|join|research\s+assistant)\b/i;

const ACTIVE_CUES = [
  /\b(?:currently|now|actively)\s+(?:hiring|recruiting|seeking|looking\s+for|accepting)\b/i,
  /\b(?:we|i|lab|laboratory|group|team)\s*(?:'re|'m|are|is|am)\s+(?:recruiting|hiring|seeking)\b/i,
  /\b(?:we|i|lab|laboratory|group|team)\s*(?:'re|'m|are|is|am)\s+looking\s+for\b/i,
  /\b(?:we|i)\s+(?:have|currently\s+have)\s+(?:\w+\s+){0,3}(?:openings?|open\s+positions?|vacanc(?:y|ies))\b/i,
  /\bpositions?\s+(?:are|is|will\s+be)\s+(?:also\s+|now\s+|currently\s+)?(?:available|open)\b/i,
  /\b(?:^|\s)opening\s*:/i,
];

const STANDING_QUALIFIER =
  /\b(?:always|often|constantly|continually|regularly|occasionally|generally|typically)\b/i;
const CONDITIONAL_AVAILABILITY = /\b(?:if|whether)\s+(?:there\s+(?:are|is)|any)\b/i;
const INDEPENDENT_CLAUSE_BREAK =
  /;|,?\s+(?:but|while|whereas)\s+|,\s+and\s+(?=(?:\w+\s+){0,2}(?:are|is|can|may|should|will)\b)/i;

const WELCOME_CUES = [
  /\bwelcom(?:e|es|ed|ing)\b/i,
  /\binvit(?:e|es|ed|ing)\b/i,
  /\bencourag(?:e|es|ed)\b[^.]{0,80}\bto\s+(?:\w+\s+)?(?:contact|reach|apply|e-?mail|write|inquire|join|participate|get\s+in\s+touch)\b/i,
  /\b(?:always|often|constantly|continually)\s+(?:\w+\s+)?(?:looking|interested|seeking|recruiting)\b/i,
  /\binterested\b[^.]{0,200}\b(?:contact|e-?mail|reach\s+out|write\s+to|apply|fill\s+out|get\s+in\s+touch|send)\b/i,
  /\b(?:please|feel\s+free\s+to)\s+(?:\w+\s+)?(?:contact|e-?mail|reach\s+out|get\s+in\s+touch|send|fill\s+out|apply|write)\b/i,
  /(?:^|:\s*)(?:[Ee]-?mail|[Cc]ontact|[Ww]rite\s+to|[Rr]each\s+out\s+to)\s+(?:the\s+|us\b|me\b|our\s+|professor\b|prof\.?\s|dr\.?\s|[A-Z][a-z]+\s)[^.]{0,120}\b(?:with|about|to|if|regarding)\b/,
  /\b(?:can|may|should)\s+(?:join|contact|e-?mail|apply|reach\s+out)\b/i,
  /\bjoin\s+(?:us|our\s+(?:lab|team|group|laboratory))\b/i,
  /\b(?:opportunities)\s+(?:are\s+available|exist)\b/i,
  /\bthere\s+are\s+(?:\w+\s+){0,2}opportunities\b/i,
  /\b(?:we|i)\s+(?:also\s+)?(?:provide|offer)\s+(?:\w+\s+){0,2}opportunities\b/i,
  /\boffers?\s+(?:an?\s+)?(?:\w+\s+){0,2}opportunit(?:y|ies)\s+for\b/i,
  /\b(?:application|applying)\s+instructions\b/i,
  /\b(?:we|i)\s+recruit\b/i,
  /\b(?:accept|accepts|accepting)\s+(?:applications|undergrad\w*)\b/i,
  /\bfill\s+out\s+(?:this|our|the)\b/i,
];

const STATED_TERM =
  /\b(?:(?<season>spring|summer|fall|autumn|winter)\s+(?:semester\s+|term\s+|of\s+)?(?<seasonYear>20\d\d)|(?<month>january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:\d{1,2},?\s+)?(?<monthYear>20\d\d)|(?<startYear>20\d\d)\s*[-/]\s*(?:20)?(?<endYearSuffix>\d\d)\s+(?:academic\s+)?(?:year|school\s+year))\b/gi;

const SEASON_END_MONTH: Record<string, number> = {
  spring: 5,
  summer: 8,
  fall: 12,
  autumn: 12,
  winter: 2,
};

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function termEnd(groups: Record<string, string | undefined>): Date {
  if (groups.season && groups.seasonYear) {
    return new Date(
      Date.UTC(Number(groups.seasonYear), SEASON_END_MONTH[groups.season.toLowerCase()], 0),
    );
  }
  if (groups.month && groups.monthYear) {
    return new Date(
      Date.UTC(Number(groups.monthYear), MONTHS.indexOf(groups.month.toLowerCase()) + 1, 0),
    );
  }
  const endYear = Number(String(groups.startYear).slice(0, 2) + groups.endYearSuffix);
  return new Date(Date.UTC(endYear, 5, 30));
}

export function statedTermIsPast(sentence: string, now: Date): boolean {
  const terms = Array.from(sentence.matchAll(STATED_TERM));
  return (
    terms.length > 0 && !terms.some((term) => termEnd(term.groups ?? {}).getTime() >= now.getTime())
  );
}

interface InvitationCandidate {
  sentence: string;
  precedingText: string;
}

const PRECEDING_CONTEXT_CHARS = 80;
const WINDOW_LOOKBACK_CHARS = 200;
const WINDOW_LOOKAHEAD_CHARS = 420;
const CLAUSE_START =
  /(?:^|\s)(?=(?:If|We|We're|Our|I|I'm|The|Prospective|Interested|Please|Undergrad\w*|Yale\s+undergrad\w*|Students|Positions?|Opening)\b)/g;
const SENTENCE_BOUNDARY = /(?<=[.!?]["')\]]?)\s+/;
const AUDIENCE_GLOBAL = new RegExp(UNDERGRADUATE_AUDIENCE.source, 'gi');
const EMAIL_OR_URL = /\S+@\S+|\bhttps?:\/\/\S+|\bwww\.\S+/gi;

const CLAUSE_ANCHOR_SPAN = 12;

function clauseStarts(text: string, matchIndex: number, wholeSentenceFallback: boolean): number[] {
  const lookbackStart = Math.max(0, matchIndex - WINDOW_LOOKBACK_CHARS);
  const lookback = text.slice(lookbackStart, matchIndex + CLAUSE_ANCHOR_SPAN);
  const starts = Array.from(
    lookback.matchAll(CLAUSE_START),
    (m) => lookbackStart + (m.index ?? 0) + m[0].length,
  ).filter((position) => position <= matchIndex);
  if (wholeSentenceFallback) starts.unshift(0);
  return starts.length > 0 ? starts : [matchIndex];
}

function clauseEnd(text: string, matchIndex: number): number {
  const after = text.slice(matchIndex, matchIndex + WINDOW_LOOKAHEAD_CHARS);
  const stop = /[.!?](?=\s|$)/.exec(after);
  return matchIndex + (stop ? stop.index + 1 : after.length);
}

function blockSentences(rawText: string): Array<{ sentence: string; heading: string }> {
  const out: Array<{ sentence: string; heading: string }> = [];
  let previousBlock = '';
  for (const block of rawText.split(/\n+/)) {
    const normalized = normalizeJoinRouteText(block);
    if (!normalized) continue;
    const heading = previousBlock.length <= PRECEDING_CONTEXT_CHARS ? previousBlock : '';
    normalized.split(SENTENCE_BOUNDARY).forEach((sentence, index) => {
      out.push({ sentence, heading: index === 0 ? heading : '' });
    });
    previousBlock = normalized;
  }
  return out;
}

function candidates(rawText: string): InvitationCandidate[] {
  const found: InvitationCandidate[] = [];
  for (const { sentence, heading } of blockSentences(rawText)) {
    const audienceMatches = Array.from(sentence.matchAll(AUDIENCE_GLOBAL));
    if (audienceMatches.length === 0) {
      if (sentence.length <= MAX_SENTENCE_CHARS) found.push({ sentence, precedingText: heading });
      continue;
    }
    const short = sentence.length <= MAX_SENTENCE_CHARS;
    const seen = new Set<string>();
    for (const match of audienceMatches) {
      const matchIndex = match.index ?? 0;
      const end = short ? sentence.length : clauseEnd(sentence, matchIndex);
      for (const start of clauseStarts(sentence, matchIndex, short)) {
        const clause = sentence.slice(start, end).trim();
        if (seen.has(clause)) continue;
        seen.add(clause);
        const withinSentence = sentence.slice(Math.max(0, start - PRECEDING_CONTEXT_CHARS), start);
        found.push({
          sentence: clause,
          precedingText: start === 0 ? `${heading} ${withinSentence}`.trim() : withinSentence,
        });
      }
    }
  }
  return found;
}

const spacedAfterColons = (text: string) => text.replace(/([a-z]):(?=[A-Z])/g, '$1: ');

function namesUndergraduateAudience(sentence: string): boolean {
  const withoutAddresses = sentence.replace(EMAIL_OR_URL, ' ');
  if (!UNDERGRADUATE_AUDIENCE.test(withoutAddresses)) return false;
  return UNDERGRADUATE_AUDIENCE.test(
    withoutAddresses.replace(new RegExp(NOT_AN_AUDIENCE_MENTION, 'gi'), ' '),
  );
}

function activeOpeningIsForUndergraduates(sentence: string): boolean {
  const sentenceNamesAudience = namesUndergraduateAudience(sentence);
  return sentence
    .split(INDEPENDENT_CLAUSE_BREAK)
    .some(
      (clause) =>
        ACTIVE_CUES.some((cue) => cue.test(clause)) &&
        (!sentenceNamesAudience || namesUndergraduateAudience(clause)),
    );
}

export function classifyInvitationSentence(
  sentence: string,
  now: Date,
  precedingText = '',
): UndergradInvitationLevel | null {
  if (sentence.length > MAX_CLASSIFIED_CHARS) return null;
  if (CLOSED_OR_DECLINED.test(sentence) || PAST_OR_DESCRIPTIVE.test(sentence)) return null;
  if (NEWS_ITEM.test(sentence) || WELCOMES_A_NAMED_PERSON.test(sentence)) return null;
  if (COURSE_ADVISING.test(sentence)) return null;
  if (NOT_THIS_LAB.test(sentence) || ROSTER_ENTRY.test(sentence)) return null;
  if (AWARD_NOT_A_POSITION.test(sentence) && !LAB_MEMBERSHIP.test(sentence)) return null;
  if (statedTermIsPast(`${precedingText} ${sentence}`, now)) return null;
  const active =
    !STANDING_QUALIFIER.test(sentence) &&
    !CONDITIONAL_AVAILABILITY.test(sentence) &&
    activeOpeningIsForUndergraduates(sentence);
  if (active) return 'actively_hiring';
  return WELCOME_CUES.some((cue) => cue.test(sentence)) ? 'welcomes_undergrads' : null;
}

const LEVEL_RANK: Record<UndergradInvitationLevel, number> = {
  actively_hiring: 2,
  welcomes_undergrads: 1,
};

export function strongerInvitation(
  left: UndergradInvitation | null,
  right: UndergradInvitation | null,
): UndergradInvitation | null {
  if (!left) return right;
  if (!right) return left;
  if (LEVEL_RANK[right.level] !== LEVEL_RANK[left.level]) {
    return LEVEL_RANK[right.level] > LEVEL_RANK[left.level] ? right : left;
  }
  return right.quote.length < left.quote.length ? right : left;
}

export function extractUndergradInvitation(
  pageText: string | null | undefined,
  now: Date,
): UndergradInvitation | null {
  const found = candidates(pageText ?? '');
  let best: UndergradInvitation | null = null;
  for (const [index, { sentence, precedingText }] of found.entries()) {
    const heading = index > 0 ? found[index - 1].sentence : '';
    const headedByAudience =
      heading.length <= MAX_HEADING_CHARS && namesUndergraduateAudience(heading);
    const namesAudience = namesUndergraduateAudience(sentence);
    if (!namesAudience && !headedByAudience) continue;
    const level = classifyInvitationSentence(sentence, now, precedingText);
    if (!level) continue;
    best = strongerInvitation(best, {
      level,
      quote: spacedAfterColons(namesAudience ? sentence : `${heading} ${sentence}`),
    });
  }
  return best;
}
