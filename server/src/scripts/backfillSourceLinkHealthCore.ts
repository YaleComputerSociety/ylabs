import {
  isStaleSourceLinkHealth,
  sourceLinkHealthAgeDays,
  type DatedSourceLinkHealth,
  type SourceLinkHealthStatus,
} from '../services/sourceLinkHealth';
import { deadLinkHealthRefusalEvidenceUrls } from './clearDeadResearchWebsitesCore';

export interface SourceLinkHealthCandidateEntity {
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
  /**
   * Required because `hasLiveSourceCitation` counts every `fieldProvenance.*.sourceUrl`
   * as a citation. This lane rewrites the whole `sourceLinkHealth` array, so any
   * citation it does not probe loses its verdict, and the gate then reads that
   * citation as possibly-live (#2666).
   */
  fieldProvenance?: unknown;
  fieldValueRefusals?: unknown;
}

/**
 * Whether an entity's stored verdicts still prove anything, so a re-probe run can
 * skip the rows it would only confirm. An entity with no verdicts at all needs
 * probing, and one stale verdict is enough to re-probe the whole row because the
 * lane replaces the array rather than patching one entry.
 */
const storedCheckedAtInstants = (storedHealth: unknown): number[] => {
  if (!Array.isArray(storedHealth)) return [];
  return storedHealth
    .map((entry) => {
      const checkedAt = (entry as { checkedAt?: unknown })?.checkedAt;
      if (!checkedAt) return NaN;
      const parsed = checkedAt instanceof Date ? checkedAt : new Date(checkedAt as string);
      return parsed.getTime();
    })
    .filter((instant) => Number.isFinite(instant));
};

/**
 * Whether a row still needs re-probing given that every verdict written before
 * `cutoff` was decided under superseded rules.
 *
 * The freshness horizon cannot express this. When the rules change, the verdicts
 * that need re-deciding are the ones written before the change, not the ones
 * written long ago, and after the #2473 rule change the whole corpus was only
 * days old - so `--stale-only` reported every row as fresh and would have
 * skipped all of them. This predicate is also what makes an interrupted run
 * resumable: rows the killed run already re-probed carry a `checkedAt` at or
 * after the cutoff and are skipped, so a resume does not redo them.
 */
export function needsRecheckSince(storedHealth: unknown, cutoff: Date): boolean {
  const instants = storedCheckedAtInstants(storedHealth);
  if (instants.length === 0) return true;
  if (!Array.isArray(storedHealth) || instants.length < storedHealth.length) return true;
  return Math.max(...instants) < cutoff.getTime();
}

export function needsSourceLinkHealthRefresh(
  storedHealth: unknown,
  now: Date = new Date(),
): boolean {
  if (!Array.isArray(storedHealth) || storedHealth.length === 0) return true;
  return storedHealth.some((entry) => {
    const record = entry as { healthStatus?: unknown; checkedAt?: unknown };
    if (typeof record?.healthStatus !== 'string') return true;
    return isStaleSourceLinkHealth(
      {
        healthStatus: record.healthStatus as SourceLinkHealthStatus,
        checkedAt: record.checkedAt as DatedSourceLinkHealth['checkedAt'],
      },
      now,
    );
  });
}

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Unlike `sourceLinkHealthKey`, this keeps the scheme: each spelling is probed and
 * stored on its own, because on a host whose certificate fails `http:` answers while
 * `https:` stops a browser at a warning, and one merged probe let the `http:` result
 * speak for the `https:` link a student is sent to (#4080).
 */
export const sourceLinkCandidateKey = (url: string): string | null => {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.protocol}//${host}${path}${parsed.search}`;
  } catch {
    return null;
  }
};

/** The plain-HTTP spelling of an `https:` URL, or null for any other URL. */
export const httpSpellingOf = (url: string): string | null => {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:') return null;
    parsed.protocol = 'http:';
    return parsed.toString();
  } catch {
    return null;
  }
};

/**
 * The plain-HTTP spellings to probe because their `https:` twin failed certificate
 * verification and neither spelling of the twin is already a candidate. Serve time can
 * only offer a student the working spelling if that spelling carries its own verdict.
 */
