import { foldLatinDiacritics } from '../utils/latinDiacritics';

export const SERVICE_CORE_DEMOTION_WINDOW = 30;

export const CORE_FACILITY_ENTITY_TYPE = 'CORE_FACILITY';
const CORE_FACILITY_KIND = 'core_facility';
const FACULTY_RESEARCH_ENTITY_TYPE = 'FACULTY_RESEARCH_AREA';
const DEMOTABLE_ENTITY_TYPES = new Set([CORE_FACILITY_ENTITY_TYPE, FACULTY_RESEARCH_ENTITY_TYPE]);

export interface ServiceCoreFacts {
  entityType?: unknown;
  name?: unknown;
  displayName?: unknown;
  shortDescription?: unknown;
  fullDescription?: unknown;
}

export type ServiceCoreDemotionReason =
  'core-facility' | 'core-service-text' | 'query-names-the-row' | 'research';

const SENTENCE_BOUNDARY = /(?<=[.!?;])\s+/;
const SERVICE_OFFER_OPENING =
  /^(?:[\w()'&-]+\s+){0,6}?(?:provides|offers)\s+((?:[\w-]+,?\s+){0,6}?)(?:services|support\s+for\s+(?:[\w-]+\s+){0,3}instruments?)\b/i;
const CARE_SERVICE_WORDS = /\b(?:clinical|care|patient|legal|counsel\w*)\b/i;

const openingSentence = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().split(SENTENCE_BOUNDARY, 1)[0] ?? '';
};

const opensWithCoreServiceOffer = (text: unknown): boolean => {
  const match = SERVICE_OFFER_OPENING.exec(openingSentence(text));
  return match !== null && !CARE_SERVICE_WORDS.test(match[1] ?? '');
};

export const researchTextIsCoreServiceText = (
  facts: Pick<ServiceCoreFacts, 'shortDescription' | 'fullDescription'>,
): boolean =>
  opensWithCoreServiceOffer(facts.shortDescription) ||
  opensWithCoreServiceOffer(facts.fullDescription);

const GENERIC_CORE_TITLE_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'center',
  'centre',
  'core',
  'facility',
  'for',
  'in',
  'lab',
  'laboratory',
  'of',
  'on',
  'program',
  'resource',
  'service',
  'shared',
  'the',
  'university',
  'yale',
]);
const CORE_KIND_QUERY_WORDS = new Set(['core', 'facility', 'shared', 'resource']);
const PARENTHESIZED_ACRONYM = /\(([A-Za-z0-9]{2,12})\)/g;

const foldWord = (word: string): string => {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
};

