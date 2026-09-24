/**
 * Decides when a probe licenses recording that a value is inadmissible because the
 * page is gone, and when a later probe withdraws that record (#3191).
 *
 * Why this exists. 7 of the 18 rows that still freeze `websiteUrl` were cleared
 * correctly: the URL returns 404 or 410. The freeze is the only thing stopping the
 * engine re-deriving a dead link from a live observation, which is #2612's shape with
 * the clear being right. #3167 built the durable record; this points it at death
 * rather than at wrongness, and in doing so gives a probe verdict the durable form
 * #2567 recorded it was missing.
 *
 * Why this is STRICTER than `classifySourceLinkHealth`, deliberately. That classifier
 * treats `ENOTFOUND`, `ECONNREFUSED`, `EHOSTUNREACH` and `ENETUNREACH` as
 * `UNAVAILABLE`, which is right for its job: retiring a citation from display is
 * reversible and re-evaluated every pass. Making a value inadmissible is a standing
 * rule that outlives the probe, so it demands the server's own answer about the
 * resource. A name that does not resolve is a statement about DNS from wherever the
 * prober ran, and six hosts failing to resolve in one pass is as likely to be one
 * resolver as six dead sites.
 *
 * So only an explicit gone status qualifies. Everything else is reported as
 * inconclusive and writes nothing:
 *
 * - `ENOTFOUND` and friends: a statement about reaching the host, not about the page.
 * - A TLS error: a server ANSWERED, it just presented a certificate we would not
 *   accept. `ERR_TLS_CERT_ALTNAME_INVALID` is already excluded from the dead set
 *   upstream for exactly this reason.
 * - An egress refusal: the guard declined to make the request, so nothing was learned.
 * - A private-address host: Yale hosts on 10.x are not publicly reachable at all, so
 *   their failure is a property of the network rather than of the page.
 * - A 2xx that lands away from what was requested: a soft 404 is an inference, and an
 *   inference is what this module exists to avoid.
 *
 * Revisitable by construction. A host that 404s today can serve again, so a record
 * keyed on one probe must be withdrawable: `revivedValueWithdrawal` says when a later
 * probe answers for the resource itself, and the runner withdraws the refusal through
 * the same reviewed path any refusal uses. A permanent veto keyed on one probe is a
 * lock with better branding.
 */
import { classifySourceLinkHealth, type SourceLinkProbeResult } from '../services/sourceLinkHealth';

export const DEAD_WEBSITE_VALUE_REFUSAL_RULE = 'confirmed_dead_page';

/** The only statuses that are a server's own claim that the resource is gone. */
export const GONE_HTTP_STATUS_CODES: ReadonlySet<number> = new Set([404, 410]);

export type DeadValueVerdict =
  | { eligible: true; httpStatusCode: number }
  | { eligible: false; because: string };

export function deadValueRefusalVerdict(probe: SourceLinkProbeResult): DeadValueVerdict {
  if (probe.privateAddressHost) {
    return { eligible: false, because: 'private-address host: not publicly reachable at all' };
  }
  const status = probe.status;
  if (typeof status === 'number' && GONE_HTTP_STATUS_CODES.has(status)) {
    // Cross-check against the shared classifier so this cannot drift into calling a
    // status dead that the rest of the repo reads as inconclusive.
    const health = classifySourceLinkHealth(probe);
    if (health.healthStatus !== 'UNAVAILABLE') {
      return { eligible: false, because: `link health reads ${health.healthStatus}` };
    }
    return { eligible: true, httpStatusCode: status };
  }
  if (typeof status === 'number') {
    return { eligible: false, because: `status ${status} is not a claim that the page is gone` };
  }
  if (probe.errorCode) {
    return {
      eligible: false,
      because: `${probe.errorCode} describes the request, not the page`,
    };
  }
  return { eligible: false, because: 'the probe returned no status and no error' };
}

export type RevivedVerdict =
  | { revived: true; httpStatusCode: number }
  | { revived: false; because: string };

/**
 * Whether a later probe shows the resource answering again, which withdraws the
 * refusal. Reuses the shared classifier so a 2xx that lands somewhere else does NOT
 * count as revived: that is the soft-404 case and it must not re-admit a dead value.
 */
export function revivedValueWithdrawal(probe: SourceLinkProbeResult): RevivedVerdict {
  if (probe.privateAddressHost) {
    return { revived: false, because: 'private-address host' };
  }
  const health = classifySourceLinkHealth(probe);
  const status = probe.status;
  if (health.healthStatus === 'HEALTHY' && typeof status === 'number') {
    return { revived: true, httpStatusCode: status };
  }
  return { revived: false, because: `link health reads ${health.healthStatus}` };
}

export interface DeadValueRefusalNote {
  httpStatusCode: number;
  probedAt: Date;
}

/**
 * The note a refusal carries, so a later reader can tell what was observed and when
 * without re-probing. The date matters: this is the evidence the record stands on, and
 * evidence without a date cannot be judged stale.
 */
export function deadValueRefusalNote(note: DeadValueRefusalNote): string {
  return `the page answered HTTP ${note.httpStatusCode} when probed on ${note.probedAt
    .toISOString()
    .slice(0, 10)}, so it is not a research website this row can offer`;
}
