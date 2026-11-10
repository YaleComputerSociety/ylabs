/**
 * Mirrored by client/src/utils/yaleHost.ts; changing the rule here requires
 * updating that copy. A bare `endsWith('yale.edu')` also accepts a host such
 * as `notyale.edu` (#5527).
 */
export const isYaleHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return host === 'yale.edu' || host.endsWith('.yale.edu');
};
