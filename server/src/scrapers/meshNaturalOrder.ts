/**
 * A MeSH inverted heading ("Carcinoma, Hepatocellular") read as MeSH's own natural-order entry
 * term ("Hepatocellular Carcinoma") (#6358). The map is keyed on MeSH's vocabulary and holds only
 * headings whose NLM descriptor lists an entry term that is exactly a reordering of the heading's
 * comma-separated parts, so nothing outside it, such as "diversity, equity, and inclusion", is
 * ever reordered. `server/src/scripts/generateMeshNaturalOrderMap.ts` builds the map and records
 * the NLM attribution and terms of use.
 *
 * The natural term keeps MeSH's casing, which is the Title Case every stored MeSH heading and
 * catalog research-area name already uses.
 */
import meshNaturalOrderHeadings from './data/meshNaturalOrderHeadings.json';

interface MeshNaturalOrderData {
  headings: Record<string, { natural: string; descriptorUI: string }>;
}

const indexByLowercaseHeading = (data: MeshNaturalOrderData): Map<string, string> =>
  new Map(
    Object.entries(data.headings).map(([heading, entry]) => [
      heading.trim().toLowerCase(),
      entry.natural,
    ]),
  );

const COMMITTED_INDEX = indexByLowercaseHeading(meshNaturalOrderHeadings as MeshNaturalOrderData);
let activeIndex = COMMITTED_INDEX;

export function naturalOrderMeshHeading(term: string): string {
  return activeIndex.get(term.trim().toLowerCase()) ?? term;
}

export function setMeshNaturalOrderHeadingsForTesting(
  headings: MeshNaturalOrderData['headings'] | null,
): void {
  activeIndex = headings ? indexByLowercaseHeading({ headings }) : COMMITTED_INDEX;
}
