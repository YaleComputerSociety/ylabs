import { describe, expect, it } from 'vitest';

import {
  isIssuedOrcid,
  isPlausiblePersonOrcid,
  isValidOrcid,
  normalizeOrcid,
  orcidProfileUrl,
  plausiblePersonOrcid,
  servableOrcid,
} from '../orcid';
import { syntheticPersonOrcid, withOrcidCheckDigit } from '../../test/syntheticOrcid';

const ISSUED = syntheticPersonOrcid(1);
const NEVER_ISSUED = '0000-0000-0000-0132';
const NON_PERSON_FIXTURE = '9999-9006-9999-9068';
const YEAR_RUN = '2025-2024-2023-2022';
const ISSN_AND_PAGES = withOrcidCheckDigit('104973150123456');
const FIRST_IN_OLD_BLOCK = withOrcidCheckDigit('000000015000000');
const LAST_IN_OLD_BLOCK = withOrcidCheckDigit('000000035000000');
const JUST_ABOVE_OLD_BLOCK = withOrcidCheckDigit('000000035000001');
const INSIDE_NEW_BLOCK = withOrcidCheckDigit('000900050000000');
const JUST_ABOVE_NEW_BLOCK = withOrcidCheckDigit('000900100000001');

describe('isPlausiblePersonOrcid (#5991)', () => {
  it('accepts an iD inside either block ORCID issues from, at both edges of the old block', () => {
    for (const value of [ISSUED, FIRST_IN_OLD_BLOCK, LAST_IN_OLD_BLOCK, INSIDE_NEW_BLOCK]) {
      expect(isPlausiblePersonOrcid(value)).toBe(true);
    }
  });

  it('refuses a year run whose check digit happens to compute', () => {
    expect(isValidOrcid(YEAR_RUN)).toBe(true);
    expect(isPlausiblePersonOrcid(YEAR_RUN)).toBe(false);
  });

  it('refuses checksum-valid values above each block, including an ISSN-shaped run', () => {
    for (const value of [JUST_ABOVE_OLD_BLOCK, JUST_ABOVE_NEW_BLOCK, ISSN_AND_PAGES]) {
      expect(isValidOrcid(value)).toBe(true);
      expect(isPlausiblePersonOrcid(value)).toBe(false);
    }
  });

  it('refuses the 9999 non-person fixture block, so a literal fixture is never a person', () => {
    expect(isValidOrcid(NON_PERSON_FIXTURE)).toBe(true);
    expect(isPlausiblePersonOrcid(NON_PERSON_FIXTURE)).toBe(false);
  });

  it('reads a URL form and returns the normalized iD', () => {
    expect(plausiblePersonOrcid(`https://orcid.org/${ISSUED}`)).toBe(ISSUED);
    expect(plausiblePersonOrcid(YEAR_RUN)).toBe('');
  });
});

describe('isIssuedOrcid', () => {
  it('accepts an iD inside the issued range', () => {
    expect(isIssuedOrcid(ISSUED)).toBe(true);
  });

  it('refuses the never-issued 0000-0000 block even though its check digit computes', () => {
    expect(isValidOrcid(NEVER_ISSUED)).toBe(true);
    expect(isIssuedOrcid(NEVER_ISSUED)).toBe(false);
  });

  it('refuses a value above the issued range', () => {
    expect(isIssuedOrcid(JUST_ABOVE_OLD_BLOCK)).toBe(false);
    expect(isIssuedOrcid(YEAR_RUN)).toBe(false);
  });

  it('refuses a malformed value', () => {
    expect(isIssuedOrcid('not-an-orcid')).toBe(false);
    expect(isIssuedOrcid('0000-0001-9999-9991')).toBe(false);
  });
});

describe('servableOrcid', () => {
  it('normalizes a URL form and a bare form to the same iD', () => {
    expect(servableOrcid(`https://orcid.org/${ISSUED}/`)).toBe(ISSUED);
    expect(servableOrcid(ISSUED)).toBe(ISSUED);
    expect(servableOrcid(ISSUED.replace(/-/g, ''))).toBe(ISSUED);
  });

  it('withholds a never-issued iD, an out-of-range iD and a junk value', () => {
    expect(servableOrcid(NEVER_ISSUED)).toBe('');
    expect(servableOrcid(ISSN_AND_PAGES)).toBe('');
    expect(servableOrcid(NON_PERSON_FIXTURE)).toBe('');
    expect(servableOrcid('')).toBe('');
    expect(servableOrcid(undefined)).toBe('');
    expect(servableOrcid({ orcid: ISSUED })).toBe('');
  });
});

describe('orcidProfileUrl', () => {
  it('builds the record URL only for a servable iD', () => {
    expect(orcidProfileUrl(ISSUED)).toBe(`https://orcid.org/${ISSUED}`);
    expect(orcidProfileUrl(NEVER_ISSUED)).toBe('');
    expect(orcidProfileUrl(ISSN_AND_PAGES)).toBe('');
  });
});

describe('normalizeOrcid', () => {
  it('still accepts a never-issued iD, because the range rule belongs to isPlausiblePersonOrcid', () => {
    expect(normalizeOrcid(NEVER_ISSUED)).toBe(NEVER_ISSUED);
    expect(normalizeOrcid(YEAR_RUN)).toBe(YEAR_RUN);
  });
});
