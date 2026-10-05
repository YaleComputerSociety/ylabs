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

/**
 * Each marker word must end where the evidence word ends: unbounded, "develop" matched
 * inside "development" and "with" inside "within", so a topic list after "economic
 * development" read as methods.
 */
const EVIDENCE_METHOD_MARKER =
  /\b(?:(?:using|uses?|used|with|via|through|by\s+means\s+of|by|based\s+on|employ(?:s|ing|ed)?|utili[sz](?:e|es|ing|ed)|leverag(?:e|es|ing|ed)|harness(?:es|ing|ed)?|appl(?:y|ies|ying|ied)|combin(?:e|es|ing|ed)|integrat(?:e|es|ing|ed)|conduct(?:s|ing|ed)?|perform(?:s|ing|ed)?|measur(?:e|es|ing|ed)|compar(?:e|es|ing|ed)|analy[sz](?:e|es|ing|ed)|from\s+an?|draw(?:s|ing)?\s+on|develop(?:s|ing|ed)?|implement(?:s|ing|ed)?|rel(?:y|ies|ying|ied)\s+on|applications?\s+of)(?![\w-])|(?:methods?|techniques?|approach(?:es)?|tools?)\W+(?:(?:include|includes|including|spanning|such\s+as)(?![\w-]))?)\s*/gi;

/**
 * Prepositional markers, the ones that attach a method to the noun just before them.
 */
const ATTACHING_MARKER = /^(?:using|via|through|by\s+means\s+of|employ|utili[sz]|leverag)/i;

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

function distinctiveParts(tokens: readonly string[]): string[] {
  return tokens.flatMap(compoundForms).filter(distinctive);
}

/**
 * Where the evidence's method context stops. A comma before a new subject ("with other
 * colleagues, we have done research on X"), a purpose ("using X to study Y") or the
 * topic of a research noun ("conducts clinical research on X") ends it, so what follows
 * is not read as part of the method. A list's commas, a parenthetical and an
 * "including" tail do not, because they name more of the same methods.
 */
const EVIDENCE_CLAUSE_END =
  /[;:!?\u2014]|(?<!\w)\u2013|\u2013(?!\w)|\.(?=\s|$)|,\s*(?:and\s+)?(?:which|while|where|that|whose)\b|,\s*(?:we|i|he|she|they|it|our|my|his|her|their)\b|\s+(?:to|in\s+order\s+to)\s+|(?<=\b(?:research|stud(?:y|ies)|work|investigations?))\s+(?:on|of|into|about|in)\s+/i;

const COORDINATE_ITEM_SPLIT = /,|\band\b|\bor\b|\bplus\b/i;

/**
 * One place the evidence states a method: its words, and for a prepositional marker the
 * list item it modifies (`head`) and the items listed beside that one (`siblings`), so a
 * method the page gives one listed aim is not credited to another.
 */
interface EvidenceMethodContext {
  words: readonly string[];
  head: readonly string[];
  siblings: ReadonlyArray<readonly string[]>;
}

const MODIFIER_WALK_STOP = new Set([
  'of',
  'in',
  'on',
  'for',
  'with',
  'to',
  'from',
  'by',
  'at',
  'as',
  'the',
  'a',
  'an',
  'our',
  'their',
  'its',
  'his',
  'her',
  'is',
  'are',
  'we',
  'that',
  'which',
  'uses',
  'using',
]);
const MAX_MODIFIER_WALK_WORDS = 6;

/**
 * The words naming a generic method noun, back to the phrase's start within its list
 * item: "high-field MR and PET-based techniques" names both imaging methods, while in
 * "X, Y and nucleic acid delivery approaches" the noun names only the last item.
 */
function methodNounModifiers(clauseWords: readonly string[], nounIndex: number): string[] {
  const modifiers: string[] = [];
  for (
    let index = nounIndex - 1;
    index >= 0 && nounIndex - index <= MAX_MODIFIER_WALK_WORDS;
    index -= 1
  ) {
    if (MODIFIER_WALK_STOP.has(clauseWords[index])) break;
    modifiers.push(clauseWords[index]);
  }
  return distinctiveParts(modifiers);
}

function attachedItems(beforeMarker: string): Pick<EvidenceMethodContext, 'head' | 'siblings'> {
  const items = beforeMarker
    .split(COORDINATE_ITEM_SPLIT)
    .map((item) => distinctiveParts(words(item)))
    .filter((item) => item.length > 0);
  if (items.length < 2) return { head: items[0] ?? [], siblings: [] };
  return { head: items[items.length - 1], siblings: items.slice(0, -1) };
}

/**
 * Every place the evidence names a method: the words after a marker such as "using" or
 * "with", up to the end of that clause, plus the words naming a generic method noun
 * ("computational methods"). A bare "include" or "including" is not a marker, because
 * "interests include X" is the interest list this check exists to stop being restated as
 * a method.
 */
