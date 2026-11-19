import { describe, expect, it } from 'vitest';

import {
  excludedHostRedirectError,
  isExcludedHostRedirectError,
  isExcludedHostname,
  isOnExcludedHost,
  normalizeExcludedHost,
} from '../excludedHosts';

describe('excluded hosts', () => {
  it('normalizes case, www. and a trailing dot', () => {
    expect(normalizeExcludedHost(' WWW.Economics.Example.edu. ')).toBe('economics.example.edu');
  });

  it('matches the host and its subdomains but not a host that merely ends in its name', () => {
    const hosts = ['economics.example.edu'];
    expect(isExcludedHostname('economics.example.edu.', hosts)).toBe(true);
    expect(isExcludedHostname('lab.economics.example.edu', hosts)).toBe(true);
    expect(isExcludedHostname('noteconomics.example.edu', hosts)).toBe(false);
    expect(isOnExcludedHost('https://www.economics.example.edu./people', hosts)).toBe(true);
    expect(isOnExcludedHost('not a url', hosts)).toBe(false);
  });

  it('recognises the redirect hook error through the cause chain axios wraps it in', () => {
    const wrapped = Object.assign(new Error('x'), {
      code: 'ERR_FR_REDIRECTION_FAILURE',
      cause: Object.assign(new Error('y'), {
        code: 'ERR_FR_REDIRECTION_FAILURE',
        cause: excludedHostRedirectError(),
      }),
    });
    expect(isExcludedHostRedirectError(wrapped)).toBe(true);
    expect(isExcludedHostRedirectError(Object.assign(new Error('z'), { code: 'ECONNRESET' }))).toBe(
      false,
    );
  });
});
