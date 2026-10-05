import { sharesAnInflectionalStem } from './groundedCardSynthesis';
import { splitDescriptionSentences } from './careerBiographyDescription';

/**
 * A synthesized card or body may name a method only when its evidence names that method
 * as one the group uses (#4914). The defect this guards is a listed interest, a
 * publication topic or a unit's name appended as "using X and Y".
 *
 * Judged against the evidence the text was written from, never against the text itself,
 * and through `sharesAnInflectionalStem`, because the model re-inflects ("trial" for
 * "trials") and a raw equality test would refuse a faithful clause.
 */
const OUTPUT_METHOD_MARKER = /\b(?:using|via|through|by\s+means\s+of|employing|leveraging)\s+/gi;

const EVIDENCE_METHOD_MARKER =
  /\b(?:using|uses?|used|with|via|through|by\s+means\s+of|by|based\s+on|employ(?:s|ing|ed)?|utili[sz](?:e|es|ing|ed)|leverag(?:e|es|ing|ed)|harness(?:es|ing|ed)?|appl(?:y|ies|ying|ied)|combin(?:e|es|ing|ed)|integrat(?:e|es|ing|ed)|conduct(?:s|ing|ed)?|perform(?:s|ing|ed)?|measur(?:e|es|ing|ed)|compar(?:e|es|ing|ed)|analy[sz](?:e|es|ing|ed)|from\s+an?|draw(?:s|ing)?\s+on|develop(?:s|ing|ed)?|implement(?:s|ing|ed)?|rel(?:y|ies|ying|ied)\s+on|(?:methods?|techniques?|approach(?:es)?|tools?)\W+(?:include|includes|including|spanning|such\s+as)?)\s*/gi;

const GENERIC_METHOD_NOUNS = new Set([
  'method',
  'methods',
  'technique',
  'techniques',
  'approach',
  'approaches',
  'tool',
  'tools',
  'methodology',
  'methodologies',
  'strategy',
  'strategies',
  'model',
  'models',
  'system',
  'systems',
  'study',
  'studies',
  'analysis',
  'analyses',
  'research',
  'data',
  'assessment',
  'assessments',
  'measure',
  'measures',
  'measurement',
  'measurements',
  'work',
]);

const CLAUSE_STOPWORDS = new Set([
  'also',
  'such',
  'other',
  'their',
  'these',
  'those',
  'both',
  'each',
  'well',
  'novel',
  'advanced',
  'state',
  'from',
  'into',
  'that',
  'which',
  'with',
]);

const METHOD_CONTEXT_WINDOW_WORDS = 20;
/**
 * "with interests in X" and "with a focus on X" introduce what the group studies, which
 * is the interest list this check exists to keep out of a method clause.
 */
const NOT_A_METHOD_AFTER_MARKER =
  /^(?:an?\s+|particular\s+|special\s+|specific\s+|primary\s+|current\s+|research\s+)*(?:interests?|focus|emphasis|attention|expertise|experience|specialt(?:y|ies)|concentration)\b/i;
const MIN_KEPT_SENTENCE_WORDS = 3;

const words = (text: string): string[] =>
  text
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^-+|-+$/g, ''))
    .filter(Boolean);

const distinctive = (token: string): boolean =>
  token.length >= 4 && !CLAUSE_STOPWORDS.has(token) && !/^\d+$/.test(token);

function compoundForms(token: string): string[] {
  return [token, token.replace(/-/g, ''), ...token.split('-')];
}

function addWithCompoundParts(vocabulary: Set<string>, token: string): void {
  for (const part of compoundForms(token)) if (distinctive(part)) vocabulary.add(part);
}

/**
 * Every word the evidence places in a method-introducing context: the words after a
 * marker such as "using" or "with", up to the end of that clause, plus the words naming a
 * generic method noun ("computational methods"). A bare "include" or "including" is not
 * a marker, because "interests include X" is the interest list this check exists to stop
 * being restated as a method.
 */
