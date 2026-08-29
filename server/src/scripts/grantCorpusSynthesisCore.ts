import { redactDirectContactInfo } from '../utils/contactRedaction';
import { fullDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import {
  MAX_COVERAGE_SNIPPETS,
  MAX_COVERAGE_SNIPPET_CHARS,
  type CoverageSnippet,
} from '../scrapers/coverageSynthesis';

export const GRANT_CORPUS_SYNTHESIS_SOURCE_NAME = 'grant-corpus-synthesis-llm';

export const GRANT_CORPUS_DESCRIPTION_CONFIDENCE = 0.45;

export const GRANT_SOURCE_NAMES = new Set([
  'nih-reporter',
  'nsf-award-search',
  'neh-funded-projects',
  'doe-osti',
  'federal-award-usaspending',
]);

export const DEFAULT_GRANT_CORPUS_SYNTHESIS_LIMIT = 25;

export interface GrantCorpusSynthesisArgs {
  apply: boolean;
  confirm: boolean;
  limit: number;
  slugs: string[];
  output?: string;
}

export function parseGrantCorpusSynthesisArgs(argv: string[]): GrantCorpusSynthesisArgs {
  const args: GrantCorpusSynthesisArgs = {
    apply: false,
    confirm: false,
    limit: DEFAULT_GRANT_CORPUS_SYNTHESIS_LIMIT,
    slugs: [],
  };
  for (const token of argv) {
    if (token === '--apply') args.apply = true;
    else if (token === '--dry-run') args.apply = false;
    else if (token === '--confirm-grant-corpus-synthesis') args.confirm = true;
    else if (token.startsWith('--limit=')) args.limit = Number(token.slice('--limit='.length));
    else if (token.startsWith('--slugs=')) {
      args.slugs = token
        .slice('--slugs='.length)
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean);
    } else if (token.startsWith('--output=')) args.output = token.slice('--output='.length);
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0)
    args.limit = DEFAULT_GRANT_CORPUS_SYNTHESIS_LIMIT;
  return args;
}

export function assertGrantCorpusSynthesisApplyAllowed(
  args: GrantCorpusSynthesisArgs,
  dbLabel: string,
): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(
      'research-entity:grant-corpus-synthesis apply requires --confirm-grant-corpus-synthesis (writes grounded grant-corpus LLM descriptions)',
    );
  }
  if (!/\/development$/i.test(dbLabel)) {
    throw new Error(
      `research-entity:grant-corpus-synthesis apply is restricted to a Development database (got ${dbLabel})`,
    );
  }
}

interface GrantLike {
  agency?: unknown;
  title?: unknown;
  abstract?: unknown;
  url?: unknown;
}

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function buildGrantCorpusSnippets(
  recentGrants: unknown,
  maxSnippets: number = MAX_COVERAGE_SNIPPETS,
  maxChars: number = MAX_COVERAGE_SNIPPET_CHARS,
): CoverageSnippet[] {
  if (!Array.isArray(recentGrants)) return [];
  const seen = new Set<string>();
  const snippets: CoverageSnippet[] = [];
  for (const grant of recentGrants as GrantLike[]) {
    const title = textOf(grant?.title);
    const abstract = textOf(grant?.abstract);
    const combined = [title, abstract].filter(Boolean).join('. ');
    if (!combined) continue;
    const clean = redactDirectContactInfo(combined).slice(0, maxChars).trim();
    if (clean.length < 20) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const agency = textOf(grant?.agency);
    const url = textOf(grant?.url);
    snippets.push({
      text: clean,
      sourceUrl: url || undefined,
      sourceName: agency ? `${agency} grant` : 'grant',
    });
    if (snippets.length >= maxSnippets) break;
  }
  return snippets;
}

export interface FullDescriptionObservationLike {
  value: unknown;
  sourceName?: string;
}

export function fullDescriptionObservationFilter(input: {
  entityKey?: unknown;
  entityId?: unknown;
  readScope: Record<string, unknown>;
}): Record<string, unknown> {
  const anchors: Record<string, unknown>[] = [];
  if (typeof input.entityKey === 'string' && input.entityKey) {
    anchors.push({ entityKey: input.entityKey });
  }
  if (input.entityId) anchors.push({ entityId: input.entityId });
  return {
    entityType: 'researchEntity',
    field: 'fullDescription',
    ...input.readScope,
    ...(anchors.length > 0 ? { $or: anchors } : { _id: { $in: [] } }),
  };
}

export function entityHasBetterSourcedDescription(
  fullDescriptionObservations: FullDescriptionObservationLike[],
  researchAreas: unknown,
  entityType: unknown,
): boolean {
  return fullDescriptionObservations.some(
    (observation) =>
      typeof observation.sourceName === 'string' &&
      !GRANT_SOURCE_NAMES.has(observation.sourceName) &&
      observation.sourceName !== GRANT_CORPUS_SYNTHESIS_SOURCE_NAME &&
      fullDescriptionQuality(observation.value, researchAreas, entityType).isUseful,
  );
}
