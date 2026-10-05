const MEDICINE_SECTION_PROFILE_PATH = /^https?:\/\/medicine\.yale\.edu\/[^/]+\/profile\//i;
const MEDICINE_PROFILE_ROOT = 'https://medicine.yale.edu/profile/';

const withAndWithoutTrailingSlash = (value: string): string[] =>
  value.endsWith('/') ? [value, value.replace(/\/+$/, '')] : [value, `${value}/`];

/**
 * The stored spellings one official profile page can carry, for an exact-match lookup.
 *
 * The School of Medicine serves every faculty profile under `/profile/<slug>/` and also
 * under section prefixes such as `/cancer/profile/<slug>/`, so a center directory that
 * links the section copy names the same person a department roster names under the root
 * path. Matching only the literal string split such listings onto a second researcher.
 */
export function officialProfileUrlLookupVariants(value: unknown): string[] {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!/^https?:\/\//i.test(url)) return [];
  const variants = new Set(withAndWithoutTrailingSlash(url));
  if (MEDICINE_SECTION_PROFILE_PATH.test(url)) {
    const rootProfile = url.replace(MEDICINE_SECTION_PROFILE_PATH, MEDICINE_PROFILE_ROOT);
    for (const variant of withAndWithoutTrailingSlash(rootProfile)) variants.add(variant);
  }
  return [...variants];
}