export function evidenceMethodVocabulary(evidenceTexts: readonly string[]): string[] {
  const vocabulary = new Set<string>();
  for (const text of evidenceTexts) {
    for (const clause of splitDescriptionSentences(String(text ?? '')).flatMap((sentence) =>
      sentence.split(/[;:]+/),
    )) {
      EVIDENCE_METHOD_MARKER.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = EVIDENCE_METHOD_MARKER.exec(clause))) {
        const after = clause.slice(match.index + match[0].length);
        if (NOT_A_METHOD_AFTER_MARKER.test(after)) continue;
        const following = words(after).slice(0, METHOD_CONTEXT_WINDOW_WORDS);
        for (const token of following) addWithCompoundParts(vocabulary, token);
      }
      const clauseWords = words(clause);
      clauseWords.forEach((token, index) => {
        if (!GENERIC_METHOD_NOUNS.has(token)) return;
        for (const previous of clauseWords.slice(Math.max(0, index - 3), index)) {
          addWithCompoundParts(vocabulary, previous);
        }
      });
    }
  }
  return [...vocabulary];
}

/**
 * The words that name the method in one list item: the part before a preposition, since
 * "ethnographic study of audience practices" names ethnography, not audiences, with
 * generic nouns such as "methods" or "analysis" set aside.
 */
function itemMethodWords(item: string): string[] {
  const lead = item.split(/\s+(?:of|in|on|for|with|across|from|to|among|at)\s+/i)[0];
  return words(lead)
    .flatMap(compoundForms)
    .filter((token) => distinctive(token) && !GENERIC_METHOD_NOUNS.has(token));
}

const MIN_SHARED_PREFIX = 7;

/**
 * Support is the lenient direction, since a false match only keeps a clause, so a long
 * shared prefix also counts ("biochemical" and "biochemistry").
 */
function supports(head: string, word: string): boolean {
  if (sharesAnInflectionalStem(head, word)) return true;
  return (
    head.length >= MIN_SHARED_PREFIX &&
    word.length >= MIN_SHARED_PREFIX &&
    head.slice(0, MIN_SHARED_PREFIX) === word.slice(0, MIN_SHARED_PREFIX)
  );
}

function clauseIsSupported(clauseBody: string, vocabulary: readonly string[]): boolean {
  const items = clauseBody.split(/,|\band\b|\bor\b|\bplus\b/i);
  return items.every((item) => {
    const methodWords = itemMethodWords(item);
    if (methodWords.length === 0) return true;
    return methodWords.some((token) => vocabulary.some((word) => supports(token, word)));
  });
}

/**
 * Where a method clause stops. Beyond punctuation, an infinitive ("to link ..."), a
 * purpose ("for ..."), a second finite verb ("and examines ...") or a dash starts what
 * the method is used for, which is the claim the clause modifies rather than the method.
 */
const CLAUSE_END =
  /[;:!?()\u2013\u2014]|\.(?=\s|$)|,\s*(?:and\s+)?(?:which|while|to|as|where|that|with|including|such\s+as)\b|,\s*(?:and\s+)?[a-z]+ing\b|\s+(?:to|for|in\s+order\s+to)\s+|\s+and\s+[a-z]+(?:es|s)\s+(?!and\b)[a-z]/i;

/**
 * "through" also reads a span of time or development ("from infancy through early
 * adolescence", "from pre-conception through pregnancy"), which names no method.
 */
const NON_METHOD_THROUGH_LEAD =
  /^(?:early|late|middle|childhood|adolescence|adulthood|infancy|old\s+age|life|the\s+lifespan|the\s+life\s+course|time|history|the\s+(?:\w+\s+)?centur(?:y|ies)|\d)/i;

const DANGLING_FRAGMENT_MAX_WORDS = 1;

