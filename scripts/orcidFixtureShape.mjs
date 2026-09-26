/**
 * Whether a fixture may carry an ORCID iD (#3287 review).
 *
 * The rule this replaced was a denylist of four values, which caught the iDs somebody
 * happened to notice rather than the shape. A fixture value that is checksum-valid and
 * inside the range ORCID actually assigns from is plausibly a real person's identifier
 * sitting in a public repository, whether or not anyone recognised it.
 *
 * The boundary is ORCID's own allocated space, 0000-0001-5000-0007 to 0000-0003-5000-0001.
 * A checksum-valid iD inside it could belong to someone. Outside it, no iD has ever been
 * assigned, so a fixture there cannot collide with a person however real it looks.
 *
 * That gives authors a pattern to copy rather than a judgement to make: use the
 * `9999-…` block, which is outside the allocated space and still passes the checksum, so
 * it exercises a serve path that requires a valid iD. `SYNTHETIC_ORCID_EXAMPLE` is one.
 *
 * Duplicated from `server/src/utils/orcid.ts` because the preflight is plain `.mjs` and
 * cannot import TypeScript. `orcidFixtureShape.test.ts` asserts the two agree, so the
 * copy cannot drift into a second authority.
 */
export const ORCID_PATTERN = /\b\d{4}-\d{4}-\d{4}-[\dX]{4}\b/g;

export const SYNTHETIC_ORCID_EXAMPLE = '9999-9000-9999-9005';

const ALLOCATED_LOW = '000000015000000';
const ALLOCATED_HIGH = '000000035000000';

export function orcidChecksumIsValid(value) {
  const compact = String(value).trim().replace(/[\s-]/g, '').toUpperCase();
  if (!/^\d{15}[\dX]$/.test(compact)) return false;
  let total = 0;
  for (const digit of compact.slice(0, 15)) total = (total + Number(digit)) * 2;
  const result = (12 - (total % 11)) % 11;
  return compact[15] === (result === 10 ? 'X' : String(result));
}

/** Inside the space ORCID assigns from, so it could belong to a real person. */
export function orcidIsInAllocatedSpace(value) {
  const prefix = String(value).trim().replace(/[\s-]/g, '').slice(0, 15);
  return prefix >= ALLOCATED_LOW && prefix <= ALLOCATED_HIGH;
}

export function orcidIsUnsafeForFixtures(value) {
  return orcidChecksumIsValid(value) && orcidIsInAllocatedSpace(value);
}
