import { releaseDevHostLease } from '../../db/devWriteLease';
import { hostnameForLimiter } from './hostConcurrencyLimiter';

export type ReleaseFinishedHost = (host: string) => Promise<void>;

export interface PlannedHostRow<T> {
  row: T;
  hosts: ReadonlySet<string>;
}

export function plannedHosts(urls: Iterable<string | null | undefined>): Set<string> {
  const hosts = new Set<string>();
  for (const url of urls) {
    const host = url ? hostnameForLimiter(url) : undefined;
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * Orders rows so every row on the most shared host runs first, then every remaining row on the
 * next most shared host, and so on. A host's rows then finish together early in the run rather
 * than trickling until its end. Ties keep the incoming order, so a run stays reproducible.
 */
export function orderRowsByHostCompletion<T>(planned: PlannedHostRow<T>[]): PlannedHostRow<T>[] {
  const rowsPerHost = new Map<string, number>();
  for (const { hosts } of planned) {
    for (const host of hosts) rowsPerHost.set(host, (rowsPerHost.get(host) ?? 0) + 1);
  }
  const rank = new Map(
    [...rowsPerHost]
      .sort(([hostA, countA], [hostB, countB]) => countB - countA || hostA.localeCompare(hostB))
      .map(([host], index) => [host, index]),
  );
  const firstRank = ({ hosts }: PlannedHostRow<T>) =>
    Math.min(Number.POSITIVE_INFINITY, ...[...hosts].map((host) => rank.get(host) ?? Infinity));
  return planned
    .map((entry, index) => ({ entry, index, key: firstRank(entry) }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
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