/**
 * A comma-led tail the strip cut down to a single word ("..., often.") goes with it; the
 * last item of a list ("..., and colonialism.") stays.
 */
function withoutDanglingFragment(sentence: string): string {
  const match = /,([^,;]*)([.;!?]?)\s*$/.exec(sentence);
  if (!match) return sentence;
  if (/^\s*(?:and|or)\b/i.test(match[1])) return sentence;
  if (words(match[1]).length > DANGLING_FRAGMENT_MAX_WORDS) return sentence;
  return `${sentence.slice(0, match.index)}${match[2]}`;
}

const CLAUSE_ELABORATION = /^,\s*(?:and\s+)?(?:including|such\s+as)\b/i;

/**
 * Only the method clause goes, so the claim it modifies ("..., and examines Y", "to
 * understand Z") stays. An "including" or "such as" tail lists more of the same methods
 * and goes with them.
 */
function withItsElaboration(sentence: string, bodyEnd: number): number {
  if (!CLAUSE_ELABORATION.test(sentence.slice(bodyEnd))) return bodyEnd;
  const elaborationEnd = sentence.slice(bodyEnd).search(/;|[.!?](?=\s|$)/);
  return elaborationEnd === -1 ? sentence.length : bodyEnd + elaborationEnd;
}

export interface MethodClauseOutcome {
  text: string | null;
  stripped: number;
}

/**
 * The text with every "using/via/through <phrase>" clause the evidence does not state as
 * a method removed, leaving the claim it modifies. A sentence the strip leaves shorter than
 * three words goes with it, and
 * `text` is null when nothing is left, which a caller refuses under its own name.
 */
export function withoutUnsupportedMethodClauses(
  text: string,
  evidenceTexts: readonly string[],
): MethodClauseOutcome {
  if (!evidenceTexts.some((evidence) => String(evidence ?? '').trim())) {
    return { text, stripped: 0 };
  }
  const vocabulary = evidenceMethodVocabulary(evidenceTexts);
  let stripped = 0;
  const sentences = splitDescriptionSentences(text).map((sentence) => {
    let result = sentence;
    OUTPUT_METHOD_MARKER.lastIndex = 0;
    let match: RegExpExecArray | null;
    const removals: Array<[number, number]> = [];
    while ((match = OUTPUT_METHOD_MARKER.exec(sentence))) {
      const start = match.index;
      const bodyStart = start + match[0].length;
      const rest = sentence.slice(bodyStart);
      if (
        /^through/i.test(match[0]) &&
        (NON_METHOD_THROUGH_LEAD.test(rest) ||
          /\bfrom\s+[^,;]{1,60}$/i.test(sentence.slice(0, start)))
      ) {
        continue;
      }
      const end = rest.search(CLAUSE_END);
      const bodyEnd = end === -1 ? sentence.length : bodyStart + end;
      if (!clauseIsSupported(sentence.slice(bodyStart, bodyEnd), vocabulary)) {
        removals.push([start, withItsElaboration(sentence, bodyEnd)]);
        OUTPUT_METHOD_MARKER.lastIndex = bodyEnd;
      }
    }
    for (const [start, end] of removals.reverse()) {
      result = `${result.slice(0, start)}${result.slice(end)}`;
      stripped += 1;
    }
    return withoutDanglingFragment(result)
      .replace(/(?:[\s,]+(?:while|and|or|by|to|for|with|of|in|from))+\s*(?=[.;:!?]|$)/gi, '')
      .replace(/\s*,\s*(?=[.;:!?]|$)/g, '')
      .replace(/\s+([.;:!?,])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
  });
  if (stripped === 0) return { text, stripped };
  const kept = sentences.filter((sentence) => words(sentence).length >= MIN_KEPT_SENTENCE_WORDS);
  const joined = kept
    .map((sentence) => (/[.!?]$/.test(sentence) ? sentence : `${sentence}.`))
    .join(' ')
    .trim();
  return { text: joined || null, stripped };
}
