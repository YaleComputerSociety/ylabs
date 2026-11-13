import { describe, expect, it } from 'vitest';
import { DEAD_LINK_ERROR_CODES } from '../sourceLinkHealth';

describe('DEAD_LINK_ERROR_CODES', () => {
  it('retires a link only on a non-resolving host or a refused connection', () => {
    expect([...DEAD_LINK_ERROR_CODES].sort()).toEqual(
      ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND'].sort(),
    );
  });

  it('never retires a link on a certificate name mismatch', () => {
    expect(DEAD_LINK_ERROR_CODES.has('ERR_TLS_CERT_ALTNAME_INVALID')).toBe(false);
  });
});
