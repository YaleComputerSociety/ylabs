import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SourceLinkHealth } from '../services/sourceLinkHealth';

/**
 * Probe results a link-health run can hand to the next dry run on this machine, so repeated
 * previews do not re-request the same links (#6214). An apply writes here but never reads, so a
 * stored verdict is always written from a probe of that run.
 */
export interface CachedSourceLinkProbe {
  health: SourceLinkHealth;
  probedAt: string;
}

export const SOURCE_LINK_PROBE_CACHE_RETENTION_MS = 7 * 24 * 60 * 60_000;

export function defaultSourceLinkProbeCachePath(): string {
  return (
    process.env.YLABS_LINK_HEALTH_PROBE_CACHE ||
    path.join(os.homedir(), '.cache', 'ylabs', 'link-health-probes.json')
  );
}

export function readSourceLinkProbeCache(file: string): Map<string, CachedSourceLinkProbe> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const cache = new Map<string, CachedSourceLinkProbe>();
    for (const [url, value] of Object.entries(parsed ?? {})) {
      const entry = value as Partial<CachedSourceLinkProbe> | null;
      if (
        entry?.health &&
        typeof entry.health.healthStatus === 'string' &&
        typeof entry.probedAt === 'string' &&
        Number.isFinite(Date.parse(entry.probedAt))
      ) {
        cache.set(url, { health: entry.health, probedAt: entry.probedAt });
      }
    }
    return cache;
  } catch {
    return new Map();
  }
}

/**
 * Merges this run's probes over what is on disk and drops entries past the retention window.
 * Written to a temporary file and renamed, so a concurrent reader never sees half a file.
 */
export function writeSourceLinkProbeCache(
  file: string,
  fresh: ReadonlyMap<string, CachedSourceLinkProbe>,
  now: Date = new Date(),
): void {
  if (fresh.size === 0) return;
  const merged = readSourceLinkProbeCache(file);
  for (const [url, entry] of fresh) merged.set(url, entry);
  const kept: Record<string, CachedSourceLinkProbe> = {};
  for (const [url, entry] of merged) {
    if (now.getTime() - Date.parse(entry.probedAt) <= SOURCE_LINK_PROBE_CACHE_RETENTION_MS) {
      kept[url] = entry;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(kept));
  fs.renameSync(temporary, file);
}
