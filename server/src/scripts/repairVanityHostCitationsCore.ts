/**
 * Decides whether a citation on a vanity redirect host may be repointed at the
 * canonical page it redirects to, and what the row should then hold.
 *
 * A vanity host exists only to redirect: it fails the HTTPS handshake because the
 * certificate it serves covers the destination rather than itself, while plain
 * HTTP answers with a redirect to a live canonical page. #2751 stopped that
 * certificate mismatch from retiring the citation, which means a student can now
 * reach it and gets a browser TLS warning. The correct citation is the destination
 * the host itself names (#2758).
 *
 * Every rule here fails closed, because this rewrites student-facing citations.
 */

export type VanityRepairRefusal =
  | 'not-cert-mismatch'
  | 'no-redirect-destination'
  | 'destination-not-https'
  | 'destination-same-host'
  | 'destination-not-healthy'
  | 'too-many-hops';

export interface VanityRedirectProbe {
  /** Error code the stored https citation produces. */
  citationErrorCode?: string;
  /** Final url after following plain-HTTP redirects, if any. */
  destinationUrl?: string;
  /** Redirect hops taken to reach it. */
  hops?: number;
  /** Verdict for the destination, from `classifySourceLinkHealth`. */
  destinationHealth?: string;
}

/**
 * `http://vanity` -> `https://vanity` -> `https://canonical` is two hops and is the
 * normal shape, because the host upgrades the scheme before redirecting. A cap
 * still matters, but the hop count is not the guard: the guard is that the
 * destination is a different host, is https, and probes decisively healthy. A long
 * chain is refused because it is more likely to end somewhere unrelated, which is
 * the graft channel #2385 records.
 */
export const MAX_VANITY_REDIRECT_HOPS = 4;

export interface VanityRepairDecision {
  repoint: boolean;
  destinationUrl?: string;
  refusal?: VanityRepairRefusal;
}

export function decideVanityRepair(
  citationUrl: string,
  probe: VanityRedirectProbe,
): VanityRepairDecision {
  if (probe.citationErrorCode !== 'ERR_TLS_CERT_ALTNAME_INVALID') {
    return { repoint: false, refusal: 'not-cert-mismatch' };
  }
  const destination = probe.destinationUrl;
  if (!destination) return { repoint: false, refusal: 'no-redirect-destination' };
  if ((probe.hops ?? 0) > MAX_VANITY_REDIRECT_HOPS) {
    return { repoint: false, refusal: 'too-many-hops' };
  }
  if (!/^https:\/\//i.test(destination)) {
    return { repoint: false, refusal: 'destination-not-https' };
  }
  let sameHost = true;
  try {
    sameHost = new URL(citationUrl).hostname === new URL(destination).hostname;
  } catch {
    return { repoint: false, refusal: 'no-redirect-destination' };
  }
  if (sameHost) return { repoint: false, refusal: 'destination-same-host' };
  if (probe.destinationHealth !== 'HEALTHY') {
    return { repoint: false, refusal: 'destination-not-healthy' };
  }
  return { repoint: true, destinationUrl: destination };
}

export interface VanityRepairTargetRow {
  sourceUrls?: unknown;
  websiteUrl?: unknown;
  website?: unknown;
  manuallyLockedFields?: unknown;
}

export interface VanityRepairRowChange {
  sourceUrls?: string[];
  websiteUrl?: string;
  website?: string;
  manuallyLockedFields?: string[];
  changedFields: string[];
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Rewrites only the fields that hold the vanity url and leaves every other
 * citation untouched.
 *
 * A `websiteUrl` rewrite also takes `manuallyLockedFields`, because
 * `resolveBackfillWebsiteUrl` clears a person-profile page precisely because the
 * row cites it, so the next materialize would undo the repair. The
 * promotion-regression repair locks for the same reason.
 */
export function planVanityRepairRow(
  row: VanityRepairTargetRow,
  vanityUrl: string,
  destinationUrl: string,
): VanityRepairRowChange | null {
  const changedFields: string[] = [];
  const change: VanityRepairRowChange = { changedFields };

  const sourceUrls = asStrings(row.sourceUrls);
  if (sourceUrls.includes(vanityUrl)) {
    const rewritten = sourceUrls.map((u) => (u === vanityUrl ? destinationUrl : u));
    change.sourceUrls = [...new Set(rewritten)];
    changedFields.push('sourceUrls');
  }
  if (row.websiteUrl === vanityUrl) {
    change.websiteUrl = destinationUrl;
    changedFields.push('websiteUrl');
  }
  if (row.website === vanityUrl) {
    change.website = destinationUrl;
    changedFields.push('website');
  }
  if (changedFields.length === 0) return null;

  if (change.websiteUrl !== undefined) {
    const locked = asStrings(row.manuallyLockedFields);
    if (!locked.includes('websiteUrl')) {
      change.manuallyLockedFields = [...locked, 'websiteUrl'];
      changedFields.push('manuallyLockedFields');
    }
  }
  return change;
}
