export const MIN_SENTENCE_QUERY_WORDS = 4;

const REQUEST_OPENING =
  /^(?:(?:i\s+(?:want|would\s+like|'d\s+like|wanna|hope|plan)\s+to|i\s+am\s+interested\s+in|i'm\s+interested\s+in|interested\s+in|looking\s+for|search(?:ing)?\s+for)\b\s*)+/;

const GOAL_VERB_OPENING =
  /^(?:(?:(?:want|try|trying|hope|like)\s+to\s+)?(?:clean\s+up|build|make|design|create|develop|invent|engineer|study|research|investigate|explore|understand|learn|figure\s+out|find(?:\s+out)?|help|stop|end|reduce|prevent|fix|solve|improve|predict|measure|track|grow|get|use|write|read|document|translate|transcribe|look\s+(?:for|at|into)|work\s+(?:in|on|with)|protect|stage|save|cure|treat|teach|map|model|analy[sz]e|test|discover)\b\s*)+/;

const AUDIENCE_OR_LOGISTICS_PHRASE =
  /\b(?:for\s+(?:a\s+)?(?:freshm[ae]n|first[- ]years?|undergrads?|undergraduates?|beginners)|(?:as\s+an?\s+)?(?:freshm[ae]n|undergrads?|undergraduates?)|with\s+no\s+experience|no\s+experience|research|labs?|at\s+yale|in\s+a\s+lab)\b/g;

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
  let text = words.join(' ').replace(REQUEST_OPENING, '').trim();
  if (!GOAL_VERB_OPENING.test(text)) return null;
  text = text.replace(GOAL_VERB_OPENING, '').trim();
  text = text.replace(AUDIENCE_OR_LOGISTICS_PHRASE, ' ');
  const topicWords = text
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !FUNCTION_WORDS.has(word) && !GENERIC_VERBS.has(word));
  if (topicWords.length === 0) return null;
  const topicQuery = topicWords.join(' ');
  if (topicQuery === words.join(' ')) return null;
  return { topicQuery };
}
