import { looksLikeYaleNetid } from './yaleNetid';

const normalizedEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/**
 * Whether a netid is the local part of the email beside it rather than a Yale netid: the
 * key a twin was minted under when a directory email's local part was taken for a netid.
 */
export function isLocalPartNetid(identity: { netid?: unknown; email?: unknown }): boolean {
  const netid = typeof identity.netid === 'string' ? identity.netid : '';
  const email = normalizedEmail(identity.email);
  return (
    Boolean(netid) &&
    netid === (email.split('@')[0] ?? '') &&
    email.includes('@') &&
    !looksLikeYaleNetid(netid)
  );
}
