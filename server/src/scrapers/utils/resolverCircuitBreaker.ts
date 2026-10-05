/**
 * Refuses to keep recording link deaths while our own resolver is failing.
 *
 * A pass that probes thousands of unrelated hosts has a signal no single retry
 * can match: a genuinely dead host is an isolated failure among successes, while
 * a resolver problem shows up as failures spread across hosts that have nothing
 * to do with each other. #2775 is the case for it - a pass run from a machine with
 * an intermittently failing resolver recorded 154 hosts as dead, and 134 of them
 * answered 200 from a healthy network.
 *
 * Two properties are load-bearing:
 *
 * It counts DISTINCT hosts, not failures. One genuinely absent name probed
 * repeatedly must never trip the breaker, or a single dead host halts every pass.
 *
 * It trips OPEN and stays open. Downgrading and continuing would burn the rest of
 * the pass writing verdicts that verify nothing, which is how the 353-verdict
 * throttling wave in #2762 stayed invisible behind a healthy-looking counter.
 *
 * Distinct failures alone are a signal only while dead hosts are rare in the probe
 * set. A pass that carries recent HEALTHY verdicts forward probes mostly links that
 * were already failing, so it reaches the threshold on a healthy resolver (#4865).
 * A control probe makes the call instead: it trips only when a fixed known-good host
 * also fails, and a passing check clears the window.
 */
export interface ResolverCircuitBreakerOptions {
  /** Distinct hosts that must fail to resolve within the window before tripping. */
  threshold?: number;
  /** Sliding window, in milliseconds, over which distinct failures are counted. */
  windowMs?: number;
  now?: () => number;
  /**
   * Asks a fixed, known-good host whether the resolver works before tripping. Without
   * it the breaker trips on distinct failures alone, which a pass made mostly of
   * already-dead links reaches on a healthy resolver (#4865).
   */
  controlProbe?: ResolverControlProbe;
  sleep?: (ms: number) => Promise<void>;
}

export interface ResolverControlOutcome {
  healthy: boolean;
  detail: string;
}

export type ResolverControlProbe = () => Promise<ResolverControlOutcome>;

export interface ResolverBreakerStats {
  controlChecks: number;
  tripsAvoided: number;
  trips: number;
  knownUnresolvableFailuresIgnored: number;
  lastControl?: string;
}

export const DEFAULT_RESOLVER_BREAKER_THRESHOLD = 5;
export const DEFAULT_RESOLVER_BREAKER_WINDOW_MS = 60_000;

const describeControl = (stats: ResolverBreakerStats | undefined): string => {
  if (!stats || stats.controlChecks === 0) return '';
  return ` The control check failed (${stats.lastControl ?? 'no detail'}) after ${stats.controlChecks} control check(s) and ${stats.tripsAvoided} avoided trip(s).`;
};

export class ResolverUnhealthyError extends Error {
  readonly hosts: string[];

  readonly stats?: ResolverBreakerStats;

  constructor(hosts: string[], windowMs: number, stats?: ResolverBreakerStats) {
    super(
      `Resolver looks unhealthy: ${hosts.length} distinct hosts failed to resolve within ${Math.round(
        windowMs / 1000,
      )}s (${hosts.slice(0, 5).join(', ')}${hosts.length > 5 ? ', ...' : ''}).${describeControl(stats)} Refusing to record further link deaths.`,
    );
    this.name = 'ResolverUnhealthyError';
    this.hosts = hosts;
    if (stats) this.stats = stats;
    Object.setPrototypeOf(this, ResolverUnhealthyError.prototype);
  }
}

export class ResolverCircuitBreaker {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly controlProbe?: ResolverControlProbe;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly failuresByHost = new Map<string, number>();
  private readonly knownUnresolvableHosts = new Set<string>();
  private readonly storedReachableHosts = new Set<string>();
  private readonly counters: ResolverBreakerStats = {
    controlChecks: 0,
    tripsAvoided: 0,
    trips: 0,
    knownUnresolvableFailuresIgnored: 0,
  };
  private verification?: Promise<void>;
  private lastControlAt?: number;
  private tripped = false;

