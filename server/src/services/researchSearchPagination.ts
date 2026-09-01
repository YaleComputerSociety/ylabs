/**
 * Reachable pagination depth for ResearchEntity search, bounded in RECORDS
 * rather than by page number, because a records bound and a page bound
 * interact: a page size cap of 100 with a page cap of 1000 made 100,000 records
 * addressable against a served corpus of roughly 2,700, so a client could walk
 * an offset two orders of magnitude past the data.
 *
 * A page cap alone cannot fix that without breaking browsing, because the client
 * default page size is 24 and the research page scrolls infinitely: a "nothing
 * pages past 10" rule would wall a student off after 240 records. Capping records
 * keeps every real row reachable at any page size while removing the dead offset
 * space, so the limit is expressed in the unit that actually bounds the data.
 *
 * Set above the live served corpus with headroom for growth rather than tuned to
 * today's exact count, so ordinary corpus expansion does not silently truncate
 * browsing. A request past the bound is answered with an empty page rather than
 * silently re-serving the last reachable one, so a paging client terminates
 * instead of appending the same rows forever.
 *
 * Changing this bound also requires updating `skills/search-data/SKILL.md`,
 * which documents the reachable-depth ceiling for browse and infinite scroll.
 */
export const RESEARCH_SEARCH_MAX_REACHABLE_RECORDS = 5000;

export const maxReachableResearchSearchPage = (pageSize: number): number => {
  const safePageSize = Math.max(1, Math.floor(pageSize) || 1);
  return Math.max(1, Math.floor(RESEARCH_SEARCH_MAX_REACHABLE_RECORDS / safePageSize));
};
