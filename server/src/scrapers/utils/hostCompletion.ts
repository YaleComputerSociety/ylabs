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
