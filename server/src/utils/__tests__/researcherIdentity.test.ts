import { describe, expect, it } from 'vitest';
import {
  researcherEmail,
  researcherHoldsDirectoryIdentity,
  researcherNetid,
} from '../researcherIdentity';

describe('researcherNetid and researcherEmail', () => {
  it('read the identity the researcher holds before the linked account', () => {
    const researcher = { identifiers: { netid: 'ab12', email: 'held@example.test' } };
    const account = { netid: 'zz99', email: 'account@example.test' };
    expect(researcherNetid(researcher, account)).toBe('ab12');
    expect(researcherEmail(researcher, account)).toBe('held@example.test');
  });

  it('fall back to the linked account only when the researcher holds none', () => {
    const account = { netid: 'zz99', email: 'account@example.test' };
    expect(researcherNetid({ identifiers: { netid: '  ' } }, account)).toBe('zz99');
    expect(researcherEmail({}, account)).toBe('account@example.test');
  });

  it('read a researcher with no account at all', () => {
    expect(researcherNetid({ identifiers: { netid: 'ab12' } })).toBe('ab12');
    expect(researcherEmail({ identifiers: { email: 'held@example.test' } })).toBe(
      'held@example.test',
    );
    expect(researcherNetid({})).toBe('');
    expect(researcherEmail({ identifiers: null })).toBe('');
  });
});

describe('researcherHoldsDirectoryIdentity', () => {
  it('holds for a linked account or a researcher-held email', () => {
    expect(researcherHoldsDirectoryIdentity({ accountId: 'account-1' })).toBe(true);
    expect(researcherHoldsDirectoryIdentity({ identifiers: { email: 'held@example.test' } })).toBe(
      true,
    );
  });

  it('does not hold for a netid alone or a bare name', () => {
    expect(researcherHoldsDirectoryIdentity({ identifiers: { netid: 'ab12' } })).toBe(false);
    expect(researcherHoldsDirectoryIdentity({ accountId: null, identifiers: { email: ' ' } })).toBe(
      false,
    );
    expect(researcherHoldsDirectoryIdentity({})).toBe(false);
  });
});
