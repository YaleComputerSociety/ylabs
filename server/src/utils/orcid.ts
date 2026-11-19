export function normalizeOrcid(value: unknown): string {
  if (typeof value !== 'string') return '';
  const compact = value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, '')
    .replace(/^orcid:\s*/i, '')
    .replace(/\/+$/, '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
  if (!/^\d{15}[\dX]$/.test(compact)) return '';
  const formatted = `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(
    8,
    12,
  )}-${compact.slice(12)}`;
  return isValidOrcid(formatted) ? formatted : '';
}

export function isValidOrcid(value: string): boolean {
  const compact = value.trim().replace(/[\s-]/g, '').toUpperCase();
  if (!/^\d{15}[\dX]$/.test(compact)) return false;

  let total = 0;
  for (const digit of compact.slice(0, 15)) {
    total = (total + Number(digit)) * 2;
  }
  const result = (12 - (total % 11)) % 11;
  const expected = result === 10 ? 'X' : String(result);
  return compact[15] === expected;
}

/**
 * ORCID assigns iDs only from these blocks (its published "Structure of the ORCID Identifier"),
 * so a checksum alone does not separate a real iD from a constructed one: the corpus holds rows
 * in the never-issued 0000-0000 block whose check digit computes correctly, and a page's run of
 * four years (`2025-2024-2023-2022`) or an ISSN followed by a page range passes the checksum by
 * chance (#5991). Bounds compare the first fifteen digits; the sixteenth is the check digit.
 * Changing these blocks also requires updating `scripts/orcidFixtureShape.mjs`.
 */
const ISSUED_ORCID_BLOCKS: ReadonlyArray<{ first: string; last: string }> = [
  { first: '000000015000000', last: '000000035000000' },
  { first: '000900000000000', last: '000900100000000' },
];

/**
 * Whether a value can be a person's ORCID iD: a valid check digit inside a block ORCID issues
 * from. Every extractor and every place two people are compared by ORCID calls this, so a
 * value no person can hold is absent everywhere rather than a shared identity (#5991).
 */
export function isPlausiblePersonOrcid(value: unknown): boolean {
  const normalized = normalizeOrcid(value);
  if (!normalized) return false;
  const prefix = normalized.replace(/-/g, '').slice(0, 15);
  return ISSUED_ORCID_BLOCKS.some(({ first, last }) => prefix >= first && prefix <= last);
}

export function plausiblePersonOrcid(value: unknown): string {
  return isPlausiblePersonOrcid(value) ? normalizeOrcid(value) : '';
}

export function isIssuedOrcid(value: string): boolean {
  return isValidOrcid(value) && isPlausiblePersonOrcid(value);
}

export function servableOrcid(value: unknown): string {
  return plausiblePersonOrcid(value);
}

export function orcidProfileUrl(value: unknown): string {
  const servable = servableOrcid(value);
  return servable ? `https://orcid.org/${servable}` : '';
}
