// Region is the owner's 2026-11-10 exception to #5235 (#5533): most programs state no
// region, so keeping not-stated programs made every region option return almost the whole
// corpus. Changing this set also requires updating the client's region filter note
// (PROGRAM_REGION_FILTER_NOTE).
export const PROGRAM_STATED_ONLY_FACET_FIELDS: ReadonlySet<string> = new Set(['globalRegions']);

export const programFacetValueNotStated = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

export type ProgramMongoFilter = Record<string, any>;

export const programFacetNotStatedClause = (field: string) => ({ [field]: { $in: [null, []] } });

export const programFacetStatesValueClause = (field: string, values: readonly string[]) => ({
  [field]: { $in: values },
});

// A program that states no value for a facet is unknown rather than excluded, so a facet
// filter keeps it and the page says the official page decides (#5130, #5235), except for
// the stated-only facets in PROGRAM_STATED_ONLY_FACET_FIELDS (#5533).
export const programFacetFilterClause = (field: string, values: readonly string[]) =>
  PROGRAM_STATED_ONLY_FACET_FIELDS.has(field)
    ? programFacetStatesValueClause(field, values)
    : {
        $or: [programFacetStatesValueClause(field, values), programFacetNotStatedClause(field)],
      };

export const narrowedProgramFilter = (
  filter: ProgramMongoFilter,
  clause: Record<string, unknown>,
): ProgramMongoFilter => ({ ...filter, $and: [...(filter.$and ?? []), clause] });
