import { describe, expect, it } from 'vitest';
import {
  researcherEmail,
  researcherHoldsDirectoryIdentity,
  researcherNetid,
} from '../researcherIdentity';

describe('researcherNetid and researcherEmail', () => {
  it('read the identity the researcher holds', () => {
    expect(researcherNetid({ identifiers: { netid: 'ab12' } })).toBe('ab12');
    expect(researcherEmail({ identifiers: { email: 'held@example.test' } })).toBe(
      'held@example.test',
    );
  });

  it('read nothing when the researcher holds no identity', () => {
    expect(researcherNetid({ identifiers: { netid: '  ' } })).toBe('');
    expect(researcherNetid({})).toBe('');
    expect(researcherEmail({ identifiers: null })).toBe('');
  });
});

describe('researcherHoldsDirectoryIdentity', () => {
  it('holds for a researcher-held email', () => {
    expect(researcherHoldsDirectoryIdentity({ identifiers: { email: 'held@example.test' } })).toBe(
      true,
    );
  });

  it('does not hold for a netid alone or a bare name', () => {
    expect(researcherHoldsDirectoryIdentity({ identifiers: { netid: 'ab12' } })).toBe(false);
    expect(researcherHoldsDirectoryIdentity({ identifiers: { email: ' ' } })).toBe(false);
    expect(researcherHoldsDirectoryIdentity({})).toBe(false);
  });
});