export function tlsFallbackCandidates(
  candidates: readonly string[],
  freshHealth: ReadonlyMap<string, { tlsVerificationFailed?: boolean }>,
): string[] {
  const present = new Set(candidates.map((url) => sourceLinkCandidateKey(url)));
  const fallbacks: string[] = [];
  for (const url of candidates) {
    if (freshHealth.get(url)?.tlsVerificationFailed !== true) continue;
    const plain = httpSpellingOf(url);
    const key = plain ? sourceLinkCandidateKey(plain) : null;
    if (!plain || !key || present.has(key)) continue;
    present.add(key);
    fallbacks.push(plain);
  }
  return fallbacks;
}

/** The `https:` spelling of a plain-HTTP URL, or null for any other URL. */
export const httpsSpellingOf = (url: string): string | null => {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:') return null;
    parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return null;
  }
};

/**
 * The `https:` spelling to probe for each plain-HTTP website this pass probed, keyed
 * by the website URL. A host that answers on both schemes without redirecting would
 * otherwise send a student to plain HTTP while a working `https:` page exists (#5639).
 * Only `websiteUrl` and `website` are offered, which bounds the extra probes to one
 * per row, and a website whose own redirect already recorded an `httpsLandingUrl`
 * needs no second answer.
 */
export function httpsSpellingProbes(
  websiteValues: readonly unknown[],
  freshHealth: ReadonlyMap<string, { httpsLandingUrl?: string }>,
): Map<string, string> {
  const probes = new Map<string, string>();
  for (const value of websiteValues) {
    if (typeof value !== 'string') continue;
    const url = value.trim();
    const verdict = freshHealth.get(url);
    if (!verdict || verdict.httpsLandingUrl) continue;
    const spelling = httpsSpellingOf(url);
    if (spelling) probes.set(url, spelling);
  }
  return probes;
}

/**
 * The probed `https:` spelling, recorded only when it answered `HEALTHY` with a
 * certificate that verified, from the same host, path and query it asked for. A
 * shared host's default `https:` site redirecting elsewhere is not this page.
 * Anything else, including no probe at all, records nothing, so serve time keeps
 * the stored `http:` link (#5639).
 */
export function verifiedHttpsSpelling(
  spelling: string | undefined,
  freshHealth: ReadonlyMap<
    string,
    { healthStatus?: string; tlsVerificationFailed?: boolean; landedOnRequestedResource?: true }
  >,
): string | undefined {
  if (!spelling) return undefined;
  const verdict = freshHealth.get(spelling);
  return verdict?.healthStatus === 'HEALTHY' &&
    verdict.tlsVerificationFailed !== true &&
    verdict.landedOnRequestedResource === true
    ? spelling
    : undefined;
}

/**
 * Every `sourceUrl` recorded in `fieldProvenance`. These are citations as far as
 * `hasLiveSourceCitation` is concerned, and a provenance URL can outlive its
 * presence in `sourceUrls`, so without this the lane can never re-probe it and a
 * full-array rewrite discards whatever verdict it once had.
 */
const fieldProvenanceSourceUrls = (fieldProvenance: unknown): unknown[] => {
  if (!fieldProvenance || typeof fieldProvenance !== 'object') return [];
  return Object.values(fieldProvenance as Record<string, unknown>).map((record) =>
    record && typeof record === 'object'
      ? (record as { sourceUrl?: unknown }).sourceUrl
      : undefined,
  );
};

export function collectSourceLinkHealthCandidates(
  entity: SourceLinkHealthCandidateEntity,
  extraUrls: readonly unknown[] = [],
): string[] {
  const rawValues: unknown[] = [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    ...fieldProvenanceSourceUrls(entity.fieldProvenance),
    ...deadLinkHealthRefusalEvidenceUrls(entity),
    ...extraUrls,
  ];

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const value of rawValues) {
    if (!isHttpUrl(value)) continue;
    const trimmed = value.trim();
    const key = sourceLinkCandidateKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(trimmed);
  }
  return candidates;
}

export interface StoredSourceLinkHealthEntry {
  url: string;
  healthStatus: SourceLinkHealthStatus;
  httpStatusCode?: number;
  privateAddressHost?: boolean;
  tlsVerificationFailed?: boolean;
  httpsLandingUrl?: string;
  httpsSpellingUrl?: string;
  redirectLandingUrl?: string;
  checkedAt?: Date;
  lastAttemptedAt?: Date;
  pendingConnectionFailureAt?: Date;
  pendingConnectionFailureProbedAt?: Date;
  confirmingConnectionFailureAt?: Date;
}

