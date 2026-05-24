import type { ScraperEnvironment } from './scraperEnvironment';
import type { ScraperOptions } from './types';

const LLM_REVIEW_GATED_SOURCES = new Set([
  'lab-microsite-description-llm',
  'lab-microsite-undergrad-llm',
]);

const MAX_UNREVIEWED_LLM_APPLY_TARGETS = 25;

export interface ScraperPromotionGuardArgs {
  sourceName: string;
  environment: ScraperEnvironment;
  options: ScraperOptions;
  autoMaterialize: boolean;
  acceptedReviewSlugs?: string[];
}

export interface ScraperPromotionGuardResult {
  options: ScraperOptions;
}

function normalizedSourceName(sourceName: string): string {
  return sourceName.trim().toLowerCase();
}

function normalizeList(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || '').trim()).filter(Boolean)),
  );
}

function isBetaOrProduction(environment: ScraperEnvironment): boolean {
  return environment === 'beta' || environment === 'production';
}

function isNonDryApply(environment: ScraperEnvironment, options: ScraperOptions): boolean {
  return isBetaOrProduction(environment) && !options.dryRun;
}

function parseJsonArtifact(text: string): string[] | null {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return normalizeList(parsed);
    if (parsed && typeof parsed === 'object') {
      const candidate =
        (parsed as any).slugs ||
        (parsed as any).acceptedSlugs ||
        (parsed as any).scraperOnlyValues ||
        (parsed as any).only;
      if (Array.isArray(candidate)) return normalizeList(candidate);
    }
    return null;
  } catch {
    return null;
  }
}

export function parseAcceptedReviewArtifact(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parsedJson = parseJsonArtifact(trimmed);
  if (parsedJson) return parsedJson;

  return normalizeList(
    trimmed
      .split(/[\n,]/)
      .map((line) => line.replace(/#.*/, '').trim())
      .filter(Boolean),
  );
}

function hasBroadLlmScope(options: ScraperOptions): boolean {
  const onlyCount = options.only?.length || 0;
  if (onlyCount === 0) return true;
  if (onlyCount > MAX_UNREVIEWED_LLM_APPLY_TARGETS) return true;
  return Boolean(options.limit && options.limit > MAX_UNREVIEWED_LLM_APPLY_TARGETS);
}

function applyAcceptedReviewSlugs(options: ScraperOptions, slugs: string[]): ScraperOptions {
  const accepted = normalizeList(slugs);
  if (accepted.length === 0) {
    throw new Error('LLM scraper apply requires a non-empty accepted review artifact.');
  }

  const requested = normalizeList(options.only || []);
  if (requested.length > 0) {
    const acceptedSet = new Set(accepted.map((slug) => slug.toLowerCase()));
    const unreviewed = requested.filter((slug) => !acceptedSet.has(slug.toLowerCase()));
    if (unreviewed.length > 0) {
      throw new Error(
        `LLM scraper --only includes slug(s) not present in the accepted review artifact: ${unreviewed.join(', ')}`,
      );
    }
  }

  const only = requested.length > 0 ? requested : accepted;
  return {
    ...options,
    only,
    limit: !options.limit || options.limit > only.length ? only.length : options.limit,
  };
}

export function applyScraperPromotionGuards(
  args: ScraperPromotionGuardArgs,
): ScraperPromotionGuardResult {
  const sourceName = normalizedSourceName(args.sourceName);
  let options: ScraperOptions = { ...args.options };

  if (!isNonDryApply(args.environment, options)) {
    return { options };
  }

  if (sourceName === 'openalex' && options.discoverOpenAlexAuthors) {
    throw new Error(
      'OpenAlex name discovery is not allowed for non-dry beta or production scraper apply. Use identity-backed OpenAlex only.',
    );
  }

  if (sourceName === 'arxiv' && (!options.only || options.only.length === 0)) {
    if (!args.acceptedReviewSlugs || args.acceptedReviewSlugs.length === 0) {
      throw new Error(
        'arXiv non-dry beta or production apply requires an accepted review artifact (--accepted-review-artifact) with identity targets.',
      );
    }
    options = applyAcceptedReviewSlugs(options, args.acceptedReviewSlugs);
  } else if (sourceName === 'arxiv') {
    if (!args.acceptedReviewSlugs || args.acceptedReviewSlugs.length === 0) {
      throw new Error(
        'arXiv non-dry beta or production apply requires an accepted review artifact (--accepted-review-artifact) with identity targets.',
      );
    }
    options = applyAcceptedReviewSlugs(options, args.acceptedReviewSlugs);
  }

  if (sourceName === 'dept-faculty-roster') {
    const departments = normalizeList(options.only || []).map((department) =>
      department.toLowerCase(),
    );
    const acceptedDepartments = new Set(
      normalizeList(args.acceptedReviewSlugs || []).map((department) => department.toLowerCase()),
    );
    const hasAcceptedCsScope =
      departments.length > 0 &&
      departments.includes('cs') &&
      departments.every((department) => acceptedDepartments.has(department));
    if (departments.length === 0 || (departments.includes('cs') && !hasAcceptedCsScope)) {
      throw new Error(
        'CS roster is not accepted for mass apply; run dept-faculty-roster with a non-CS --only department list or an accepted review artifact for a bounded CS --only run.',
      );
    }
  }

  if (LLM_REVIEW_GATED_SOURCES.has(sourceName)) {
    if (args.acceptedReviewSlugs && args.acceptedReviewSlugs.length > 0) {
      options = applyAcceptedReviewSlugs(options, args.acceptedReviewSlugs);
    } else if (hasBroadLlmScope(options)) {
      throw new Error(
        `Source ${sourceName} requires an accepted review artifact (--accepted-review-artifact) for broad non-dry LLM apply.`,
      );
    }
  }

  return { options };
}
