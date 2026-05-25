import fs from 'fs';
import path from 'path';

export type BetaDataQualitySeverity = 'ok' | 'warn' | 'error';
export type DataQualityWarningClassification =
  | 'must_fix_before_promotion'
  | 'accepted_release_warning'
  | 'post_promotion_backlog';

export interface BetaDataQualityOptions {
  strict: boolean;
  output?: string;
  days: number;
  liveLinks: boolean;
  linkSampleSize: number;
  includeSamples: boolean;
}

export interface BetaDataQualityCheck {
  name: string;
  severity: Exclude<BetaDataQualitySeverity, 'ok'>;
  count: number;
  message: string;
  target: number | string;
  classification?: DataQualityWarningClassification;
  owner?: string;
  nextCommand?: string;
}

export interface BetaDataQualitySummary {
  status: BetaDataQualitySeverity;
  errorCount: number;
  warnCount: number;
  errors: BetaDataQualityCheck[];
  warnings: BetaDataQualityCheck[];
}

export interface BetaDataQualityScorecard {
  generatedAt: string;
  mongoTarget: string;
  options?: BetaDataQualityOptions;
  summary: BetaDataQualitySummary;
  counts?: Record<string, number>;
  [key: string]: unknown;
}

export interface ReferenceAuditInput {
  name: string;
  required: boolean;
  missingRequired: number;
  orphanedPresentRefs: number;
}

export interface ReferenceAuditItem extends ReferenceAuditInput {
  missingRequired: number;
  orphanedPresentRefs: number;
  failureCount: number;
  severity: BetaDataQualitySeverity;
}

export interface ReferenceIntegritySummary {
  items: ReferenceAuditItem[];
  missingRequiredTotal: number;
  orphanedPresentRefTotal: number;
  hardFailureTotal: number;
}

export interface BetaDataQualitySummaryInput {
  referenceHardFailures: number;
  invalidUrlCount: number;
  invalidEmailCount?: number;
  expiredOpenOpportunityCount: number;
  paperAuthorshipIntegrityFailures: number;
  sourceHealthErrors: number;
  sourceHealthWarnings: number;
  duplicateEntityClusterCount: number;
  researchEntityContentPageLeakCount?: number;
  missingShortDescriptionCount: number;
  weakShortDescriptionCount: number;
  suspiciousUserEmailCount: number;
  retentionCandidateCount: number;
  liveLinkFailureCount?: number;
  coverageGaps: {
    withoutPathways: number;
    withoutAccessSignals: number;
    withoutContactRoutes: number;
  };
}

export interface LinkCandidateInput {
  value?: unknown;
  source: string;
}

export interface LiveLinkCandidate {
  url: string;
  sources: string[];
}

export interface ResearchEntityContentPageLeakInput {
  id?: string;
  name?: string;
  displayName?: string;
  slug?: string;
  kind?: string;
  entityType?: string;
  website?: string;
  websiteUrl?: string;
  sourceUrls?: string[];
}

export interface ResearchEntityContentPageLeakSample extends ResearchEntityContentPageLeakInput {
  id: string;
  name: string;
  reasons: string[];
}

export interface ResearchEntityContentPageLeakSummary {
  count: number;
  samples: ResearchEntityContentPageLeakSample[];
}

const BETA_WARNING_OPERATOR_METADATA: Record<
  string,
  Pick<BetaDataQualityCheck, 'classification' | 'owner' | 'nextCommand'>
> = {
  sourceHealthWarnings: {
    classification: 'must_fix_before_promotion',
    owner: 'scraper-source operator',
    nextCommand:
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
  },
  duplicateEntityNames: {
    classification: 'must_fix_before_promotion',
    owner: 'data-quality operator',
    nextCommand: 'yarn --cwd server research-entity:dedupe-by-pi --limit=10000',
  },
  missingShortDescriptions: {
    classification: 'accepted_release_warning',
    owner: 'content-quality operator',
    nextCommand:
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
  },
  weakShortDescriptions: {
    classification: 'post_promotion_backlog',
    owner: 'content-quality operator',
    nextCommand:
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
  },
  coverageWithoutPathways: {
    classification: 'accepted_release_warning',
    owner: 'pathway coverage operator',
    nextCommand:
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
  },
  coverageWithoutAccessSignals: {
    classification: 'accepted_release_warning',
    owner: 'pathway coverage operator',
    nextCommand:
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
  },
  coverageWithoutContactRoutes: {
    classification: 'accepted_release_warning',
    owner: 'contact coverage operator',
    nextCommand:
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
  },
  suspiciousUserEmails: {
    classification: 'must_fix_before_promotion',
    owner: 'identity/account operator',
    nextCommand:
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
  },
};