/**
 * Whether the stored entry should say this host resolves only into private space.
 *
 * A probe that came back with an HTTP status proves the host was publicly
 * routable at that moment, so the flag is dropped, and so does public DNS mapping
 * the host to public space, which is the only release a split-horizon host can
 * ever earn because our own resolver refuses it before any request (#3903). A probe that learned nothing
 * about addressing - a timeout, a transport error - keeps whatever was stored,
 * because a failed measurement must not release a link a student cannot open.
 * That asymmetry is the whole point: routing is a fact we only ever unlearn from
 * positive evidence (#2556).
 */
function privateAddressHostForEntry(
  fresh: { httpStatusCode?: number; privateAddressHost?: boolean; publicAddressHost?: boolean },
  stored: StoredSourceLinkHealthEntry | undefined,
): boolean | undefined {
  if (fresh.privateAddressHost) return true;
  if (fresh.publicAddressHost) return undefined;
  if (typeof fresh.httpStatusCode === 'number') return undefined;
  return stored?.privateAddressHost ? true : undefined;
}

/**
 * A verdict that asserts something about the resource, as opposed to reporting
 * that we failed to learn anything. `UNKNOWN` is the only status that asserts
 * nothing: it is what a 403, a 429, a 5xx, a timeout and an unconfirmed DNS
 * failure all produce.
 */
export function isDecisiveStoredVerdict(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const status = (entry as { healthStatus?: unknown }).healthStatus;
  return typeof status === 'string' && status !== 'UNKNOWN';
}

/** The stored shape a resolution failure leaves: `UNAVAILABLE` with no HTTP status. */
export function isStoredUnresolvableVerdict(entry: StoredSourceLinkHealthEntry): boolean {
  return entry.healthStatus === 'UNAVAILABLE' && typeof entry.httpStatusCode !== 'number';
}

export function storedSourceLinkHealthByUrl(
  storedHealth: unknown,
): Map<string, StoredSourceLinkHealthEntry> {
  const index = new Map<string, StoredSourceLinkHealthEntry>();
  if (!Array.isArray(storedHealth)) return index;
  for (const entry of storedHealth) {
    const url = (entry as { url?: unknown })?.url;
    if (typeof url !== 'string' || !url) continue;
    index.set(url, entry as StoredSourceLinkHealthEntry);
  }
  return index;
}

export interface ResolvedSourceLinkHealthEntry {
  entry: StoredSourceLinkHealthEntry;
  preservedDecisiveVerdict: boolean;
  preservedUnreachedVerdict?: boolean;
  heldConnectionFailure?: boolean;
}

const VERDICTS_A_CONNECTION_FAILURE_WAITS_ON = new Set(['HEALTHY', 'REDIRECTED']);

const instantOf = (value: unknown): number | undefined => {
  if (!value) return undefined;
  const instant = (value instanceof Date ? value : new Date(value as string)).getTime();
  return Number.isFinite(instant) ? instant : undefined;
};

export const CONNECTION_FAILURE_CONFIRMATION_GAP_MS = 6 * 60 * 60 * 1000;

/**
 * A refused or unroutable connection over a live verdict, held until a second run
 * confirms it.
 *
 * A host that refuses connections for a few minutes is not a retired host, and the two
 * attempts inside one probe are seconds apart, too close to tell the cases apart. The
 * first such failure keeps the stored verdict and records the run that saw it in
 * `pendingConnectionFailureAt`, and the probe that saw it in
 * `pendingConnectionFailureProbedAt`. A later run confirms it as `UNAVAILABLE` only when
 * both its start and its probe come `CONNECTION_FAILURE_CONFIRMATION_GAP_MS` or more after
 * the first run's, because a resume minutes later, or a first probe late in a long run,
 * is the same outage rather than a second observation, and the confirming run start is
 * kept as `confirmingConnectionFailureAt` beside the first.
 * A failure inside the gap keeps the first time, so repeated failures cannot reset it,
 * and a missing or unreadable time never confirms. Any probe that reaches the host
 * drops the marker (#6116). A confirmed DNS negative is not held: it is how a retired
 * domain retires (#2726).
 */
