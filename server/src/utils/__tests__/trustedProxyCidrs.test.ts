import { describe, expect, it } from 'vitest';
import { parseTrustedProxyCidrs } from '../trustedProxyCidrs';

describe('parseTrustedProxyCidrs', () => {
  it.each([
    '0.0.0.0/0',
    '::/0',
    '10.0.0.0/4',
    '128.0.0.0/1',
    '2000::/3',
    '2001:db8::/28',
    '::ffff:0:0/96',
    '::ffff:10.0.0.0/100',
    '::/80',
    '::/64',
    '10.0.0.0/8,0.0.0.0/0',
  ])('refuses the over-broad range %s by name', (raw) => {
    const offending = raw.split(',').pop() as string;
    expect(() => parseTrustedProxyCidrs(raw)).toThrow(/over-broad range/);
    expect(() => parseTrustedProxyCidrs(raw)).toThrow(offending);
  });

  it.each([
    '10.0.0.0/8',
    '100.64.0.0/10',
    '172.16.0.0/12',
    '127.0.0.1/32',
    '203.0.113.7',
    '2001:db8::1',
    '2a06:98c0::/29',
    '2606:4700::/32',
    '2001:db8:abcd::/48',
    '::ffff:10.0.0.0/104',
    '::1/128',
  ])('accepts the bounded range %s', (raw) => {
    expect(parseTrustedProxyCidrs(raw).count).toBe(1);
  });

  it.each(['10.0.0.0/99', '10.0.0.0/8/garbage', '10.0.0.0/', '10.0.0.0/1e1', 'proxy.internal'])(
    'still refuses the malformed entry %s as invalid',
    (raw) => {
      expect(() => parseTrustedProxyCidrs(raw)).toThrow(/invalid address or CIDR/);
    },
  );

  it('treats an unset or blank value as an empty list', () => {
    expect(parseTrustedProxyCidrs(undefined).count).toBe(0);
    expect(parseTrustedProxyCidrs('  , ').count).toBe(0);
  });

  it('trusts only peers inside the configured ranges, including IPv4-mapped peers', () => {
    const trusted = parseTrustedProxyCidrs('10.0.0.0/8,2001:db8:abcd::/48');
    expect(trusted.isTrusted('10.20.30.40')).toBe(true);
    expect(trusted.isTrusted('::ffff:10.20.30.40')).toBe(true);
    expect(trusted.isTrusted('2001:db8:abcd::9')).toBe(true);
    expect(trusted.isTrusted('11.0.0.1')).toBe(false);
    expect(trusted.isTrusted('::ffff:11.0.0.1')).toBe(false);
    expect(trusted.isTrusted('2001:db8:abce::9')).toBe(false);
    expect(trusted.isTrusted('not-an-address')).toBe(false);
  });
});
