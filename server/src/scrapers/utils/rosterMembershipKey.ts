import { canonicalOfficialProfilePath } from '../../services/leadProfileIdentity';

/**
 * The membership key a roster edge is stamped with when its source states no key of
 * its own. The materializer writes it to `rosterProvenance.membershipKey`, and a
 * roster lane that retires edges it no longer lists compares against the same string,
 * so both must derive it here: a lane that spelled it differently would read every
 * edge it owns as absent (#3781).
 */
export function officialProfileIdentityKey(profileUrl: string): string {
  const url = profileUrl.replace(/\s+/g, ' ').trim();
  return url ? `official-profile:${url.toLowerCase()}` : '';
}

export function rosterMembershipKey(identityKey: string, role: string): string {
  return identityKey && role ? `${identityKey}|${role}` : '';
}

const OFFICIAL_PROFILE_IDENTITY_PREFIX = 'official-profile:';

/**
 * The form two membership keys are compared in. A key keeps the profile URL a read listed,
 * so a person a center site moved between two paths of one profile (a MacMillan program skin)
 * reads as absent unless both sides collapse that path the way lead identity does (#5892).
 */
export function comparableRosterMembershipKey(membershipKey: string): string {
  if (!membershipKey.startsWith(OFFICIAL_PROFILE_IDENTITY_PREFIX)) return membershipKey;
  const roleSeparator = membershipKey.lastIndexOf('|');
  const identity = roleSeparator > 0 ? membershipKey.slice(0, roleSeparator) : membershipKey;
  const role = roleSeparator > 0 ? membershipKey.slice(roleSeparator) : '';
  let url: URL;
  try {
    url = new URL(identity.slice(OFFICIAL_PROFILE_IDENTITY_PREFIX.length));
  } catch {
    return membershipKey;
  }
  const host = url.hostname.replace(/^www\./, '');
  const path = canonicalOfficialProfilePath(host, url.pathname.replace(/\/+$/, ''));
  return `${OFFICIAL_PROFILE_IDENTITY_PREFIX}${host}${path}${url.search}${role}`;
}