function resolveConnectionFailure(
  url: string,
  fresh: { connectionLevelFailure?: true; httpsSpellingUrl?: string },
  stored: StoredSourceLinkHealthEntry | undefined,
  now: Date,
  runStartedAt: Date,
): ResolvedSourceLinkHealthEntry | undefined {
  if (!fresh.connectionLevelFailure || !stored) return undefined;
  const freshSpelling = fresh.httpsSpellingUrl ? { httpsSpellingUrl: fresh.httpsSpellingUrl } : {};
  if (stored.healthStatus === 'UNAVAILABLE' && stored.confirmingConnectionFailureAt) {
    return {
      entry: {
        url,
        healthStatus: 'UNAVAILABLE',
        ...(stored.privateAddressHost ? { privateAddressHost: true as const } : {}),
        ...freshSpelling,
        checkedAt: now,
        pendingConnectionFailureAt: stored.pendingConnectionFailureAt,
        ...(stored.pendingConnectionFailureProbedAt
          ? { pendingConnectionFailureProbedAt: stored.pendingConnectionFailureProbedAt }
          : {}),
        confirmingConnectionFailureAt: stored.confirmingConnectionFailureAt,
      },
      preservedDecisiveVerdict: false,
    };
  }
  if (!VERDICTS_A_CONNECTION_FAILURE_WAITS_ON.has(stored.healthStatus)) return undefined;
  const firstFailureRun = instantOf(stored.pendingConnectionFailureAt);
  const firstFailureProbe = instantOf(stored.pendingConnectionFailureProbedAt);
  const thisRun = instantOf(runStartedAt);
  const thisProbe = instantOf(now);
  if (
    firstFailureRun !== undefined &&
    firstFailureProbe !== undefined &&
    thisRun !== undefined &&
    thisProbe !== undefined &&
    thisRun - firstFailureRun >= CONNECTION_FAILURE_CONFIRMATION_GAP_MS &&
    thisProbe - firstFailureProbe >= CONNECTION_FAILURE_CONFIRMATION_GAP_MS
  ) {
    return {
      entry: {
        url,
        healthStatus: 'UNAVAILABLE',
        ...(stored.privateAddressHost ? { privateAddressHost: true as const } : {}),
        ...freshSpelling,
        checkedAt: now,
        pendingConnectionFailureAt: new Date(firstFailureRun),
        pendingConnectionFailureProbedAt: new Date(firstFailureProbe),
        confirmingConnectionFailureAt: new Date(thisRun),
      },
      preservedDecisiveVerdict: false,
    };
  }
  return {
    entry: {
      ...stored,
      url,
      ...freshSpelling,
      lastAttemptedAt: now,
      pendingConnectionFailureAt:
        firstFailureRun !== undefined ? new Date(firstFailureRun) : runStartedAt,
      pendingConnectionFailureProbedAt:
        firstFailureRun !== undefined && firstFailureProbe !== undefined
          ? new Date(firstFailureProbe)
          : now,
    },
    preservedDecisiveVerdict: true,
    heldConnectionFailure: true,
  };
}

/**
 * A probe that never got an answer from the host: no HTTP status and no TLS
 * handshake to judge. That covers a host the SSRF guard refused as private (on the
 * Yale network, split-horizon DNS answers internal addresses for some public hosts),
 * a timeout and a reset. It observed nothing about the URL, so it must not replace
 * what an earlier probe did observe, a certificate failure included. A confirmed DNS
 * or connection negative is not this: `classifyProbeOutcome` records it as
 * `UNAVAILABLE`, which is how a retired host retires (#2726, #2757).
 */
/**
 * Whether a decisive stored verdict survives a fresh `UNKNOWN` probe. It does, because an
 * `UNKNOWN` asserts nothing, except where a certificate that fails verification contradicts a
 * stored `HEALTHY` for this very URL: that verdict was written by a probe which never negotiated
 * this spelling's TLS (#4080). A stored `UNAVAILABLE` still stands. Every caller that may replace
 * a stored verdict with an `UNKNOWN` reads this one rule (#6258).
 */
