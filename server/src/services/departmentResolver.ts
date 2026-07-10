/**
 * Canonicalizes free-text department strings (from scrapers) against the Department collection.
 * Maintains an in-memory cache of canonical names + aliases; bypasses fuzzy matching when an exact
 * or alias match is found. Suggests new aliases when a fuzzy match is high-confidence.
 */
import { Department } from '../models/department';

interface DepartmentRow {
  _id: any;
  name: string;
  displayName: string;
  abbreviation: string;
  aliases: string[];
}

interface CanonicalizeResult {
  canonical: string | null;
  matchType: 'exact' | 'alias' | 'fuzzy' | 'none';
  confidence: number;
  suggestedAlias?: string;
}

const cache: {
  byNormalized: Map<string, DepartmentRow>;
  all: DepartmentRow[];
  loadedAt: number | null;
} = {
  byNormalized: new Map(),
  all: [],
  loadedAt: null,
};

const CACHE_TTL_MS = 5 * 60 * 1000;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[&]/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function loadCache(force = false): Promise<void> {
  if (!force && cache.loadedAt && Date.now() - cache.loadedAt < CACHE_TTL_MS) return;
  const rows = await Department.find({}).lean<DepartmentRow[]>();
  cache.all = rows;
  cache.byNormalized.clear();
  for (const row of rows) {
    cache.byNormalized.set(normalize(row.name), row);
    cache.byNormalized.set(normalize(row.displayName), row);
    cache.byNormalized.set(normalize(row.abbreviation), row);
    for (const alias of row.aliases || []) {
      cache.byNormalized.set(normalize(alias), row);
    }
  }
  cache.loadedAt = Date.now();
}

function tokenJaccard(a: string, b: string): number {
  const at = new Set(a.split(' ').filter(Boolean));
  const bt = new Set(b.split(' ').filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter++;
  return inter / (at.size + bt.size - inter);
}

export async function canonicalizeDepartment(raw: string): Promise<CanonicalizeResult> {
  if (!raw || !raw.trim()) {
    return { canonical: null, matchType: 'none', confidence: 0 };
  }
  await loadCache();
  const norm = normalize(raw);
  const direct = cache.byNormalized.get(norm);
  if (direct) {
    return { canonical: direct.name, matchType: 'exact', confidence: 1.0 };
  }
  let best: { row: DepartmentRow; score: number } | null = null;
  for (const row of cache.all) {
    const score = Math.max(
      tokenJaccard(norm, normalize(row.name)),
      tokenJaccard(norm, normalize(row.displayName)),
    );
    if (!best || score > best.score) best = { row, score };
  }
  if (best && best.score >= 0.7) {
    return {
      canonical: best.row.name,
      matchType: 'fuzzy',
      confidence: best.score,
      suggestedAlias: raw,
    };
  }
  return { canonical: null, matchType: 'none', confidence: 0 };
}

export async function registerDepartmentAlias(canonicalName: string, alias: string): Promise<void> {
  await Department.updateOne({ name: canonicalName }, { $addToSet: { aliases: alias } });
  await loadCache(true);
}

export function clearDepartmentResolverCache(): void {
  cache.loadedAt = null;
  cache.byNormalized.clear();
  cache.all = [];
}
