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
import { planFieldLock } from '../utils/researchEntityFieldLocks';

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
  /**
   * The `$set` fragment that locks `websiteUrl` and records why, from
   * `planFieldLock`. One value rather than a bare field list, so the reason cannot
   * be dropped on the way to the write.
   */
  fieldLockUpdate?: Record<string, unknown>;
  changedFields: string[];
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

export const VANITY_REPAIR_LOCKED_BY = 'repair-vanity-host-citations';

export const VANITY_REPAIR_LOCK_NOTE =
  'websiteUrl is re-derived from the profile page the row still cites, so a plain write is undone on the next materialize; revisit once the engine derives the canonical destination itself (#2542, #2612).';

/**
 * Rewrites only the fields that hold the vanity url and leaves every other
 * citation untouched.
 *
 * A `websiteUrl` rewrite also takes `manuallyLockedFields`, because
 * `resolveBackfillWebsiteUrl` clears a person-profile page precisely because the
 * row cites it, so the next materialize would undo the repair. The
 * promotion-regression repair locks for the same reason, and for the same reason
 * this records the lock as an `engine_gap_workaround` rather than as a bare field
 * name: what forces it is a capability the engine lacks, not a standing operator
 * preference for this URL, so it must be re-openable once the engine agrees
 * (#2612). A lock written with no reason reads as `unknown`, which is never
 * revisited, so it would freeze the row's `websiteUrl` for good.
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
      change.fieldLockUpdate = planFieldLock(locked, {
        field: 'websiteUrl',
        reason: 'engine_gap_workaround',
        lockedBy: VANITY_REPAIR_LOCKED_BY,
        note: VANITY_REPAIR_LOCK_NOTE,
      });
      changedFields.push('manuallyLockedFields');
    }
  }
  return change;
}
