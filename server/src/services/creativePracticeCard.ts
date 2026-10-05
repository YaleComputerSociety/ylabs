import { splitDescriptionSentences } from '../utils/careerBiographyDescription';
import {
  cardSpeaksInResearchVoice,
  creativePracticeEvidence,
  statesResearchApartFromArtwork,
} from '../utils/creativePracticeDescription';
import { MAX_CARD_SHORT_DESCRIPTION_LENGTH } from '../utils/descriptionHygiene';
import { standaloneCardQuality } from '../utils/researchEntityDescriptionQuality';

// The shared splitter keeps the common abbreviations whole but not a company's, so a
// sentence after "Warner Bros." would open mid-clause.
const TRAILING_COMPANY_ABBREVIATION = /\b(?:Bros|Inc|Corp|Co|Ltd|Mfg|Assn|Dept|Univ)\.$/;

const MIN_CARD_SENTENCE_WORDS = 6;

// A profile header the extractor glued onto the first sentence ("Graphic DesignUndergraduate
// Senior Critic Instagram") is page chrome, not the person's practice.
const GLUED_PROFILE_HEADER =
  /[a-z](?:Undergraduate|Graduate|Instagram|Website|Lecturer|Critic|Professor|Director)\b|\bInstagram\b/;

export type CreativePracticeCardDecision =
  | { card: string; withheldBy: null }
  | { card: string; withheldBy: 'researchVoiceCardReplacedByPracticeSentence' }
  | { card: ''; withheldBy: 'researchVoiceCardWithoutPracticeSentence' };

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const isPracticeCardSentence = (sentence: string, previous: string | undefined): boolean =>
  !TRAILING_COMPANY_ABBREVIATION.test(previous ?? '') &&
  sentence.split(' ').length >= MIN_CARD_SENTENCE_WORDS &&
  sentence.length <= MAX_CARD_SHORT_DESCRIPTION_LENGTH &&
  !GLUED_PROFILE_HEADER.test(sentence) &&
  creativePracticeEvidence(sentence).length > 0 &&
  !statesResearchApartFromArtwork(sentence) &&
  !cardSpeaksInResearchVoice(sentence) &&
  standaloneCardQuality(sentence).isUseful;

/**
 * The card a labelled creative practice row serves. A card in the research voice ("Studies
 * chamber music.") contradicts the label beside it and is usually a chip summary the
 * practice body never states, so the body's own first practice sentence replaces it, and
 * with no such sentence the card is withheld: a blank card line is the smaller cost than a
 * false one (#2911, #4519).
 */
export function decideCreativePracticeCard(
  card: unknown,
  fullDescription: unknown,
): CreativePracticeCardDecision {
  const servedCard = textValue(card);
  if (!servedCard || !cardSpeaksInResearchVoice(servedCard)) {
    return { card: servedCard, withheldBy: null };
  }
  const sentences = splitDescriptionSentences(textValue(fullDescription)).map(textValue);
  const practiceSentence = sentences.find((sentence, index) =>
    isPracticeCardSentence(sentence, sentences[index - 1]),
  );
  return practiceSentence
    ? { card: practiceSentence, withheldBy: 'researchVoiceCardReplacedByPracticeSentence' }
    : { card: '', withheldBy: 'researchVoiceCardWithoutPracticeSentence' };
}