export function storedVerdictSurvivesUnknownProbe(
  fresh: { tlsVerificationFailed?: boolean },
  stored: { healthStatus?: unknown } | undefined,
): boolean {
  if (!isDecisiveStoredVerdict(stored)) return false;
  return !(fresh.tlsVerificationFailed && stored?.healthStatus === 'HEALTHY');
}

export function isUnreachedProbe(fresh: {
  healthStatus: SourceLinkHealthStatus;
  httpStatusCode?: number;
  tlsVerificationFailed?: boolean;
}): boolean {
  return (
    fresh.healthStatus === 'UNKNOWN' &&
    typeof fresh.httpStatusCode !== 'number' &&
    !fresh.tlsVerificationFailed
  );
}

/**
 * Decides what to store for one URL, given the fresh probe and whatever is
 * already recorded.
 *
 * An inconclusive fresh probe must not erase a decisive stored verdict. A
 * sustained 403 wave from one host downgraded 353 verdicts to `UNKNOWN` in a
 * single pass, 9 of them a correct `UNAVAILABLE` 404 and 2 of those on rows a
 * student can see; because serve-time suppression fires on `UNAVAILABLE`, the
 * pass un-suppressed pages that are genuinely gone (#2762). #2473 established
 * that a 403 must never retire a link, and it must equally never un-retire one.
 *
 * The preserved verdict deliberately keeps its ORIGINAL `checkedAt`. Renewing it
 * would let a host that always throttles us keep a `HEALTHY` verdict alive for
 * ever, which is the stale-HEALTHY hazard `SOURCE_LINK_HEALTH_FRESHNESS_DAYS`
 * exists to bound: an assertion is preserved, its warranty is not. `lastAttemptedAt`
 * records that we did try, so a preserved row is distinguishable from one nobody
 * has probed.
 */
export function resolveSourceLinkHealthEntry(
  url: string,
  fresh: {
    healthStatus: SourceLinkHealthStatus;
    httpStatusCode?: number;
    privateAddressHost?: boolean;
    publicAddressHost?: boolean;
    tlsVerificationFailed?: boolean;
    httpsLandingUrl?: string;
    httpsSpellingUrl?: string;
    redirectLandingUrl?: string;
    connectionLevelFailure?: true;
  },
  stored: StoredSourceLinkHealthEntry | undefined,
  now: Date,
  runStartedAt: Date = now,
): ResolvedSourceLinkHealthEntry {
  const connectionFailure = resolveConnectionFailure(url, fresh, stored, now, runStartedAt);
  if (connectionFailure) return connectionFailure;
  const privateAddressHost = privateAddressHostForEntry(fresh, stored);
  const routing = {
    ...(privateAddressHost ? { privateAddressHost: true as const } : {}),
    ...(fresh.tlsVerificationFailed ? { tlsVerificationFailed: true as const } : {}),
  };
  const freshEntry: StoredSourceLinkHealthEntry = {
    url,
    healthStatus: fresh.healthStatus,
    ...(typeof fresh.httpStatusCode === 'number' ? { httpStatusCode: fresh.httpStatusCode } : {}),
    ...routing,
    ...(fresh.httpsLandingUrl ? { httpsLandingUrl: fresh.httpsLandingUrl } : {}),
    ...(fresh.httpsSpellingUrl ? { httpsSpellingUrl: fresh.httpsSpellingUrl } : {}),
    ...(fresh.redirectLandingUrl ? { redirectLandingUrl: fresh.redirectLandingUrl } : {}),
    checkedAt: now,
  };

  if (fresh.healthStatus !== 'UNKNOWN')
    return { entry: freshEntry, preservedDecisiveVerdict: false };
  if (stored && isUnreachedProbe(fresh)) {
    const { privateAddressHost: _storedPrivate, ...storedVerdict } = stored;
    return {
      entry: {
        ...storedVerdict,
        url,
        ...(privateAddressHost ? { privateAddressHost: true as const } : {}),
        lastAttemptedAt: now,
      },
      preservedDecisiveVerdict: isDecisiveStoredVerdict(stored),
      preservedUnreachedVerdict: true,
    };
  }
  if (!storedVerdictSurvivesUnknownProbe(fresh, stored))
    return { entry: freshEntry, preservedDecisiveVerdict: false };

  const kept = stored as StoredSourceLinkHealthEntry;
  return {
    entry: {
      url,
      healthStatus: kept.healthStatus,
      ...(typeof kept.httpStatusCode === 'number' ? { httpStatusCode: kept.httpStatusCode } : {}),
      ...routing,
      ...(kept.httpsLandingUrl ? { httpsLandingUrl: kept.httpsLandingUrl } : {}),
      ...(kept.httpsSpellingUrl ? { httpsSpellingUrl: kept.httpsSpellingUrl } : {}),
      ...(kept.redirectLandingUrl ? { redirectLandingUrl: kept.redirectLandingUrl } : {}),
      ...(kept.checkedAt ? { checkedAt: kept.checkedAt } : {}),
      lastAttemptedAt: now,
    },
    preservedDecisiveVerdict: true,
  };
}

