import { Fellowship } from '../models/fellowship';
import { citizenshipStatesOptionsClause } from '../utils/programCitizenshipOptions';
import {
  narrowedProgramFilter,
  programFacetNotStatedClause,
  type ProgramMongoFilter,
} from '../utils/programFacetFilters';
import { PROGRAM_SEARCH_FIELDS, rankProgramSearch } from './programSearchRelevance';

export const CITIZENSHIP_FIELD = 'citizenshipStatus';

export interface ProgramCitizenshipBucketCounts {
  says: number;
  doesntSay: number;
}

export interface ProgramCitizenshipOptionCounts extends ProgramCitizenshipBucketCounts {
  value: string;
}

export interface ProgramCitizenshipCounts {
  options: ProgramCitizenshipOptionCounts[];
  selected: ProgramCitizenshipBucketCounts | null;
}

type ProgramSort = Record<string, 1 | -1>;

export const withCitizenshipFilter = (
  filter: ProgramMongoFilter,
  values: readonly string[],
): ProgramMongoFilter =>
  values.length === 0
    ? filter
    : narrowedProgramFilter(filter, {
        $or: [
          citizenshipStatesOptionsClause(CITIZENSHIP_FIELD, values),
          programFacetNotStatedClause(CITIZENSHIP_FIELD),
        ],
      });

export const statesCitizenshipFilter = (filter: ProgramMongoFilter, values: readonly string[]) =>
  narrowedProgramFilter(filter, citizenshipStatesOptionsClause(CITIZENSHIP_FIELD, values));

export const doesntSayCitizenshipFilter = (filter: ProgramMongoFilter) =>
  narrowedProgramFilter(filter, programFacetNotStatedClause(CITIZENSHIP_FIELD));

export const programIdsMatching = async (filter: ProgramMongoFilter): Promise<Set<string>> =>
  new Set((await Fellowship.distinct('_id', filter)).map(String));

export const statedCitizenshipFirst = (
  ids: readonly string[],
  doesntSay: ReadonlySet<string>,
): string[] => [
  ...ids.filter((id) => !doesntSay.has(id)),
  ...ids.filter((id) => doesntSay.has(id)),
];

export const bucketCountsOf = (
  ids: readonly string[],
  doesntSay: ReadonlySet<string>,
): ProgramCitizenshipBucketCounts => {
  const doesntSayCount = ids.filter((id) => doesntSay.has(id)).length;
  return { says: ids.length - doesntSayCount, doesntSay: doesntSayCount };
};

const citizenshipOptionValues = async (
  filterWithoutCitizenship: ProgramMongoFilter,
  offeredScope: ProgramMongoFilter,
  selected: readonly string[],
): Promise<string[]> => {
  const [offered, inScope] = await Promise.all([
    Fellowship.distinct(CITIZENSHIP_FIELD, offeredScope),
    Fellowship.distinct(CITIZENSHIP_FIELD, filterWithoutCitizenship),
  ]);
  return [...new Set([...offered, ...inScope, ...selected])]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .sort();
};

// Each option is counted as if applied alone beside every other filter and the query, the
// way `/research` counts a facet (#5101), so `says + doesntSay` is exactly the total that
// applying the option returns. The query arm re-ranks each option's own pool because the
// ranking's close-match fallback depends on the pool.
export const programCitizenshipOptionCounts = async (params: {
  filterWithoutCitizenship: ProgramMongoFilter;
  offeredScope: ProgramMongoFilter;
  selected: readonly string[];
  query: string;
  sort: ProgramSort;
}): Promise<ProgramCitizenshipOptionCounts[]> => {
  const { filterWithoutCitizenship, offeredScope, selected, query, sort } = params;
  const values = await citizenshipOptionValues(filterWithoutCitizenship, offeredScope, selected);

  if (!query) {
    const doesntSay = await Fellowship.countDocuments(
      doesntSayCitizenshipFilter(filterWithoutCitizenship),
    );
    return Promise.all(
      values.map(async (value) => ({
        value,
        says: await Fellowship.countDocuments(
          statesCitizenshipFilter(filterWithoutCitizenship, [value]),
        ),
        doesntSay,
      })),
    );
  }

  const [pool, doesntSayIds] = await Promise.all([
    Fellowship.find(filterWithoutCitizenship, {
      _id: 1,
      ...Object.fromEntries(PROGRAM_SEARCH_FIELDS.map((field) => [field, 1])),
    })
      .sort(sort)
      .lean() as Promise<Array<Record<string, unknown>>>,
    programIdsMatching(doesntSayCitizenshipFilter(filterWithoutCitizenship)),
  ]);
  return Promise.all(
    values.map(async (value) => {
      const saysIds = await programIdsMatching(
        statesCitizenshipFilter(filterWithoutCitizenship, [value]),
      );
      const optionPool = pool.filter((program) => {
        const id = String(program._id);
        return saysIds.has(id) || doesntSayIds.has(id);
      });
      const rankedIds = rankProgramSearch(query, optionPool).programs.map((program) =>
        String(program._id),
      );
      return { value, ...bucketCountsOf(rankedIds, doesntSayIds) };
    }),
  );
};
