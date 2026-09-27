import type net from 'net';
import { writeLine } from './brokerWire';

export interface SweepPageRecord {
  finalUrl: string;
  contentType: string;
  fetchedAt: string;
  gzipBase64: string;
}

export type SweepPageClientMessage =
  | { t: 'page-get'; id: number; key: string }
  | { t: 'page-put'; key: string; permanentRedirect: boolean; page: SweepPageRecord };

export type SweepPageBrokerMessage = { t: 'page'; id: number; page: SweepPageRecord | null };

export interface SweepPageStoreStats {
  lookups: number;
  hits: number;
  stored: number;
  evicted: number;
  rejected: number;
  heldPages: number;
  heldBytes: number;
  peakHeldBytes: number;
  maxBytes: number;
}

interface HeldPage {
  finalUrl: string;
  contentType: string;
  fetchedAt: string;
  gzip: Buffer;
  bytes: number;
  aliases: Set<string>;
}

const RECORD_OVERHEAD_BYTES = 256;

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isSweepPageRecord(value: unknown): value is SweepPageRecord {
  const record = value as SweepPageRecord | undefined;
  return (
    typeof record?.finalUrl === 'string' &&
    typeof record.contentType === 'string' &&
    typeof record.fetchedAt === 'string' &&
    typeof record.gzipBase64 === 'string'
  );
}

export class SweepPageStore {
  private readonly pages = new Map<string, HeldPage>();
  private readonly aliases = new Map<string, string>();
  private readonly hosts: ReadonlySet<string>;
  private heldBytes = 0;
  private peakHeldBytes = 0;
  private readonly counters = { lookups: 0, hits: 0, stored: 0, evicted: 0, rejected: 0 };

  constructor(
    readonly maxBytes: number,
    hosts: Iterable<string>,
  ) {
    this.hosts = new Set(Array.from(hosts, (host) => host.toLowerCase()));
  }

  get(key: string): SweepPageRecord | null {
    this.counters.lookups += 1;
    const target = this.pages.has(key) ? key : this.aliases.get(key);
    const held = target ? this.pages.get(target) : undefined;
    if (!target || !held) return null;
    this.pages.delete(target);
    this.pages.set(target, held);
    this.counters.hits += 1;
    return {
      finalUrl: held.finalUrl,
      contentType: held.contentType,
      fetchedAt: held.fetchedAt,
      gzipBase64: held.gzip.toString('base64'),
    };
  }

  put(key: string, permanentRedirect: boolean, record: SweepPageRecord): boolean {
    const aliasKey = permanentRedirect && key !== record.finalUrl ? key : null;
    if (!this.admits(record.finalUrl) || (aliasKey !== null && !this.admits(aliasKey))) {
      this.counters.rejected += 1;
      return false;
    }
    const gzip = Buffer.from(record.gzipBase64, 'base64');
    const bytes = gzip.length + record.finalUrl.length + RECORD_OVERHEAD_BYTES;
    if (bytes > this.maxBytes) {
      this.counters.rejected += 1;
      return false;
    }
    const previous = this.pages.get(record.finalUrl);
    const aliases = previous?.aliases ?? new Set<string>();
    if (previous) {
      this.pages.delete(record.finalUrl);
      this.heldBytes -= previous.bytes;
    }
    const held: HeldPage = {
      finalUrl: record.finalUrl,
      contentType: record.contentType,
      fetchedAt: record.fetchedAt,
      gzip,
      bytes: bytes + this.aliasBytes(aliases),
      aliases,
    };
    this.pages.set(record.finalUrl, held);
    this.heldBytes += held.bytes;
    if (aliasKey !== null) this.alias(aliasKey, held);
    this.counters.stored += 1;
    this.evictToBound();
    this.peakHeldBytes = Math.max(this.peakHeldBytes, this.heldBytes);
    return this.pages.has(record.finalUrl);
  }

  stats(): SweepPageStoreStats {
    return {
      ...this.counters,
      heldPages: this.pages.size,
      heldBytes: this.heldBytes,
      peakHeldBytes: this.peakHeldBytes,
      maxBytes: this.maxBytes,
    };
  }

  private admits(url: string): boolean {
    const host = hostOf(url);
    return host !== null && this.hosts.has(host);
  }

  private aliasBytes(aliases: Set<string>): number {
    let total = 0;
    for (const alias of aliases) total += alias.length;
    return total;
  }

  private alias(aliasKey: string, held: HeldPage): void {
    const previousTarget = this.aliases.get(aliasKey);
    if (previousTarget === held.finalUrl) return;
    if (previousTarget) {
      const previous = this.pages.get(previousTarget);
      if (previous?.aliases.delete(aliasKey)) {
        previous.bytes -= aliasKey.length;
        this.heldBytes -= aliasKey.length;
      }
    }
    this.aliases.set(aliasKey, held.finalUrl);
    held.aliases.add(aliasKey);
    held.bytes += aliasKey.length;
    this.heldBytes += aliasKey.length;
  }

  private evictToBound(): void {
    while (this.heldBytes > this.maxBytes) {
      const oldest = this.pages.keys().next();
      if (oldest.done) return;
      const held = this.pages.get(oldest.value);
      this.pages.delete(oldest.value);
      if (!held) continue;
      this.heldBytes -= held.bytes;
      for (const alias of held.aliases) this.aliases.delete(alias);
      this.counters.evicted += 1;
    }
  }
}

export function handleSweepPageMessage(
  store: SweepPageStore | undefined,
  socket: net.Socket,
  message: unknown,
): boolean {
  const candidate = message as Partial<SweepPageClientMessage> | undefined;
  if (candidate?.t === 'page-get') {
    const { id, key } = candidate as { id: unknown; key: unknown };
    if (typeof id !== 'number' || !Number.isInteger(id)) return true;
    const page = store && typeof key === 'string' && key ? store.get(key) : null;
    writeLine(socket, { t: 'page', id, page } satisfies SweepPageBrokerMessage);
    return true;
  }
  if (candidate?.t === 'page-put') {
    const { key, permanentRedirect, page } = candidate as {
      key: unknown;
      permanentRedirect: unknown;
      page: unknown;
    };
    if (store && typeof key === 'string' && isSweepPageRecord(page)) {
      store.put(key, permanentRedirect === true, page);
    }
    return true;
  }
  return false;
}