export function parseBetaDataQualityArgs(argv: string[]): BetaDataQualityOptions {
  const options: BetaDataQualityOptions = {
    strict: false,
    days: 30,
    liveLinks: false,
    linkSampleSize: 50,
    includeSamples: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--live-links') {
      options.liveLinks = true;
      continue;
    }
    if (arg === '--include-samples') {
      options.includeSamples = true;
      continue;
    }
    if (arg === '--output') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--output requires a path');
      }
      options.output = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      const output = arg.slice('--output='.length);
      if (!output) {
        throw new Error('--output requires a path');
      }
      options.output = output;
      continue;
    }
    if (arg.startsWith('--days=')) {
      options.days = parsePositiveIntegerFlag(arg, '--days=');
      continue;
    }
    if (arg === '--days') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--days requires a number');
      }
      options.days = parsePositiveIntegerValue(next, '--days');
      index += 1;
      continue;
    }
    if (arg.startsWith('--link-sample-size=')) {
      options.linkSampleSize = parsePositiveIntegerFlag(arg, '--link-sample-size=');
      continue;
    }
    if (arg === '--link-sample-size') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--link-sample-size requires a number');
      }
      options.linkSampleSize = parsePositiveIntegerValue(next, '--link-sample-size');
      index += 1;
      continue;
    }
    throw new Error(`Unknown beta:data-quality option: ${arg}`);
  }

  return options;
}

export function isInvalidOptionalUrl(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'string') {
    return true;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol !== 'http:' && parsed.protocol !== 'https:';
  } catch {
    return true;
  }
}

export function isInvalidObservationSourceUrl(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'string') {
    return true;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return (
      parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'file:'
    );
  } catch {
    return true;
  }
}

export function isInvalidOptionalEmail(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'string') {
    return true;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(trimmed);
}

export function buildReferenceIntegritySummary(
  inputs: ReferenceAuditInput[],
): ReferenceIntegritySummary {
  const items = inputs.map((input) => {
    const missingRequired = input.required ? Math.max(0, input.missingRequired) : 0;
    const orphanedPresentRefs = Math.max(0, input.orphanedPresentRefs);
    const failureCount = missingRequired + orphanedPresentRefs;
    return {
      ...input,
      missingRequired,
      orphanedPresentRefs,
      failureCount,
      severity: failureCount > 0 ? 'error' : 'ok',
    } satisfies ReferenceAuditItem;
  });

  const missingRequiredTotal = items.reduce((total, item) => total + item.missingRequired, 0);
  const orphanedPresentRefTotal = items.reduce(
    (total, item) => total + item.orphanedPresentRefs,
    0,
  );

  return {
    items,
    missingRequiredTotal,
    orphanedPresentRefTotal,
    hardFailureTotal: missingRequiredTotal + orphanedPresentRefTotal,
  };
}

export function buildBetaDataQualitySummary(
  input: BetaDataQualitySummaryInput,
): BetaDataQualitySummary {
  const errors = compactChecks([
    buildCheck(
      'referenceIntegrity',
      'error',
      input.referenceHardFailures,
      'Broken required references or orphaned present references need repair.',
      0,
    ),
    buildCheck(
      'urlSyntax',
      'error',
      input.invalidUrlCount,
      'Invalid URL syntax found in optional URL fields.',
      0,
    ),
    buildCheck(
      'emailSyntax',
      'error',
      input.invalidEmailCount ?? 0,
      'Invalid email syntax found in email fields.',
      0,
    ),
    buildCheck(
      'expiredOpenOpportunities',
      'error',
      input.expiredOpenOpportunityCount,
      'Open posted opportunities have deadlines in the past.',
      0,
    ),
    buildCheck(
      'paperAuthorship',
      'error',
      input.paperAuthorshipIntegrityFailures,
      'Paper-authorship integrity audit found hard failures.',
      0,
    ),
    buildCheck(
      'sourceHealthErrors',
      'error',
      input.sourceHealthErrors,
      'Source health has error-risk sources.',
      0,
    ),
  ]);

  const warnings = compactChecks([
    buildCheck(
      'sourceHealthWarnings',
      'warn',
      input.sourceHealthWarnings,
      'Source health has warning-risk sources.',
      0,
    ),
    buildCheck(
      'duplicateEntityNames',
      'warn',
      input.duplicateEntityClusterCount,
      'Research entities share normalized names and need review before merging.',
      0,
    ),
    buildCheck(
      'researchEntityContentPageLeaks',
      'warn',
      input.researchEntityContentPageLeakCount ?? 0,
      'Active research entities look like blogs, news, events, or other content pages rather than research homes.',
      0,
    ),
    buildCheck(
      'missingShortDescriptions',
      'warn',
      input.missingShortDescriptionCount,
      'Research entities are missing student-facing short descriptions.',
      0,
    ),
    buildCheck(
      'weakShortDescriptions',
      'warn',
      input.weakShortDescriptionCount,
      'Research entities have very short descriptions that may be weak.',
      0,
    ),
    buildCheck(
      'coverageWithoutPathways',
      'warn',
      input.coverageGaps.withoutPathways,
      'Active research entities do not yet have entry pathways.',
      0,
    ),
    buildCheck(
      'coverageWithoutAccessSignals',
      'warn',
      input.coverageGaps.withoutAccessSignals,
      'Active research entities do not yet have access signals.',
      0,
    ),
    buildCheck(
      'coverageWithoutContactRoutes',
      'warn',
      input.coverageGaps.withoutContactRoutes,
      'Active research entities do not yet have contact routes.',
      0,
    ),
    buildCheck(
      'suspiciousUserEmails',
      'warn',
      input.suspiciousUserEmailCount,
      'User emails look synthetic, placeholder, or otherwise suspicious.',
      0,
    ),
    buildCheck(
      'retentionCandidates',
      'warn',
      input.retentionCandidateCount,
      'Superseded scraper observations are eligible for compact retention pruning.',
      0,
    ),
    buildCheck(
      'liveLinkFailures',
      'warn',
      input.liveLinkFailureCount ?? 0,
      'Sampled live links did not return a successful response.',
      0,
    ),
  ]);

  return {
    status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'ok',
    errorCount: errors.length,
    warnCount: warnings.length,
    errors,
    warnings,
  };
}