const titleWords = (value: string): string[] =>
  foldLatinDiacritics(value.toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(foldWord);

const titleNamedByQuery = (title: string, queryWords: ReadonlySet<string>): boolean => {
  const acronyms = [...title.matchAll(PARENTHESIZED_ACRONYM)].map((match) =>
    match[1].toLowerCase(),
  );
  if (acronyms.some((acronym) => queryWords.has(acronym))) return true;
  const words = new Set(titleWords(title.replace(PARENTHESIZED_ACRONYM, ' ')));
  const distinctive = [...words].filter((word) => !GENERIC_CORE_TITLE_WORDS.has(word));
  if (distinctive.length === 0) return false;
  if (distinctive.every((word) => queryWords.has(word))) return true;
  const typedCoreKind = [...queryWords].some((word) => CORE_KIND_QUERY_WORDS.has(word));
  const queryTopicWords = [...queryWords].filter((word) => !GENERIC_CORE_TITLE_WORDS.has(word));
  return (
    typedCoreKind && queryTopicWords.length > 0 && queryTopicWords.every((word) => words.has(word))
  );
};

export const queryNamesTheRow = (
  facts: Pick<ServiceCoreFacts, 'name' | 'displayName'>,
  queryTokens: readonly string[],
): boolean => {
  const queryWords = new Set(queryTokens.flatMap(titleWords));
  if (queryWords.size === 0) return false;
  return [facts.name, facts.displayName].some(
    (title) => typeof title === 'string' && titleNamedByQuery(title, queryWords),
  );
};

export const serviceCoreDemotionReason = (
  facts: ServiceCoreFacts,
  queryTokens: readonly string[],
): ServiceCoreDemotionReason => {
  const kind =
    facts.entityType === CORE_FACILITY_ENTITY_TYPE
      ? 'core-facility'
      : facts.entityType === FACULTY_RESEARCH_ENTITY_TYPE && researchTextIsCoreServiceText(facts)
        ? 'core-service-text'
        : 'research';
  if (kind === 'research') return kind;
  return queryNamesTheRow(facts, queryTokens) ? 'query-names-the-row' : kind;
};

export const isDemotedServiceCoreReason = (reason: ServiceCoreDemotionReason): boolean =>
  reason === 'core-facility' || reason === 'core-service-text';

export type ServiceCoreDemotionExemption = 'name-query' | 'type-filter-selects-cores';

export const serviceCoreDemotionExemption = ({
  answeredAsNameSearch,
  filters,
}: {
  answeredAsNameSearch: boolean;
  filters: { entityType?: readonly string[]; kind?: readonly string[] };
}): ServiceCoreDemotionExemption | null => {
  if (answeredAsNameSearch) return 'name-query';
  if (
    filters.entityType?.includes(CORE_FACILITY_ENTITY_TYPE) ||
    filters.kind?.includes(CORE_FACILITY_KIND)
  ) {
    return 'type-filter-selects-cores';
  }
  return null;
};

export interface DemoteServiceCoresOptions<T> {
  isDemoted: (hit: T) => boolean;
  tierOf?: (hit: T) => number;
}

export const demoteServiceCoresBelowResearch = <T>(
  hits: T[],
  { isDemoted, tierOf = () => 0 }: DemoteServiceCoresOptions<T>,
): T[] => {
  if (!hits.some(isDemoted)) return hits;
  const positionsByTier = new Map<number, number[]>();
  hits.forEach((hit, position) => {
    const tier = tierOf(hit);
    positionsByTier.set(tier, [...(positionsByTier.get(tier) ?? []), position]);
  });
  const ordered = [...hits];
  for (const positions of positionsByTier.values()) {
    const members = positions.map((position) => hits[position]);
    const researchFirst = [
      ...members.filter((hit) => !isDemoted(hit)),
      ...members.filter(isDemoted),
    ];
    positions.forEach((position, index) => {
      ordered[position] = researchFirst[index];
    });
  }
  return ordered;
};

export interface OrderServiceCoresOptions<T> {
  queryTokens: readonly string[];
  idOf: (hit: T) => string;
  factsById: ReadonlyMap<string, ServiceCoreFacts>;
  tierOf?: (hit: T) => number;
}

export const orderServiceCoresBelowResearch = <T extends { entityType?: unknown }>(
  pool: T[],
  { queryTokens, idOf, factsById, tierOf }: OrderServiceCoresOptions<T>,
): T[] => {
  const demotedIds = new Set(
    pool
      .slice(0, SERVICE_CORE_DEMOTION_WINDOW)
      .filter(
        (hit) => typeof hit.entityType === 'string' && DEMOTABLE_ENTITY_TYPES.has(hit.entityType),
      )
      .map(idOf)
      .filter((id) => {
        const row = factsById.get(id);
        return (
          row !== undefined &&
          isDemotedServiceCoreReason(serviceCoreDemotionReason(row, queryTokens))
        );
      }),
  );
  if (demotedIds.size === 0) return pool;
  return [
    ...demoteServiceCoresBelowResearch(pool.slice(0, SERVICE_CORE_DEMOTION_WINDOW), {
      isDemoted: (hit) => demotedIds.has(idOf(hit)),
      tierOf,
    }),
    ...pool.slice(SERVICE_CORE_DEMOTION_WINDOW),
  ];
};
