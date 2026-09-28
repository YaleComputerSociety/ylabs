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
