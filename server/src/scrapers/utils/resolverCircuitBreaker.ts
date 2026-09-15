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
 */
export interface ResolverCircuitBreakerOptions {
  /** Distinct hosts that must fail to resolve within the window before tripping. */
  threshold?: number;
  /** Sliding window, in milliseconds, over which distinct failures are counted. */
  windowMs?: number;
  now?: () => number;
}

export const DEFAULT_RESOLVER_BREAKER_THRESHOLD = 5;
export const DEFAULT_RESOLVER_BREAKER_WINDOW_MS = 60_000;

export class ResolverUnhealthyError extends Error {
  readonly hosts: string[];

  constructor(hosts: string[], windowMs: number) {
    super(
      `Resolver looks unhealthy: ${hosts.length} distinct hosts failed to resolve within ${Math.round(
        windowMs / 1000,
      )}s (${hosts.slice(0, 5).join(', ')}${hosts.length > 5 ? ', ...' : ''}). Refusing to record further link deaths.`,
    );
    this.name = 'ResolverUnhealthyError';
    this.hosts = hosts;
    Object.setPrototypeOf(this, ResolverUnhealthyError.prototype);
  }
}

export class ResolverCircuitBreaker {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly failuresByHost = new Map<string, number>();
  private tripped = false;

  constructor(options: ResolverCircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? DEFAULT_RESOLVER_BREAKER_THRESHOLD;
    this.windowMs = options.windowMs ?? DEFAULT_RESOLVER_BREAKER_WINDOW_MS;
    this.now = options.now ?? Date.now;
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
    this.failuresByHost.set(host, this.now());
    this.evict();
    if (this.failuresByHost.size < this.threshold) return;
    this.tripped = true;
    this.assertHealthy();
  }

  assertHealthy(): void {
    if (!this.tripped) return;
    throw new ResolverUnhealthyError([...this.failuresByHost.keys()].sort(), this.windowMs);
  }

  private evict(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [host, at] of this.failuresByHost) {
      if (at < cutoff) this.failuresByHost.delete(host);
    }
  }
}
