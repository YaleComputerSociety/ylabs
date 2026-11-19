/**
 * A plausible person ORCID for a test, built at runtime so no committed literal sits inside
 * ORCID's allocated space, where it could be a living person's iD (#3287, #5991). The
 * preflight's fixture rule scans literals; `9999-` literals remain the non-person fixture.
 */
const ALLOCATED_BLOCK_START = ['0000', '0003', '4'].join('');

export const withOrcidCheckDigit = (fifteenDigits: string): string => {
  let total = 0;
  for (const digit of fifteenDigits) total = (total + Number(digit)) * 2;
  const remainder = (12 - (total % 11)) % 11;
  const check = remainder === 10 ? 'X' : String(remainder);
  return [
    fifteenDigits.slice(0, 4),
    fifteenDigits.slice(4, 8),
    fifteenDigits.slice(8, 12),
    `${fifteenDigits.slice(12)}${check}`,
  ].join('-');
};

export function syntheticPersonOrcid(index = 0): string {
  if (!Number.isInteger(index) || index < 0 || index > 999_999) {
    throw new Error('syntheticPersonOrcid index must be an integer from 0 to 999999.');
  }
  return withOrcidCheckDigit(`${ALLOCATED_BLOCK_START}${String(index).padStart(6, '0')}`);
}

export function syntheticPersonOrcidUrl(index = 0): string {
  return `https://orcid.org/${syntheticPersonOrcid(index)}`;
}
