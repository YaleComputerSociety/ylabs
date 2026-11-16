export const DESCRIPTION_LANE_SOURCE_NAME = 'lab-microsite-description-llm';

const NAME_STOP_WORDS = new Set(['and', 'of', 'the', 'in', 'for', 'on', 'at']);
const STEM_LENGTH = 7;

const words = (text: string): string[] => text.toLowerCase().match(/[a-z]+/g) ?? [];

const stem = (word: string): string => word.slice(0, STEM_LENGTH);

const count = (line: string, pattern: RegExp): number => (line.match(pattern) ?? []).length;

const endsLikeASentence = (line: string): boolean => /[.!?]\s*$/.test(line.trim());

const isListLine = (line: string): boolean =>
  count(line, /;/g) >= 2 ||
  (!endsLikeASentence(line) && (/^\s*[a-z][a-z ]{0,30}:\s/.test(line) || count(line, /,/g) >= 3));

const proseSentences = (text: string): string[][] =>
  text
    .toLowerCase()
    .split(/\n+/)
    .filter((line) => !isListLine(line))
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((sentence) => words(sentence).map(stem));

export function descriptionStatesResearchArea(topic: unknown, description: string): boolean {
  if (typeof topic !== 'string') return false;
  const topicStems = words(topic)
    .filter((word) => !NAME_STOP_WORDS.has(word))
    .map(stem);
  if (topicStems.length === 0) return false;
  return proseSentences(description).some((sentence) => {
    const present = new Set(sentence);
    return topicStems.every((word) => present.has(word));
  });
}

export function storedServedDescription(
  entityDoc: Record<string, unknown> | null | undefined,
): string {
  return [entityDoc?.shortDescription, entityDoc?.fullDescription]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');
}

interface ResearchAreaObservationLike {
  field: string;
  sourceName?: string;
  value: unknown;
}

// A correctly empty page-topic reading means the row's own pages state no current
// research, so a topic other lanes propose is evidence only where the graded served
// description also states it (#6360, manager 2026-11-16). The STORED description is
// read, never this pass's derived one, so topics and description cannot chase each
// other across resolves.
export function withResearchAreasGroundedInStoredDescription<T extends ResearchAreaObservationLike>(
  observations: readonly T[],
  description: string,
): T[] {
  return observations.flatMap((observation) => {
    if (observation.field !== 'researchAreas') return [observation];
    if (observation.sourceName !== DESCRIPTION_LANE_SOURCE_NAME) return [];
    const values = Array.isArray(observation.value) ? observation.value : [observation.value];
    const grounded = values.filter((value) => descriptionStatesResearchArea(value, description));
    return grounded.length > 0 ? [{ ...observation, value: grounded }] : [];
  });
}
