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
