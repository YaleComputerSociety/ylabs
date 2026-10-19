const DIGIT_NETID = /^[a-z]{1,8}\d{1,6}$/;
const NAME_SUFFIX_NETID = /^([a-z]{2,4})\d{1,6}$/;
const PROFILE_SLUG = /\/(?:people|profile)\/([a-z0-9'-]+)\/?$/;

const lowerText = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/**
 * The netid a name-shaped identifier ends in, read only when its letters are the person's
 * initials: Yale appends the netid to a namesake's alias or page slug, and a netid opens
 * with the given-name initial and carries the surname initial. A counter fused onto a
 * surname (`<first>-<last>2`) or a final name part that happens to end in digits fails that
 * test, so it is never read as a netid.
 */
function initialledNetidSuffix(nameParts: string[]): string | undefined {
  if (nameParts.length < 3) return undefined;
  const candidate = nameParts[nameParts.length - 1];
  const letters = candidate.match(NAME_SUFFIX_NETID)?.[1];
  if (!letters) return undefined;
  const names = nameParts.slice(0, -1).map((part) => part.replace(/'/g, ''));
  if (names.some((part) => !/^[a-z]+$/.test(part))) return undefined;
  const givenInitial = names[0][0];
  const surnameInitial = names[names.length - 1][0];
  return letters[0] === givenInitial && letters.includes(surnameInitial) ? candidate : undefined;
}

function netidInAlias(value: unknown, { bareNetid }: { bareNetid: boolean }): string | undefined {
  const local = lowerText(value)
    .replace(/^netid:/, '')
    .replace(/@(?:[a-z0-9-]+\.)*yale\.edu$/, '');
  if (bareNetid && DIGIT_NETID.test(local)) return local;
  return initialledNetidSuffix(local.split('.'));
}

function netidInProfileUrl(value: unknown): string | undefined {
  const raw = lowerText(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.hostname.endsWith('yale.edu')) return undefined;
    const slug = url.pathname.match(PROFILE_SLUG)?.[1];
    return slug ? initialledNetidSuffix(slug.split('-')) : undefined;
  } catch {
    return undefined;
  }
}

function profileUrlValues(value: unknown): unknown[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>);
  return [];
}

/**
 * The netids a person's evidence spells out on its own: a bare digit-bearing netid key or
 * `netid` value, a Yale alias that ends in one (`<first>.<last>.<netid>`), or a person page
 * whose slug carries one as a namesake suffix (`/profile/<first>-<last>-<netid>/`).
 */
export function netidsEmbeddedInUserEvidence(
  entityKey: unknown,
  observations: ReadonlyArray<{ field?: unknown; value?: unknown }>,
): Set<string> {
  const found = new Set<string>();
  const add = (netid: string | undefined) => {
    if (netid) found.add(netid);
  };
  add(netidInAlias(entityKey, { bareNetid: true }));
  for (const observation of observations) {
    if (observation.field === 'netid' || observation.field === 'email') {
      add(netidInAlias(observation.value, { bareNetid: observation.field === 'netid' }));
    } else if (observation.field === 'profileUrl' || observation.field === 'profileUrls') {
      for (const url of profileUrlValues(observation.value)) add(netidInProfileUrl(url));
    }
  }
  return found;
}

/**
 * Whether a name-matched candidate holds a netid that none of the netids the evidence spells
 * out is. A candidate stamped with an alias rather than a bare netid is read through the netid
 * the alias ends in. A netid belongs to one person, so evidence that names a different one is about a
 * namesake, however well the names agree.
 */
export function embeddedNetidContradictsCandidate(
  embeddedNetids: ReadonlySet<string>,
  candidateNetid: unknown,
): boolean {
  const held = lowerText(candidateNetid);
  if (!held || embeddedNetids.size === 0) return false;
  const heldNetids = [held, netidInAlias(held, { bareNetid: false })];
  return !heldNetids.some((netid) => netid && embeddedNetids.has(netid));
}
