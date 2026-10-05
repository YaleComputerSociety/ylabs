import { browseCardIsCutMidSentence, browseCardSummary } from './browseCardSummary';

// Clause-level boundaries only. A cut at a bare comma, at ", and", or before a
// parenthesis lands inside a list or leaves a clause dangling ("...to study central,
// autonomic."), which reads worse than a card that runs long.
const CLAUSE_BOUNDARIES: readonly RegExp[] = [
  /,\s+(?:including|such as|particularly|especially|notably|with (?:a|an) (?:focus|emphasis) on|focusing on|with attention to|ranging from)\s/gi,
  /;\s+/g,
  /,\s+(?:which|where|while|whereas)\s/gi,
  /\s+(?:using|by combining|by integrating|with the goal of)\s/gi,
];

const TRAILING_FUNCTION_WORD =
  /\b(?:a|an|the|of|and|or|in|on|for|to|with|by|at|from|as|its|their|his|her)$/i;

const MAX_SHORTENED_LENGTH = 190;
const MIN_SHORTENED_LENGTH = 60;
const MIN_SHORTENED_WORDS = 6;

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
    const cuts: number[] = [];
    const matcher = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text))) {
      if (match.index >= MIN_SHORTENED_LENGTH && match.index <= MAX_SHORTENED_LENGTH) {
        cuts.push(match.index);
      }
    }
    for (const at of cuts.reverse()) {
      const head = text.slice(0, at).replace(/[\s,;:–—-]+$/, '');
      if (TRAILING_FUNCTION_WORD.test(head)) continue;
      // A head already ending in a period ends in an abbreviation ("the U.S."), which
      // the card quality check reads as an unfinished sentence and the gate would hold.
      if (/[.!?]$/.test(head)) continue;
      if (!balancedParentheses(head)) continue;
      if (head.split(/\s+/).length < MIN_SHORTENED_WORDS) continue;
      return `${head}.`;
    }
  }
  return text;
}
