import {
  isBibliographicCitationSentence,
  isCareerFactSentence,
  isCurriculumVitaeRecordSentence,
  isTeachingOrPastTraineeSentence,
  researchStatementSentences,
  splitDescriptionSentences,
} from './careerBiographyDescription';
import {
  opensByStatingResearch,
  type ResearchStatementReading,
} from './biographyRatherThanResearch';
import { isClinicalServiceSentence, isClinicianCareerSentence } from './clinicalServiceSentence';

const FIRST_PERSON_RESEARCH_ACTIVITY =
  /^(?:(?:Currently|Broadly|Primarily|Mainly),?\s+)?(?:I|We|Our\s+(?:lab|group|team))\s+(?:also\s+|mainly\s+|primarily\s+|currently\s+)?(?:study|develop|investigate|examine|explore|model|analy[sz]e|design|build|work\s+(?:on|in|mainly\s+in|at\s+the\s+intersection)|use\s+[^.]{0,80}\bto\s+(?:study|understand|examine|investigate)|focus\s+on|am\s+interested\s+in|are\s+interested\s+in|research)\b/i;
const POSSESSIVE_RESEARCH =
  /^(?:\p{Lu}[\p{L}'’-]+['’]s\s+|(?:My|Our|His|Her|Their)\s+)(?:main\s+|primary\s+|current\s+|recent\s+)?(?:research|work|scholarship)\s+(?:relates?|lies|is|are|centers|centres|spans|includes?)\b/u;
const FIRST_PERSON_RESULT = /^(?:I|We)\s+(?:also\s+)?(?:conjecture|prove|show|propose)\s+that\b/;
const SOCIAL_INTEREST =
  /\binterested\s+in\s+(?:hearing|learning\s+(?:about|if|whether)|receiving|getting|joining|working\s+with)\b/i;
const DATED_OR_FORMER_POST = /\b(?:19|20)\d{2}\b|\b(?:served|was|were)\s+(?:as|an?)\b/;

export function statesResearchSentence(
  sentence: string,
  reading: ResearchStatementReading = {},
): boolean {
  const text = sentence.trim();
  return (
    (opensByStatingResearch(text, reading) && !SOCIAL_INTEREST.test(text)) ||
    POSSESSIVE_RESEARCH.test(text) ||
    FIRST_PERSON_RESULT.test(text) ||
    researchStatementSentences(text, { activityAnchors: true }).length > 0 ||
    FIRST_PERSON_RESEARCH_ACTIVITY.test(text)
  );
}

const isRecordOrCareerSentence = (sentence: string): boolean =>
  isCurriculumVitaeRecordSentence(sentence) ||
  isCareerFactSentence(sentence) ||
  isTeachingOrPastTraineeSentence(sentence);

function passageOf(
  sentences: readonly string[],
  reading: ResearchStatementReading,
  isSetAside: (sentence: string) => boolean,
): string {
  const kept: string[] = [];
  let followsResearch = false;
  for (const sentence of sentences) {
    if (isSetAside(sentence)) {
      followsResearch = false;
      continue;
    }
    if (statesResearchSentence(sentence, reading) && !isBibliographicCitationSentence(sentence)) {
      kept.push(sentence);
      followsResearch = true;
      continue;
    }
    if (
      followsResearch &&
      !isRecordOrCareerSentence(sentence) &&
      !DATED_OR_FORMER_POST.test(sentence)
    ) {
      kept.push(sentence);
      continue;
    }
    followsResearch = false;
  }
  return kept.join(' ');
}

const sentencesOf = (text: string): string[] =>
  splitDescriptionSentences(text.replace(/\s+/g, ' ').trim());

/**
 * A lab-site description narrowed to the sentences that state research (#5648): each one that
 * states it, and each one after it that elaborates rather than records a career, a course, a
 * date or a former post. A value that states no research narrows to an empty string, because a
 * recipe, an awards list or a donation appeal copied off a homepage is not a description.
 */
export function researchPassageOf(text: string, reading: ResearchStatementReading = {}): string {
  return passageOf(sentencesOf(text), reading, () => false);
}

const isClinicalServiceOrCareerSentence = (sentence: string): boolean =>
  isClinicalServiceSentence(sentence) || isClinicianCareerSentence(sentence);

/**
 * The resolver's narrowing of a person's lab-site description (#5537): the research passage
 * with each clinical-service sentence and clinician-career line set aside, so a specialty, the
 * care given or a training line is neither kept as research nor carried as a follow-on. A value
 * with no clinical-service sentence narrows exactly as `researchPassageOf` does.
 */
export function researchPassageWithoutClinicalService(text: string): string {
  const sentences = sentencesOf(text);
  if (!sentences.some(isClinicalServiceSentence)) return researchPassageOf(text);
  return passageOf(sentences, {}, isClinicalServiceOrCareerSentence);
}

export const LAB_SITE_DESCRIPTION_SOURCE = 'lab-microsite-description-llm';

/**
 * The rows the narrowing applies to (#5648): a person's research, which is where a personal
 * homepage's recipes, awards and appointment notes reach a description. A lab, center, core,
 * program or fellowship body states a unit's work in other words, so it is left as it is.
 */
export function isPersonResearchRow(row: { entityType?: unknown; kind?: unknown }): boolean {
  const entityType = typeof row.entityType === 'string' ? row.entityType.trim().toUpperCase() : '';
  if (entityType) return entityType === 'FACULTY_RESEARCH_AREA';
  return typeof row.kind === 'string' && row.kind.trim().toLowerCase() === 'individual';
}
const NARROWED_DESCRIPTION_FIELDS: ReadonlySet<string> = new Set([
  'fullDescription',
  'description',
]);

export const isNarrowedLabSiteDescription = (observation: {
  sourceName?: unknown;
  field?: unknown;
  value?: unknown;
}): boolean =>
  observation.sourceName === LAB_SITE_DESCRIPTION_SOURCE &&
  typeof observation.field === 'string' &&
  NARROWED_DESCRIPTION_FIELDS.has(observation.field) &&
  typeof observation.value === 'string';

/**
 * The value the resolver reads for a lab-site description observation on a person's row, or
 * `null` for any other observation. An empty string means nothing of the value survives.
 * Provenance matching reads it too, because the resolver's winner carries the narrowed text
 * rather than the stored observation's own value.
 */
export function narrowedLabSiteDescriptionValue(observation: {
  sourceName?: unknown;
  field?: unknown;
  value?: unknown;
}): string | null {
  if (!isNarrowedLabSiteDescription(observation)) return null;
  return researchPassageWithoutClinicalService(observation.value as string);
}

/**
 * The resolver's view of the lab-site description observations, each narrowed to its research
 * passage and dropped when none is left. A derivation on every resolve: it writes no field and
 * no lock, so a fix to the predicate reaches every row on its next materialize.
 */
export function withLabSiteDescriptionsNarrowedToResearch<
  T extends { sourceName?: unknown; field?: unknown; value?: unknown },
>(observations: readonly T[]): T[] {
  return observations.flatMap((observation) => {
    const passage = narrowedLabSiteDescriptionValue(observation);
    if (passage === null) return [observation];
    return passage ? [{ ...observation, value: passage }] : [];
  });
}