export function shouldStrictModeFail(summary: BetaDataQualitySummary): boolean {
  return summary.errorCount > 0;
}

const CONTENT_PAGE_TITLE_RE =
  /\b(blog|news|event|events|calendar|newsletter|article|story|press release|podcast|video|webinar)\b/i;
const CONTENT_PAGE_PATH_RE =
  /(^|[-/])(blog|blogs|news|events|calendar|newsletter|article|stories|press|podcast|video|webinar)([-/]|$)/i;

function normalizedContentPageTitleText(entity: ResearchEntityContentPageLeakInput): string {
  return [entity.displayName, entity.name, entity.slug]
    .map((value) => String(value || ''))
    .join(' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim();
}

function contentPageUrlPathText(values: Array<string | undefined>): string {
  return values
    .flatMap((value) => {
      if (!value) return [];
      try {
        return [new URL(value).pathname];
      } catch {
        return [value];
      }
    })
    .join(' ');
}

export function isLikelyResearchEntityContentPageLeak(
  entity: ResearchEntityContentPageLeakInput,
): string[] {
  const reasons: string[] = [];
  const titleText = normalizedContentPageTitleText(entity);
  const pathText = contentPageUrlPathText([
    entity.websiteUrl,
    entity.website,
    ...(entity.sourceUrls || []),
  ]);

  if (CONTENT_PAGE_TITLE_RE.test(titleText)) {
    reasons.push('content-page-title');
  }
  if (CONTENT_PAGE_PATH_RE.test(pathText)) {
    reasons.push('content-page-url');
  }
  if (
    reasons.length > 0 &&
    (String(entity.kind || '').toLowerCase() === 'lab' || entity.entityType === 'LAB')
  ) {
    reasons.push('content-page-classified-as-lab');
  }

  return reasons;
}

export function buildResearchEntityContentPageLeakSummary(
  entities: ResearchEntityContentPageLeakInput[],
  sampleLimit = 25,
): ResearchEntityContentPageLeakSummary {
  const samples: ResearchEntityContentPageLeakSample[] = [];
  let count = 0;

  for (const entity of entities) {
    const reasons = isLikelyResearchEntityContentPageLeak(entity);
    if (reasons.length === 0) continue;
    count += 1;
    if (samples.length < sampleLimit) {
      samples.push({
        ...entity,
        id: String(entity.id || ''),
        name: String(entity.displayName || entity.name || ''),
        reasons,
      });
    }
  }

  return { count, samples };
}

export function selectLiveLinkCandidates(
  inputs: LinkCandidateInput[],
  sampleSize: number,
): LiveLinkCandidate[] {
  const byUrl = new Map<string, LiveLinkCandidate>();

  for (const input of inputs) {
    if (isInvalidOptionalUrl(input.value) || typeof input.value !== 'string') {
      continue;
    }
    const url = input.value.trim();
    if (!url) {
      continue;
    }
    const existing = byUrl.get(url);
    if (existing) {
      if (!existing.sources.includes(input.source)) {
        existing.sources.push(input.source);
      }
      continue;
    }
    byUrl.set(url, { url, sources: [input.source] });
  }

  return [...byUrl.values()].slice(0, sampleSize);
}

export function writeScorecardOutput(
  scorecard: BetaDataQualityScorecard,
  outputPath?: string,
): void {
  if (!outputPath) {
    return;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(scorecard, null, 2)}\n`);
}

function compactChecks(checks: Array<BetaDataQualityCheck | null>): BetaDataQualityCheck[] {
  return checks.filter((check): check is BetaDataQualityCheck => check !== null);
}

function buildCheck(
  name: string,
  severity: Exclude<BetaDataQualitySeverity, 'ok'>,
  count: number,
  message: string,
  target: number | string,
): BetaDataQualityCheck | null {
  if (count <= 0) {
    return null;
  }
  return {
    name,
    severity,
    count,
    message,
    target,
    ...(severity === 'warn' ? BETA_WARNING_OPERATOR_METADATA[name] : undefined),
  };
}

function parsePositiveIntegerFlag(arg: string, prefix: string): number {
  return parsePositiveIntegerValue(arg.slice(prefix.length), prefix.replace(/=$/, ''));
}

function parsePositiveIntegerValue(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed.toString() !== value) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}
