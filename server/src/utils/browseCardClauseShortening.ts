import { browseCardIsCutMidSentence, browseCardSummary } from './browseCardSummary';
import { isTooShortCardLine } from './researchEntityDescriptionQuality';

const EM_DASH_ASIDE_BOUNDARY =
  /\s*[—–]\s*(?:including|such as|primarily|particularly|especially|notably|with)\s/gi;

const BARE_EXAMPLES_BOUNDARY = /\s+(?:such as|including)\s/gi;

// Clause-level boundaries only. A cut at a bare comma, before a parenthesis, or at an
// "and" not followed by a verb or wh-word that opens a clause lands inside a list or
// leaves a clause dangling ("...to study central, autonomic."), which reads worse than a
// card that runs long.
const CLAUSE_BOUNDARIES: readonly RegExp[] = [
  /,\s+(?:including|such as|particularly|especially|notably|with (?:a|an) (?:focus|emphasis) on|with emphasis on|emphasizing|focusing on|with attention to|ranging from)\s/gi,
  EM_DASH_ASIDE_BOUNDARY,
  /,\s+with\s+(?:a\s+|an\s+)?(?:[a-z-]+\s+){0,2}(?:focus|emphasis|interest|work|research|attention)s?\b/gi,
  BARE_EXAMPLES_BOUNDARY,
  /;\s+/g,
  /,\s+(?:which|where|while|whereas)\s/gi,
  /,?\s+(?:aiming to|seeking to|working to|investigating|examining|combining|focused on)\s/gi,
  /\s+to\s+(?:explore|develop|understand|identify|improve|investigate|examine|analyze|determine)\s/gi,
  /\s*[—–]\s*and\s/gi,
  // A second coordinated clause ("..., and how ...", "... and develops ...") leaves the
  // first clause whole when cut before it. Words that also read as plural nouns
  // ("uses", "studies", "tests") are left out, since they continue a noun list.
  /,?\s+and\s+(?:how|why|whether|what|develops|investigates|examines|explores|evaluates|conducts|performs|identifies|creates|provides|applies)\s/gi,
  /,\s+plus\s/gi,
  /\s+(?:using|by combining|by integrating|with the goal of)\s/gi,
  /\s+by\s+[a-z]+ing\s/gi,
  /:\s+/g,
];

const TRAILING_FUNCTION_WORD =
  /\b(?:a|an|the|of|and|or|in|on|for|to|with|by|at|from|as|its|their|his|her|including|are|is|include|includes|was|were)$/i;

// A head that ends on a placeholder noun ("...and topics", "related to conditions") only
// made sense with the examples that followed it.
const TRAILING_PLACEHOLDER_NOUN =
  /(?:\b(?:topics|areas|fields|issues|subjects|themes|questions|aspects|ways|things|targets|figures|institutions|settings)|\b(?:to|and|other)\s+conditions)$/i;

// A boundary with no punctuation before it can follow a word that needs what comes after
// it ("research has focused on", "aims to understand", "in order to", "teach clinicians
// how to", "the ability to", "mediated by signaling"), so the head must not end on an
// auxiliary, a verb or noun that takes "to", a wh-word, an adverb, or a past participle.
const TRAILING_DEPENDENT_WORD =
  /\b(?:has|have|had|been|be|being|can|could|may|might|will|would|should|must|aims?|seeks?|works?|strives?|tries|try|hopes?|able|in order|in an effort|in an attempt|how|what|where|when|whether|ability|capacity|needs?|efforts?|approach(?:es)?|ways?|methods?|tools?|strategies|[a-z]+ly|[a-z]+ed|driven|shown|known|given|taken|made|grown|led|held|built|drawn|seen|done|found|thought|brought|caught|taught|understood|written|chosen)$/i;

const MAX_SHORTENED_LENGTH = 190;
const MIN_SHORTENED_LENGTH = 35;
const MIN_SHORTENED_WORDS = 6;

// An aside opened by an em dash and closed by another ("signaling in the uterus —
// especially ... — influences") holds the sentence's verb after it, so the head before
// it has no verb.
const cutsBeforeAClosedAside = (pattern: RegExp, tail: string): boolean =>
  pattern === EM_DASH_ASIDE_BOUNDARY && /[—–]/.test(tail);

const opensWithPunctuation = (boundary: string): boolean => /^\s*[,;:—–]/.test(boundary);

// "mechanisms that allow specialized cell types such as neurons ... to meet" holds the
// relative clause's verb after its examples.
const cutsInsideARelativeClause = (pattern: RegExp, head: string): boolean =>
  pattern === BARE_EXAMPLES_BOUNDARY && /\b(?:that|which|who)\b/i.test(head.split(',').pop() ?? '');

const balancedParentheses = (value: string): boolean =>
  (value.match(/\(/g) || []).length === (value.match(/\)/g) || []).length;

/**
 * A card line the browse card would cut mid-sentence, ended instead at the last clause
 * boundary that fits: "Investigates protein degradation by the ubiquitin–proteasome
 * system in yeast, including ubiquitin conjugation, ..." serves as "Investigates protein
 * degradation by the ubiquitin–proteasome system in yeast." The head of a grounded
 * sentence is grounded, so this adds no claim. A line with no such boundary inside the
 * card is returned unchanged rather than cut inside a list (#4809).
 */
export function shortenCardLineToFitBrowseCard(card: string): string {
  const text = card.replace(/\s+/g, ' ').trim();
  if (!browseCardIsCutMidSentence(browseCardSummary(text))) return text;
  for (const pattern of CLAUSE_BOUNDARIES) {
    const cuts: { at: number; boundary: string }[] = [];
    const matcher = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text))) {
      if (match.index >= MIN_SHORTENED_LENGTH && match.index <= MAX_SHORTENED_LENGTH) {
        cuts.push({ at: match.index, boundary: match[0] });
      }
    }
    for (const { at, boundary } of cuts.reverse()) {
      const head = text.slice(0, at).replace(/[\s,;:–—-]+$/, '');
      if (cutsBeforeAClosedAside(pattern, text.slice(at + boundary.length))) continue;
      if (!opensWithPunctuation(boundary) && TRAILING_DEPENDENT_WORD.test(head)) continue;
      if (cutsInsideARelativeClause(pattern, head)) continue;
      if (TRAILING_FUNCTION_WORD.test(head) || TRAILING_PLACEHOLDER_NOUN.test(head)) continue;
      // A head already ending in a period ends in an abbreviation ("the U.S."), which
      // the card quality check reads as an unfinished sentence and the gate would hold.
      if (/[.!?]$/.test(head)) continue;
      if (!balancedParentheses(head)) continue;
      if (head.split(/\s+/).length < MIN_SHORTENED_WORDS) continue;
      // The gate holds a row whose card the quality check calls too short.
      if (isTooShortCardLine(`${head}.`)) continue;
      return `${head}.`;
    }
  }
  return text;
}