  constructor(options: ResolverCircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? DEFAULT_RESOLVER_BREAKER_THRESHOLD;
    this.windowMs = options.windowMs ?? DEFAULT_RESOLVER_BREAKER_WINDOW_MS;
    this.now = options.now ?? Date.now;
    this.controlProbe = options.controlProbe;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get stats(): ResolverBreakerStats {
    return { ...this.counters };
  }

  /**
   * Records what the store already says about a host. A host whose every stored
   * verdict is a no-status `UNAVAILABLE` failing again changes nothing stored, so it
   * is no evidence about the resolver; one stored reachable verdict anywhere keeps
   * the host counted.
   */
  noteStoredHostVerdict(host: string, storedUnresolvable: boolean): void {
    if (!host) return;
    if (!storedUnresolvable) {
      this.storedReachableHosts.add(host);
      this.knownUnresolvableHosts.delete(host);
      return;
    }
    if (!this.storedReachableHosts.has(host)) this.knownUnresolvableHosts.add(host);
  }

  get isTripped(): boolean {
    return this.tripped;
  }

  /** Distinct hosts currently counted as failing inside the window. */
  get failingHosts(): string[] {
    this.evict();
    return [...this.failuresByHost.keys()].sort();
  }

  /** A host resolved, so it is no longer evidence of a resolver problem. */
  recordSuccess(host: string): void {
    this.failuresByHost.delete(host);
  }

  /**
   * A host failed to resolve. Throws once distinct failures reach the threshold,
   * and keeps throwing, so a caller cannot accidentally continue past it.
   */
  recordFailure(host: string): void {
    this.assertHealthy();
    if (this.knownUnresolvableHosts.has(host)) {
      this.counters.knownUnresolvableFailuresIgnored += 1;
      return;
    }
    this.failuresByHost.set(host, this.now());
    this.evict();
    if (this.failuresByHost.size < this.threshold) return;
    // With a control probe the verdict is deferred to `settle`, which every caller
    // awaits before its next probe.
    if (this.controlProbe) return;
    this.trip();
    this.assertHealthy();
  }

  /**
   * Resolves once no verdict is pending, and throws if the breaker tripped. The
   * control host is asked at most once per window, so a run of dead links pauses
   * the pass until the window allows the next check rather than tripping it or
   * hammering the control host.
   */
  async settle(): Promise<void> {
    while (this.verificationDue || this.verification) {
      this.verification ??= this.verifyAgainstControl().finally(() => {
        this.verification = undefined;
      });
      await this.verification;
    }
    this.assertHealthy();
  }

  assertHealthy(): void {
    if (!this.tripped) return;
    throw new ResolverUnhealthyError(
      [...this.failuresByHost.keys()].sort(),
      this.windowMs,
      this.stats,
    );
  }

  private get verificationDue(): boolean {
    if (this.tripped || !this.controlProbe) return false;
    this.evict();
    return this.failuresByHost.size >= this.threshold;
  }

  private trip(): void {
    this.tripped = true;
    this.counters.trips += 1;
  }

  private async verifyAgainstControl(): Promise<void> {
    const controlProbe = this.controlProbe;
    if (!controlProbe) return;
    const waitMs =
      this.lastControlAt === undefined ? 0 : this.lastControlAt + this.windowMs - this.now();
    if (waitMs > 0) await this.sleep(waitMs);
    if (!this.verificationDue) return;
    const startedAt = this.now();
    this.lastControlAt = startedAt;
    this.counters.controlChecks += 1;
    let outcome: ResolverControlOutcome;
    try {
      outcome = await controlProbe();
    } catch (error) {
      outcome = { healthy: false, detail: `control probe threw: ${String(error)}` };
    }
    this.counters.lastControl = outcome.detail;
    if (!outcome.healthy) {
      this.trip();
      return;
    }
    this.counters.tripsAvoided += 1;
    for (const [host, at] of this.failuresByHost) {
      if (at <= startedAt) this.failuresByHost.delete(host);
    }
  }

  private evict(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [host, at] of this.failuresByHost) {
      if (at < cutoff) this.failuresByHost.delete(host);
    }
  }
}
