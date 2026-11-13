import { releaseDevHostLease } from '../../db/devWriteLease';
import { hostnameForLimiter } from './hostConcurrencyLimiter';

export type ReleaseFinishedHost = (host: string) => Promise<void>;

export function plannedHosts(urls: Iterable<string | null | undefined>): Set<string> {
  const hosts = new Set<string>();
  for (const url of urls) {
    const host = url ? hostnameForLimiter(url) : undefined;
    if (host) hosts.add(host);
  }
  return hosts;
}

export interface PlannedHostRow<T> {
  row: T;
  hosts: ReadonlySet<string>;
}

/**
 * Orders rows so the hosts several rows share finish one at a time, smallest first: each row runs
 * with the least shared of its shared hosts, so a host's lease is handed back when its group ends
 * rather than when the run does. Rows that share no host free nothing and go first. The most
 * shared host finishes last, which costs it nothing, because its rows span most of the run anyway.
 * Ties keep the incoming order, so a run stays reproducible.
 */
export function orderRowsBySmallestSharedHost<T>(
  planned: readonly PlannedHostRow<T>[],
): PlannedHostRow<T>[] {
  const rowsPerHost = new Map<string, number>();
  for (const { hosts } of planned) {
    for (const host of hosts) rowsPerHost.set(host, (rowsPerHost.get(host) ?? 0) + 1);
  }
  const rank = new Map(
    [...rowsPerHost]
      .filter(([, count]) => count > 1)
      .sort(([hostA, countA], [hostB, countB]) => countA - countB || hostA.localeCompare(hostB))
      .map(([host], index) => [host, index]),
  );
  const groupOf = ({ hosts }: PlannedHostRow<T>) =>
    [...hosts].reduce((least, host) => Math.min(least, rank.get(host) ?? Infinity), Infinity);
  return planned
    .map((entry, index) => ({ entry, index, group: groupOf(entry) }))
    .sort((a, b) => {
      const groupA = a.group === Infinity ? -1 : a.group;
      const groupB = b.group === Infinity ? -1 : b.group;
      return groupA - groupB || a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/**
 * Counts the rows still to run on each host and hands a host's lease back the moment its last
 * planned row finishes, so one long run does not hold every host it touched until it ends.
 */
export class HostCompletionTracker {
  private readonly remaining = new Map<string, number>();
  private readonly releases: Promise<void>[] = [];

  constructor(
    planned: Iterable<{ hosts: ReadonlySet<string> }>,
    private readonly release: ReleaseFinishedHost = releaseDevHostLease,
  ) {
    for (const { hosts } of planned) {
      for (const host of hosts) this.remaining.set(host, (this.remaining.get(host) ?? 0) + 1);
    }
  }

  rowFinished(hosts: ReadonlySet<string>): void {
    for (const host of hosts) {
      const left = (this.remaining.get(host) ?? 0) - 1;
      if (left > 0) {
        this.remaining.set(host, left);
        continue;
      }
      this.remaining.delete(host);
      this.releases.push(this.release(host).catch(() => undefined));
    }
  }

  async settled(): Promise<void> {
    await Promise.all(this.releases);
  }
}
