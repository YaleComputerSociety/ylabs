import { describe, expect, it } from 'vitest';

import {
  isIssuedOrcid,
  isValidOrcid,
  normalizeOrcid,
  orcidProfileUrl,
  servableOrcid,
} from '../orcid';

const ISSUED = '9999-9006-9999-9068';
const NEVER_ISSUED = '0000-0000-0000-0132';

describe('isIssuedOrcid', () => {
  it('accepts an iD inside the issued range', () => {
    expect(isIssuedOrcid(ISSUED)).toBe(true);
  });

  it('refuses the never-issued 0000-0000 block even though its check digit computes', () => {
    expect(isValidOrcid(NEVER_ISSUED)).toBe(true);
    expect(isIssuedOrcid(NEVER_ISSUED)).toBe(false);
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

  it('withholds a never-issued iD and a junk value', () => {
    expect(servableOrcid(NEVER_ISSUED)).toBe('');
    expect(servableOrcid('')).toBe('');
    expect(servableOrcid(undefined)).toBe('');
    expect(servableOrcid({ orcid: ISSUED })).toBe('');
  });
});

describe('orcidProfileUrl', () => {
  it('builds the record URL only for a servable iD', () => {
    expect(orcidProfileUrl(ISSUED)).toBe(`https://orcid.org/${ISSUED}`);
    expect(orcidProfileUrl(NEVER_ISSUED)).toBe('');
  });
});

describe('normalizeOrcid', () => {
  it('still accepts a never-issued iD, because the range rule belongs to the serve path', () => {
    expect(normalizeOrcid(NEVER_ISSUED)).toBe(NEVER_ISSUED);
  });
});
