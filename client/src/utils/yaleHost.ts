/**
 * Mirrored by server/src/utils/yaleHost.ts; changing the rule here requires
 * updating that copy. A bare `endsWith('yale.edu')` also accepts a host such
 * as `notyale.edu` (#5527).
 */
export const hostnameIsWithin = (hostname: string, domain: string): boolean => {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
};

export const isYaleHostname = (hostname: string): boolean => hostnameIsWithin(hostname, 'yale.edu');
