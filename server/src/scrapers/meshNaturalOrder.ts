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

const invertedHeadingsByLowercaseNatural = (data: MeshNaturalOrderData): Map<string, string[]> => {
  const index = new Map<string, string[]>();
  for (const [heading, entry] of Object.entries(data.headings)) {
    const key = entry.natural.trim().toLowerCase();
    index.set(key, [...(index.get(key) ?? []), heading]);
  }
  return index;
};

const COMMITTED_DATA = meshNaturalOrderHeadings as MeshNaturalOrderData;
const COMMITTED_INDEX = indexByLowercaseHeading(COMMITTED_DATA);
const COMMITTED_INVERSE = invertedHeadingsByLowercaseNatural(COMMITTED_DATA);
let activeIndex = COMMITTED_INDEX;
let activeInverse = COMMITTED_INVERSE;

export function naturalOrderMeshHeading(term: string): string {
  return activeIndex.get(term.trim().toLowerCase()) ?? term;
}

/**
 * Every spelling a stored topic can carry for this heading while the corpus holds both orders
 * (#6379): the value itself, its natural-order entry term, and the inverted headings that read as
 * that entry term. A value outside the map is returned alone.
 */
export function meshHeadingSpellings(term: string): string[] {
  const natural = naturalOrderMeshHeading(term);
  const inverted = activeInverse.get(natural.trim().toLowerCase()) ?? [];
  return [...new Set([term, natural, ...inverted])];
}

export function setMeshNaturalOrderHeadingsForTesting(
  headings: MeshNaturalOrderData['headings'] | null,
): void {
  activeIndex = headings ? indexByLowercaseHeading({ headings }) : COMMITTED_INDEX;
  activeInverse = headings ? invertedHeadingsByLowercaseNatural({ headings }) : COMMITTED_INVERSE;
}
