export function normalizeOrcid(value: unknown): string {
  if (typeof value !== 'string') return '';
  const compact = value
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .replace(/^orcid:\s*/i, '')
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
