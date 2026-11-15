export const MIN_SENTENCE_QUERY_WORDS = 4;

const REQUEST_OPENING =
  /^(?:(?:i\s+(?:want|would\s+like|hope|plan)\s+to|i'd\s+like\s+to|i\s+wanna|wanna|i\s+am\s+interested\s+in|i'm\s+interested\s+in|interested\s+in|looking\s+for|search(?:ing)?\s+for)\b\s*)+/;

const INTENT_TO = /^(?:want|try|trying|hope|like)\s+to\s+/;

const UNAMBIGUOUS_GOAL_VERB =
  '(?:clean\\s+up|build|make|create|develop|invent|investigate|explore|understand|learn|figure\\s+out|find(?:\\s+out)?|stop|reduce|prevent|fix|solve|improve|predict|grow|get|write|translate|transcribe|look\\s+(?:for|at|into)|work\\s+(?:in|on|with)|protect|save|cure|teach|analy[sz]e|discover)';

const NOUN_LIKE_GOAL_VERB =
  '(?:design|model|test|map|stage|track|use|read|help|research|measure|document|study|treat|engineer|end)';

const GOAL_OBJECT_LEAD =
  '(?:a|an|the|my|our|new|better|how|why|what|which|whether|where|when|ways?|people|kids|children|students|things|some|more)';

const WORD_END = "(?![\\p{L}\\p{N}'-])";

const ONE_GOAL_VERB_OPENING = new RegExp(
  `^(?:${UNAMBIGUOUS_GOAL_VERB}|${NOUN_LIKE_GOAL_VERB})${WORD_END}\\s*`,
  'u',
);

const FIXED_TOPIC_PHRASE_OPENING = new RegExp(
  `^(?:stop[\\s-]+motion(?!\\s+sickness${WORD_END})|make[\\s-]*up|get\\s+out\\s+the\\s+vote)${WORD_END}`,
  'u',
);

const opensWithFixedTopicPhrase = (text: string): boolean => FIXED_TOPIC_PHRASE_OPENING.test(text);

const withoutOpeningGoalVerbs = (text: string): string => {
  let remaining = text;
  while (!opensWithFixedTopicPhrase(remaining) && ONE_GOAL_VERB_OPENING.test(remaining)) {
    remaining = remaining.replace(ONE_GOAL_VERB_OPENING, '');
  }
  return remaining.trim();
};

const OPENS_WITH_A_GOAL_VERB = new RegExp(
  `^(?:${UNAMBIGUOUS_GOAL_VERB}${WORD_END}|${NOUN_LIKE_GOAL_VERB}\\s+${GOAL_OBJECT_LEAD}${WORD_END})`,
  'u',
);

const OPENS_WITH_ANY_GOAL_VERB = new RegExp(
  `^(?:${UNAMBIGUOUS_GOAL_VERB}|${NOUN_LIKE_GOAL_VERB})${WORD_END}`,
  'u',
);

const AUDIENCE_OR_LOGISTICS_PHRASE =
  /(?<![\p{L}\p{N}'-])(?:for\s+(?:a\s+)?(?:freshm[ae]n|first[- ]years?|undergrads?|undergraduates?|beginners)|(?:as\s+an?\s+)?(?:freshm[ae]n|undergrads?|undergraduates?)|with\s+no\s+experience|no\s+experience|research|labs?|at\s+yale|in\s+a\s+lab)(?![\p{L}\p{N}'-])/gu;

const FUNCTION_WORDS = new Set(
  'a an the that which who whom whose can could do does did is are was were be been being would should may might must to of for in on at by with from into about and or but so than then them they their there it its this these those some any something things stuff me my i we our you your people really just also very more better kind sort lot lots way ways'.split(
    ' ',
  ),
);

const GENERIC_VERBS = new Set(
  'study studies studying studied help helps helping get gets getting make makes making take takes need needs let lets happen happens like keep keeps going clean up find finds do does look looks'.split(
    ' ',
  ),
);

const normalizedQueryWords = (query: string): string[] =>
  query
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

export interface SentenceQueryTopic {
  topicQuery: string;
}

export function extractResearchTopicFromSentenceQuery(query: string): SentenceQueryTopic | null {
  const words = normalizedQueryWords(query);
  if (words.length < MIN_SENTENCE_QUERY_WORDS) return null;
  const typed = words.join(' ');
  const afterRequest = typed.replace(REQUEST_OPENING, '').trim();
  const statesIntent = afterRequest !== typed || INTENT_TO.test(afterRequest);
  let text = afterRequest.replace(INTENT_TO, '');
  const opensWithGoal = statesIntent
    ? OPENS_WITH_ANY_GOAL_VERB.test(text)
    : OPENS_WITH_A_GOAL_VERB.test(text);
  if (!opensWithGoal || opensWithFixedTopicPhrase(text)) return null;
  text = withoutOpeningGoalVerbs(text);
  const fixedPhrase = text.match(FIXED_TOPIC_PHRASE_OPENING)?.[0] ?? '';
  const topicWords = [
    ...(fixedPhrase ? [fixedPhrase] : []),
    ...text
      .slice(fixedPhrase.length)
      .replace(AUDIENCE_OR_LOGISTICS_PHRASE, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((word) => !FUNCTION_WORDS.has(word) && !GENERIC_VERBS.has(word)),
  ];
  if (topicWords.length === 0) return null;
  const topicQuery = topicWords.join(' ');
  if (topicQuery === words.join(' ')) return null;
  return { topicQuery };
}
