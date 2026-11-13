import {
  classifyHostnameResolution,
  privateAddressRefusalCounts,
  type HostnameResolution,
} from '../../utils/ssrfGuard';
import {
  classifyOffCampusAddressing,
  type OffCampusAddressing,
} from '../../utils/publicDnsResolution';

export interface HostRefusalCount {
  host: string;
  refusals: number;
}

export interface SplitHorizonRefusalReport {
  splitHorizonHosts: HostRefusalCount[];
  privateOnlyHosts: HostRefusalCount[];
  splitHorizonRefusals: number;
}

const byRefusalsThenHost = (left: HostRefusalCount, right: HostRefusalCount): number =>
  right.refusals - left.refusals || left.host.localeCompare(right.host);

/**
 * Splits this process's private-address refusals into hosts public DNS answers with a routable
 * address, which only this network cannot reach, and hosts that are private everywhere.
 */
export async function splitHorizonRefusalReport(
  counts: ReadonlyMap<string, number> = privateAddressRefusalCounts(),
  classify: (host: string) => Promise<OffCampusAddressing> = classifyOffCampusAddressing,
): Promise<SplitHorizonRefusalReport> {
  const splitHorizonHosts: HostRefusalCount[] = [];
  const privateOnlyHosts: HostRefusalCount[] = [];
  for (const [host, refusals] of counts) {
    const addressing = await classify(host).catch((): OffCampusAddressing => 'private-address');
    (addressing === 'public' ? splitHorizonHosts : privateOnlyHosts).push({ host, refusals });
  }
  splitHorizonHosts.sort(byRefusalsThenHost);
  privateOnlyHosts.sort(byRefusalsThenHost);
  return {
    splitHorizonHosts,
    privateOnlyHosts,
    splitHorizonRefusals: splitHorizonHosts.reduce((total, entry) => total + entry.refusals, 0),
  };
}

const LISTED_HOSTS = 12;

export function splitHorizonRefusalWarning(report: SplitHorizonRefusalReport): string | null {
  const hosts = report.splitHorizonHosts;
  if (hosts.length === 0) return null;
  const listed = hosts
    .slice(0, LISTED_HOSTS)
    .map(({ host, refusals }) => `${host} (${refusals})`)
    .join(', ');
  const more = hosts.length > LISTED_HOSTS ? `, and ${hosts.length - LISTED_HOSTS} more` : '';
  return (
    `the SSRF guard refused ${report.splitHorizonRefusals} request(s) to ${hosts.length} host(s) ` +
    `that this network's DNS resolves to private addresses while public DNS answers them publicly ` +
    `(split-horizon DNS): ${listed}${more}. This run did not read them; run from a network with ` +
    `public DNS, such as the hosted sweep, to cover them.`
  );
}

export const SPLIT_HORIZON_PROBE_HOSTS: readonly string[] = [
  'www.cs.yale.edu',
  'www.astro.yale.edu',
  'ursula.chem.yale.edu',
];

/**
 * Read-only network check for a run's preflight: the probe hosts that this machine's resolver
 * answers privately while public DNS answers them publicly. It asks DNS only and fetches nothing.
 */
export async function probeSplitHorizonNetwork(
  hosts: readonly string[] = SPLIT_HORIZON_PROBE_HOSTS,
  resolveHere: (host: string) => Promise<HostnameResolution> = classifyHostnameResolution,
  classify: (host: string) => Promise<OffCampusAddressing> = classifyOffCampusAddressing,
): Promise<string[]> {
  const splitHorizon: string[] = [];
  for (const host of hosts) {
    const here = await resolveHere(host).catch((): HostnameResolution => ({
      kind: 'resolver-failure',
    }));
    if (here.kind !== 'private-address') continue;
    const publicly = await classify(host).catch((): OffCampusAddressing => 'private-address');
    if (publicly === 'public') splitHorizon.push(host);
  }
  return splitHorizon;
}

export function splitHorizonNetworkWarning(splitHorizonHosts: readonly string[]): string | null {
  if (splitHorizonHosts.length === 0) return null;
  return (
    `this network resolves ${splitHorizonHosts.join(', ')} to private addresses while public DNS ` +
    `answers them publicly (split-horizon DNS). The SSRF guard refuses every host like them, so ` +
    `this run will not read them; each source reports the hosts it was refused, and the hosted ` +
    `sweep covers them.`
  );
}