function evidenceMethodContexts(evidenceTexts: readonly string[]): EvidenceMethodContext[] {
  const contexts: EvidenceMethodContext[] = [];
  for (const text of evidenceTexts) {
    for (const clause of splitDescriptionSentences(String(text ?? '')).flatMap((sentence) =>
      sentence.split(/[;:]+/),
    )) {
      EVIDENCE_METHOD_MARKER.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = EVIDENCE_METHOD_MARKER.exec(clause))) {
        const marker = match[0].trim();
        const after = clause.slice(match.index + match[0].length);
        if (NOT_A_METHOD_AFTER_MARKER.test(after)) continue;
        const end = after.search(EVIDENCE_CLAUSE_END);
        const context = end === -1 ? after : after.slice(0, end);
        contexts.push({
          words: distinctiveParts(words(context).slice(0, METHOD_CONTEXT_WINDOW_WORDS)),
          ...(ATTACHING_MARKER.test(marker)
            ? attachedItems(clause.slice(0, match.index))
            : { head: [], siblings: [] }),
        });
      }
      for (const listItem of clause.split(',')) {
        const itemWords = words(listItem);
        itemWords.forEach((token, index) => {
          if (!GENERIC_METHOD_NOUNS.has(token)) return;
          contexts.push({ words: methodNounModifiers(itemWords, index), head: [], siblings: [] });
        });
      }
    }
  }
  return contexts;
}

export function evidenceMethodVocabulary(evidenceTexts: readonly string[]): string[] {
  return [...new Set(evidenceMethodContexts(evidenceTexts).flatMap((context) => context.words))];
}

const QUANTIFIER_LEAD =
  /^\s*(?:an?\s+)?(?:(?:wide|broad|diverse|large)\s+)?(?:range|variety|number|suite|combination|mix|array|set|series|host|battery|panel|collection)\s+of\s+/i;

/**
 * The words that name the method in one list item: the part before a preposition, since
 * "ethnographic study of audience practices" names ethnography, not audiences, with
 * generic nouns such as "methods" or "analysis" set aside. A quantifier ("a range of")
 * names no method, so the phrase it quantifies is the lead.
 */
function itemMethodWords(item: string): string[] {
  const lead = item
    .replace(QUANTIFIER_LEAD, '')
    .split(/\s+(?:of|in|on|for|with|across|from|to|among|at)\s+/i)[0];
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

const sharesAWord = (left: readonly string[], right: readonly string[]): boolean =>
  left.some((token) => right.some((word) => sharesAnInflectionalStem(token, word)));

/**
 * The text credits the method to an item the evidence lists beside the one it modifies:
 * "studies X, Y and therapies using small molecules" does not say X uses them. The match
 * is on a listed item's head noun, since a longer item can mention the text's head in
 * passing.
 */
function creditsAnotherListedItem(
  context: EvidenceMethodContext,
  textHead: string | undefined,
): boolean {
  if (!textHead || context.siblings.length === 0) return false;
  return (
    !sharesAWord([textHead], context.head) &&
    context.siblings.some((sibling) => sharesAWord([textHead], sibling.slice(-1)))
  );
}

function clauseIsSupported(
  clauseBody: string,
  contexts: readonly EvidenceMethodContext[],
  textHead: string | undefined,
): boolean {
  const usable = contexts.filter((context) => !creditsAnotherListedItem(context, textHead));
  const items = clauseBody.split(COORDINATE_ITEM_SPLIT);
  return items.every((item) => {
    const methodWords = itemMethodWords(item);
    if (methodWords.length === 0) return true;
    return methodWords.some((token) =>
      usable.some((context) => context.words.some((word) => supports(token, word))),
    );
  });
}

/** The last distinctive word before a method marker: the thing the text says uses it. */
function textHeadBefore(text: string): string | undefined {
  const tokens = distinctiveParts(words(text));
  return tokens[tokens.length - 1];
}

/**
 * Where a method clause stops. Beyond punctuation, an infinitive ("to link ..."), a
 * purpose ("for ..."), a second finite verb ("and examines ...") or a dash starts what
 * the method is used for, which is the claim the clause modifies rather than the method.
 * An en dash joining two words ("text\u2013image") is a compound, and an "-ous" adjective or a
 * plural noun before a preposition ("and heterogeneous catalysis", "and markups to")
 * is a further list item rather than a second verb, so neither ends the clause.
 */
const CLAUSE_END =
  /[;:!?()\u2014]|(?<!\w)\u2013|\u2013(?!\w)|\.(?=\s|$)|,\s*(?:and\s+)?(?:which|while|to|as|where|that|with|including|such\s+as)\b|,\s*(?:and\s+)?[a-z]+ing\b|\s+(?:to|for|in\s+order\s+to)\s+|\s+and\s+(?![a-z]+(?:ous|ss|is|us|ics)\b)[a-z]+(?:es|s)\s+(?!(?:and|or|to|for|of|in|on|at|with|from|by)\b)[a-z]/i;

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

/**
 * A parenthetical inside a method clause ("using X (abbreviation) and Y") belongs to it,
 * so the clause runs on past it to the next real end.
 */
function methodClauseEnd(sentence: string, bodyStart: number): number {
  let position = bodyStart;
  for (;;) {
    const end = sentence.slice(position).search(CLAUSE_END);
    if (end === -1) return sentence.length;
    const at = position + end;
    const close = sentence[at] === '(' ? sentence.indexOf(')', at) : -1;
    if (close === -1) return at;
    position = close + 1;
  }
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
  const contexts = evidenceMethodContexts(evidenceTexts);
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
      const bodyEnd = methodClauseEnd(sentence, bodyStart);
      if (
        !clauseIsSupported(
          sentence.slice(bodyStart, bodyEnd),
          contexts,
          textHeadBefore(sentence.slice(0, start)),
        )
      ) {
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
