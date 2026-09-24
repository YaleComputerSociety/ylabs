/**
 * The preflight's fixture rule is a copy of the serve path's ORCID arithmetic, because
 * `security-preflight.test.mjs` is plain `.mjs` and cannot import TypeScript. A copy is
 * only safe while it cannot drift into a second authority, so this pins the two together.
 */
import { describe, expect, it } from 'vitest';
import {
  orcidChecksumIsValid,
  orcidIsInAllocatedSpace,
  orcidIsUnsafeForFixtures,
  SYNTHETIC_ORCID_EXAMPLE,
} from '../../../../scripts/orcidFixtureShape.mjs';
import { isIssuedOrcid, isValidOrcid } from '../orcid';

/**
 * Built from arithmetic rather than written as a literal, because a checksum-valid iD
 * inside ORCID's allocated space could belong to a living person and the rule under test
 * forbids exactly that in a fixture. Assembling it keeps the test honest about its own
 * subject without committing a value anyone could hold.
 */
const withCheckDigit = (fifteenDigits: string): string => {
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

const insideAllocatedSpace = withCheckDigit('000000025000123');
const atTheAllocationFloor = withCheckDigit('000000015000000');

const table = [
  '9999-9000-9999-9005',
  '9999-9999-9999-9994',
  '1111-1111-1111-1115',
  insideAllocatedSpace,
  atTheAllocationFloor,
  '0000-0000-0000-0000',
  '0000-0002-0000-0000',
  'not-an-orcid',
  '',
];

describe('the fixture rule and the serve path agree on the checksum', () => {
  it.each(table)('matches isValidOrcid on %s', (value) => {
    expect(orcidChecksumIsValid(value)).toBe(isValidOrcid(value));
  });
});

describe('what the fixture rule refuses', () => {
  /**
   * The risk is a fixture colliding with a living person, so the boundary is ORCID's
   * allocated space rather than the checksum: every one of the four iDs the old denylist
   * named was checksum-valid and inside it, which is why the shape rule supersedes them.
   */
  it('refuses a checksum-valid iD inside the allocated space', () => {
    for (const value of [insideAllocatedSpace, atTheAllocationFloor]) {
      expect(orcidChecksumIsValid(value)).toBe(true);
      expect(orcidIsInAllocatedSpace(value)).toBe(true);
      expect(orcidIsUnsafeForFixtures(value)).toBe(true);
    }
  });

  /**
   * The four iDs the old denylist named were all of this shape, which is why removing
   * them loses no coverage: each was checksum-valid and inside the allocated space, so
   * the rule above refuses them and every value like them without naming any.
   */
  it('would have refused each iD the retired denylist named, by shape alone', () => {
    for (const prefix of [
      '000000020625163',
      '000000025529324',
      '000000021825009',
      '000000015109370',
    ]) {
      expect(orcidIsUnsafeForFixtures(withCheckDigit(prefix))).toBe(true);
    }
  });

  it('accepts a synthetic iD outside the allocated space', () => {
    expect(orcidIsUnsafeForFixtures(SYNTHETIC_ORCID_EXAMPLE)).toBe(false);
    expect(orcidChecksumIsValid(SYNTHETIC_ORCID_EXAMPLE)).toBe(true);
    expect(orcidIsInAllocatedSpace(SYNTHETIC_ORCID_EXAMPLE)).toBe(false);
  });

  /**
   * The example has to stay usable for a test that needs a servable iD, or authors will
   * reach for a real-looking one instead.
   */
  it('keeps the example servable by the serve path', () => {
    expect(isValidOrcid(SYNTHETIC_ORCID_EXAMPLE)).toBe(true);
    expect(isIssuedOrcid(SYNTHETIC_ORCID_EXAMPLE)).toBe(true);
  });

  it('accepts a checksum-invalid value, which cannot be anyone iD', () => {
    expect(orcidIsUnsafeForFixtures('0000-0000-0000-0000')).toBe(false);
  });
});
