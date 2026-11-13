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
  unclassifiedHosts: HostRefusalCount[];
  splitHorizonRefusals: number;
  classificationBudgetMs: number;
}

export const SPLIT_HORIZON_REPORT_BUDGET_MS = 60_000;
export const SPLIT_HORIZON_REPORT_CONCURRENCY = 8;

const BUDGET_SPENT = Symbol('budget-spent');

/**
 * Asks about each item with bounded concurrency inside one overall budget, so a resolver that
 * never answers ends the report at the budget instead of hanging a run's tail (#5945). An item
 * not answered in time is left out of the returned map.
 */
async function askWithinBudget<T>(
  items: readonly string[],
  ask: (item: string) => Promise<T>,
  budgetMs: number,
  concurrency: number,
): Promise<Map<string, T>> {
  const answers = new Map<string, T>();
  if (items.length === 0) return answers;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budgetSpent = new Promise<typeof BUDGET_SPENT>((resolve) => {
    timer = setTimeout(() => resolve(BUDGET_SPENT), budgetMs);
    timer.unref?.();
  });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      const answer = await Promise.race([ask(item), budgetSpent]);
      if (answer === BUDGET_SPENT) return;
      answers.set(item, answer);
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker),
    );
  } finally {
    clearTimeout(timer);
  }
  return answers;
}

const byRefusalsThenHost = (left: HostRefusalCount, right: HostRefusalCount): number =>
  right.refusals - left.refusals || left.host.localeCompare(right.host);

/**
 * Splits this process's private-address refusals into hosts public DNS answers with a routable
 * address, which only this network cannot reach, hosts that are private everywhere, and hosts
 * not answered within the budget, which are never reported as split-horizon.
 */
export async function splitHorizonRefusalReport(
  counts: ReadonlyMap<string, number> = privateAddressRefusalCounts(),
  classify: (host: string) => Promise<OffCampusAddressing> = classifyOffCampusAddressing,
  budgetMs = SPLIT_HORIZON_REPORT_BUDGET_MS,
  concurrency = SPLIT_HORIZON_REPORT_CONCURRENCY,
): Promise<SplitHorizonRefusalReport> {
  const answers = await askWithinBudget(
    [...counts.keys()],
    (host) => classify(host).catch((): OffCampusAddressing => 'private-address'),
    budgetMs,
    concurrency,
  );
  const splitHorizonHosts: HostRefusalCount[] = [];
  const privateOnlyHosts: HostRefusalCount[] = [];
  const unclassifiedHosts: HostRefusalCount[] = [];
  for (const [host, refusals] of counts) {
    const addressing = answers.get(host);
    const bucket =
      addressing === undefined
        ? unclassifiedHosts
        : addressing === 'public'
          ? splitHorizonHosts
          : privateOnlyHosts;
    bucket.push({ host, refusals });
  }
  for (const bucket of [splitHorizonHosts, privateOnlyHosts, unclassifiedHosts]) {
    bucket.sort(byRefusalsThenHost);
  }
  return {
    splitHorizonHosts,
    privateOnlyHosts,
    unclassifiedHosts,
    splitHorizonRefusals: splitHorizonHosts.reduce((total, entry) => total + entry.refusals, 0),
    classificationBudgetMs: budgetMs,
  };
}

const LISTED_HOSTS = 12;

export function splitHorizonRefusalWarning(report: SplitHorizonRefusalReport): string | null {
  const hosts = report.splitHorizonHosts;
  const unclassified = report.unclassifiedHosts.length;
  if (hosts.length === 0 && unclassified === 0) return null;
  const notClassified = unclassified
    ? ` ${unclassified} other refused host(s) were not classified within the ${report.classificationBudgetMs / 1000} s budget.`
    : '';
  if (hosts.length === 0) {
    return `the SSRF guard refused private-address host(s) this run could not check against public DNS.${notClassified}`;
  }
  const listed = hosts
    .slice(0, LISTED_HOSTS)
    .map(({ host, refusals }) => `${host} (${refusals})`)
    .join(', ');
  const more = hosts.length > LISTED_HOSTS ? `, and ${hosts.length - LISTED_HOSTS} more` : '';
  return (
    `the SSRF guard refused ${report.splitHorizonRefusals} request(s) to ${hosts.length} host(s) ` +
    `that this network's DNS resolves to private addresses while public DNS answers them publicly ` +
    `(split-horizon DNS): ${listed}${more}. This run did not read them; run from a network with ` +
    `public DNS, such as the hosted sweep, to cover them.${notClassified}`
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
  budgetMs = SPLIT_HORIZON_REPORT_BUDGET_MS,
): Promise<string[]> {
  const answers = await askWithinBudget(
    hosts,
    async (host) => {
      const here = await resolveHere(host).catch((): HostnameResolution => ({
        kind: 'resolver-failure',
      }));
      if (here.kind !== 'private-address') return false;
      const publicly = await classify(host).catch((): OffCampusAddressing => 'private-address');
      return publicly === 'public';
    },
    budgetMs,
    SPLIT_HORIZON_REPORT_CONCURRENCY,
  );
  return hosts.filter((host) => answers.get(host) === true);
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