/**
 * How old a `HEALTHY` verdict may be before an unattended sweep probes the URL again.
 *
 * It must stay well inside `SOURCE_LINK_HEALTH_FRESHNESS_DAYS`, so a regularly swept
 * verdict never lapses into "unverified", and it is short because the gate and
 * `dead-research-website-clear` act on these verdicts: a site that dies is noticed
 * at most this many days late. Only `HEALTHY` earns the skip; every other verdict,
 * and every URL without one, is probed on every sweep (#3568). A `HEALTHY` verdict
 * holding a pending connection failure is probed too, or the run that confirms or
 * clears it would never come (#6116).
 */
export const SOURCE_LINK_HEALTH_REPROBE_HEALTHY_AFTER_DAYS = 7;

export function storedSourceLinkHealthByCandidateKey(
  storedHealth: unknown,
): Map<string, StoredSourceLinkHealthEntry> {
  const index = new Map<string, StoredSourceLinkHealthEntry>();
  if (!Array.isArray(storedHealth)) return index;
  for (const entry of storedHealth) {
    const url = (entry as { url?: unknown })?.url;
    if (typeof url !== 'string' || !url) continue;
    const key = sourceLinkCandidateKey(url);
    if (key && !index.has(key)) index.set(key, entry as StoredSourceLinkHealthEntry);
  }
  return index;
}

export function isFreshHealthySourceLinkVerdict(
  stored: StoredSourceLinkHealthEntry | undefined,
  reprobeHealthyAfterDays: number,
  now: Date,
): boolean {
  if (stored?.healthStatus !== 'HEALTHY') return false;
  if (stored.pendingConnectionFailureAt) return false;
  const ageDays = sourceLinkHealthAgeDays(stored, now);
  return ageDays !== undefined && ageDays >= 0 && ageDays <= reprobeHealthyAfterDays;
}

export interface SourceLinkReprobePlan {
  toProbe: string[];
  carried: Map<string, StoredSourceLinkHealthEntry>;
}

export function planSourceLinkReprobe(
  candidates: readonly string[],
  storedHealth: unknown,
  reprobeHealthyAfterDays: number,
  now: Date,
): SourceLinkReprobePlan {
  const storedByKey = storedSourceLinkHealthByCandidateKey(storedHealth);
  const toProbe: string[] = [];
  const carried = new Map<string, StoredSourceLinkHealthEntry>();
  for (const url of candidates) {
    const key = sourceLinkCandidateKey(url);
    const stored = key ? storedByKey.get(key) : undefined;
    if (isFreshHealthySourceLinkVerdict(stored, reprobeHealthyAfterDays, now)) {
      carried.set(url, stored as StoredSourceLinkHealthEntry);
    } else {
      toProbe.push(url);
    }
  }
  return { toProbe, carried };
}

