import { researchStatementSentences } from './careerBiographyDescription';

// The verbs that state what a person researches, in any inflection. The card-lead verb list behind
// `describesResearchFocus` also counts "supports" and "uses", which open an office's card
// as readily as a lab's, so it cannot be the witness that a row states no research.
const CARD_STATES_RESEARCH =
  /\b(?:stud(?:y|ies|ying)|investigat(?:e|es|ing)|examin(?:e|es|ing)|explor(?:e|es|ing)|develop(?:s|ing)?|analy[sz](?:e|es|ing)|research(?:es|ers?|ing)?)\b/i;

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

// A humanities scholar states research as a subject they work on rather than with a lab's
// verbs, so "currently working on William Cobbett" has to read as research too.
const STATES_SCHOLARSHIP =
  /\b(?:works?|working|worked)\s+on\b|\b(?:academic|scholar\w*|monographs?|dissertations?)\b/i;

/**
 * Whether a row's own description states research, the second witness a title screen
 * needs before it may refuse the row: an explicit research statement in either
 * description, or a research verb or the word research on the card.
 */
export function descriptionStatesResearch(entity: {
  shortDescription?: unknown;
  fullDescription?: unknown;
}): boolean {
  if (CARD_STATES_RESEARCH.test(textOf(entity.shortDescription))) return true;
  return [entity.shortDescription, entity.fullDescription].some(
    (value) => researchStatementSentences(value).length > 0,
  );
}

/**
 * The stricter witness a teaching title needs (#4916): a description exists, and neither
 * the card nor the full text carries a research verb or a research statement. An empty
 * row states nothing either way, so it never stands in for a description about
 * something else.
 */
export function descriptionAffirmsNoResearch(entity: {
  shortDescription?: unknown;
  fullDescription?: unknown;
}): boolean {
  const card = textOf(entity.shortDescription).trim();
  const full = textOf(entity.fullDescription).trim();
  if (!card && !full) return false;
  if ([card, full].some((text) => STATES_SCHOLARSHIP.test(text))) return false;
  if (CARD_STATES_RESEARCH.test(full)) return false;
  return !descriptionStatesResearch(entity);
}
