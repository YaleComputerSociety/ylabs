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
 * ORCID issues iDs from 0000-0001-5000-0007 upward, so a checksum alone does not separate a
 * real iD from a constructed one: the corpus holds rows in the never-issued 0000-0000 block
 * whose check digit computes correctly. Linking one of those would send a student to a page
 * that cannot exist, so the serve path needs the range as well as the checksum.
 */
const FIRST_ISSUED_ORCID_PREFIX = '000000015000000';

export function isIssuedOrcid(value: string): boolean {
  if (!isValidOrcid(value)) return false;
  const compact = value.trim().replace(/[\s-]/g, '').toUpperCase();
  return compact.slice(0, 15) >= FIRST_ISSUED_ORCID_PREFIX;
}

export function servableOrcid(value: unknown): string {
  const normalized = normalizeOrcid(value);
  return normalized && isIssuedOrcid(normalized) ? normalized : '';
}

export function orcidProfileUrl(value: unknown): string {
  const servable = servableOrcid(value);
  return servable ? `https://orcid.org/${servable}` : '';
}