export function carryForwardSourceLinkHealthEntry(
  url: string,
  stored: StoredSourceLinkHealthEntry,
): StoredSourceLinkHealthEntry {
  return {
    url,
    healthStatus: stored.healthStatus,
    ...(typeof stored.httpStatusCode === 'number' ? { httpStatusCode: stored.httpStatusCode } : {}),
    ...(stored.privateAddressHost === true ? { privateAddressHost: true } : {}),
    ...(stored.tlsVerificationFailed === true ? { tlsVerificationFailed: true } : {}),
    ...(stored.httpsLandingUrl ? { httpsLandingUrl: stored.httpsLandingUrl } : {}),
    ...(stored.httpsSpellingUrl ? { httpsSpellingUrl: stored.httpsSpellingUrl } : {}),
    ...(stored.redirectLandingUrl ? { redirectLandingUrl: stored.redirectLandingUrl } : {}),
    ...(stored.checkedAt ? { checkedAt: stored.checkedAt } : {}),
    ...(stored.lastAttemptedAt ? { lastAttemptedAt: stored.lastAttemptedAt } : {}),
    ...(stored.pendingConnectionFailureAt
      ? { pendingConnectionFailureAt: stored.pendingConnectionFailureAt }
      : {}),
    ...(stored.pendingConnectionFailureProbedAt
      ? { pendingConnectionFailureProbedAt: stored.pendingConnectionFailureProbedAt }
      : {}),
    ...(stored.confirmingConnectionFailureAt
      ? { confirmingConnectionFailureAt: stored.confirmingConnectionFailureAt }
      : {}),
  };
}

/**
 * One stored verdict as the gate reads it: its status and the two routing facts that
 * change what a student sees. `NONE` is a URL nobody has probed.
 */
export function sourceLinkVerdictSignature(entry: StoredSourceLinkHealthEntry | undefined): string {
  if (!entry) return 'NONE';
  return `${entry.healthStatus}${entry.tlsVerificationFailed ? '+TLS' : ''}${
    entry.privateAddressHost ? '+PRIVATE' : ''
  }`;
}

const VERDICTS_A_STUDENT_CAN_FOLLOW = new Set(['HEALTHY', 'REDIRECTED']);

export interface SourceLinkVerdictTransitionSample {
  slug: string;
  url: string;
  transition: string;
  servedWebsite: boolean;
  httpStatusCode?: number;
}

export interface SourceLinkVerdictTransitionTally {
  verdictTransitions: Record<string, number>;
  clearedTlsFlags: number;
  servedWebsitesLost: number;
  /**
   * Every transition away from a verdict a student could follow, or that clears a
   * certificate flag, so a gate can re-check each one by hand. A first probe of an
   * unprobed URL is not listed.
   */
  lostVerdictSamples: SourceLinkVerdictTransitionSample[];
}

const MAX_LOST_VERDICT_SAMPLES = 200;

/**
 * Counts what one URL's stored verdict becomes. A changed `checkedAt` alone is not a
 * transition, which is why the row-level `updated` count cannot answer the gate's two
 * questions: how many certificate warnings a pass would erase, and how many websites
 * on served rows stop being followable.
 */
export function tallySourceLinkVerdictTransition(
  tally: SourceLinkVerdictTransitionTally,
  before: StoredSourceLinkHealthEntry | undefined,
  after: StoredSourceLinkHealthEntry,
  servedWebsite: boolean,
  slug = '',
): void {
  const from = sourceLinkVerdictSignature(before);
  const to = sourceLinkVerdictSignature(after);
  if (from === to) return;
  const key = `${from}->${to}`;
  tally.verdictTransitions[key] = (tally.verdictTransitions[key] ?? 0) + 1;
  if (before?.tlsVerificationFailed && !after.tlsVerificationFailed) tally.clearedTlsFlags += 1;
  const followableBefore =
    !!before &&
    VERDICTS_A_STUDENT_CAN_FOLLOW.has(before.healthStatus) &&
    !before.tlsVerificationFailed;
  const followableAfter =
    VERDICTS_A_STUDENT_CAN_FOLLOW.has(after.healthStatus) && !after.tlsVerificationFailed;
  if (servedWebsite && followableBefore && !followableAfter) tally.servedWebsitesLost += 1;
  const clearsTls = !!before?.tlsVerificationFailed && !after.tlsVerificationFailed;
  if (
    ((followableBefore && !followableAfter) || clearsTls) &&
    tally.lostVerdictSamples.length < MAX_LOST_VERDICT_SAMPLES
  ) {
    tally.lostVerdictSamples.push({
      slug,
      url: after.url,
      transition: key,
      servedWebsite,
      ...(typeof after.httpStatusCode === 'number' ? { httpStatusCode: after.httpStatusCode } : {}),
    });
  }
}
