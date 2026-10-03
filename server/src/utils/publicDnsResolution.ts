import net from 'net';
import { isPrivateAddress } from './ssrfGuard';
import { sanitizeLogValue } from './logSanitizer';

/**
 * What a private-address refusal from our own resolver means for a student off
 * campus. Yale answers its legacy departmental hosts with split-horizon DNS: the
 * resolver on a scrape host can return RFC1918 space while every public resolver
 * returns a routable `128.36.0.0/16` address (#3903). Only the public answer says
 * anything about the audience, so the refusal is re-asked there before it is
 * recorded as a fact about the URL.
 *
 * Asked over HTTPS rather than port 53, because a network that intercepts plain
 * DNS would answer in the public resolver's place and hand back the same private
 * view this exists to see past.
 */
export type OffCampusAddressing = 'public' | 'private-address';

export interface DohResponse {
  Status?: unknown;
  Answer?: unknown;
}

export type DohQuery = (url: string) => Promise<DohResponse>;

const DOH_ENDPOINT = 'https://dns.google/resolve';
const DOH_TIMEOUT_MS = 5_000;
const DNS_RCODE_NOERROR = 0;
const DNS_RCODE_NXDOMAIN = 3;
const ADDRESS_RECORD_TYPES = [
  { name: 'A', code: 1 },
  { name: 'AAAA', code: 28 },
] as const;

const fetchDohJson: DohQuery = async (url) => {
  const response = await fetch(url, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`DNS-over-HTTPS answered ${response.status}`);
  return (await response.json()) as DohResponse;
};

type RecordLookup =
  { kind: 'answered'; addresses: string[] } | { kind: 'nxdomain' } | { kind: 'failed' };

const lookupRecords = async (
  hostname: string,
  record: (typeof ADDRESS_RECORD_TYPES)[number],
  query: DohQuery,
): Promise<RecordLookup> => {
  try {
    const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${record.name}`;
    const body = await query(url);
    if (body.Status === DNS_RCODE_NXDOMAIN) return { kind: 'nxdomain' };
    if (body.Status !== DNS_RCODE_NOERROR) return { kind: 'failed' };
    const answers = Array.isArray(body.Answer) ? body.Answer : [];
    const addresses = answers
      .filter((answer) => (answer as { type?: unknown })?.type === record.code)
      .map((answer) => (answer as { data?: unknown }).data)
      .filter((data): data is string => typeof data === 'string' && net.isIP(data) !== 0);
    return { kind: 'answered', addresses };
  } catch {
    return { kind: 'failed' };
  }
};

const askPublicDns = async (
  hostname: string,
  query: DohQuery,
): Promise<OffCampusAddressing | 'resolver-failure'> => {
  const addresses: string[] = [];
  for (const record of ADDRESS_RECORD_TYPES) {
    const lookup = await lookupRecords(hostname, record, query);
    if (lookup.kind === 'failed') return 'resolver-failure';
    if (lookup.kind === 'nxdomain') return 'private-address';
    addresses.push(...lookup.addresses);
    if (addresses.length > 0) break;
  }
  if (addresses.length === 0) return 'private-address';
  return addresses.every((address) => !isPrivateAddress(address)) ? 'public' : 'private-address';
};

const confirmPrivateRefusal = async (
  hostname: string,
  query: DohQuery,
): Promise<OffCampusAddressing> => {
  const verdict = await askPublicDns(hostname, query);
  if (verdict !== 'resolver-failure') return verdict;
  console.warn(
    `Public DNS could not be asked about ${sanitizeLogValue(hostname)}; keeping our resolver's private-address answer`,
  );
  return 'private-address';
};

const verdictsByQuery = new WeakMap<DohQuery, Map<string, Promise<OffCampusAddressing>>>();

/**
 * A name public DNS does not know is as unreachable off campus as one it maps to
 * private space, so both confirm the flag. A lookup that fails leaves our own
 * resolver's private answer standing, because a failed measurement must never
 * release a link a student cannot open (#2556). One verdict per host per process,
 * so a host cited by many pages is asked about once.
 */
export const classifyOffCampusAddressing = (
  hostname: string,
  query: DohQuery = fetchDohJson,
): Promise<OffCampusAddressing> => {
  const clean = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(clean)) {
    return Promise.resolve(isPrivateAddress(clean) ? 'private-address' : 'public');
  }
  let verdicts = verdictsByQuery.get(query);
  if (!verdicts) {
    verdicts = new Map();
    verdictsByQuery.set(query, verdicts);
  }
  let verdict = verdicts.get(clean);
  if (!verdict) {
    verdict = confirmPrivateRefusal(clean, query);
    verdicts.set(clean, verdict);
  }
  return verdict;
};
