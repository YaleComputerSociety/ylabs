import fs from 'fs';
import os from 'os';
import path from 'path';

export type DataOpsTarget = 'local' | 'test' | 'dev' | 'beta' | 'prod';

export interface DataOpsOptions {
  dryRun: boolean;
  execute: boolean;
  target?: DataOpsTarget;
  allowProduction: boolean;
  confirmProduction: boolean;
  replaceExisting: boolean;
  csvPath?: string;
  summaryPath?: string;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export interface DataOpsDestinations {
  mongodbUrl?: string;
  meilisearchHost?: string;
  meilisearchIndexPrefix?: string;
}

const VALID_TARGETS = new Set<DataOpsTarget>(['local', 'test', 'dev', 'beta', 'prod']);
const TARGET_DATABASE_NAMES: Record<DataOpsTarget, string[]> = {
  local: ['development', 'local', 'ylabs'],
  test: ['test'],
  dev: ['development', 'dev'],
  beta: ['beta'],
  prod: ['production', 'prod'],
};

const hasPathPrefix = (target: string, root: string): boolean =>
  target === root || target.startsWith(`${root}${path.sep}`);

export function resolveSafeSummaryPath(value: string | undefined): string {
  const summaryPath = value?.trim();
  if (!summaryPath || summaryPath.startsWith('--')) {
    throw new Error('--summary requires a path');
  }
  if (/[\u0000-\u001f\u007f]/.test(summaryPath)) {
    throw new Error('--summary path contains invalid characters');
  }

  const resolved = path.resolve(summaryPath);
  if (path.extname(resolved).toLowerCase() !== '.json') {
    throw new Error('--summary must point to a .json report file');
  }

  const tmpRoot = path.resolve(os.tmpdir());
  const projectTmpRoot = path.resolve(process.cwd(), 'tmp');
  if (!hasPathPrefix(resolved, tmpRoot) && !hasPathPrefix(resolved, projectTmpRoot)) {
    throw new Error(`--summary must write under ${tmpRoot} or ./tmp`);
  }

  return resolved;
}

function parseMongoDestination(url: string): { host: string; database: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('MONGODBURL is not a valid connection string');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] || '');
  if (!database) {
    throw new Error('MONGODBURL must include an explicit database name for write safety');
  }

  return {
    host: parsed.hostname.toLowerCase(),
    database: database.toLowerCase(),
  };
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function assertMongoTargetMatches(
  target: DataOpsTarget,
  mongodbUrl: string,
  operationName: string,
) {
  const destination = parseMongoDestination(mongodbUrl);
  const allowedNames = TARGET_DATABASE_NAMES[target];
  const isAllowedDatabase = allowedNames.includes(destination.database);
  const isLocalTarget = target === 'local' && isLocalHost(destination.host);

  if (!isAllowedDatabase && !isLocalTarget) {
    throw new Error(
      `${operationName} target ${target} does not match MongoDB database "${destination.database}"`,
    );
  }
}

function assertMeilisearchTargetMatches(
  target: DataOpsTarget,
  meilisearchHost: string,
  meilisearchIndexPrefix: string | undefined,
  operationName: string,
) {
  let host: string;
  try {
    host = new URL(meilisearchHost).hostname.toLowerCase();
  } catch {
    throw new Error('MEILISEARCH_HOST is not a valid URL');
  }

  const prefix = meilisearchIndexPrefix || '';

  if (target === 'local') {
    if (!isLocalHost(host) || prefix) {
      throw new Error(
        `${operationName} target local requires local Meilisearch with no index prefix`,
      );
    }
    return;
  }

  if (target !== prefix) {
    throw new Error(
      `${operationName} target ${target} does not match Meilisearch index prefix "${prefix || '(unset)'}"`,
    );
  }
}

function assertDestinationMatchesTarget(
  options: DataOpsOptions,
  operationName: string,
  destinations?: DataOpsDestinations,
) {
  if (!options.target) return;

  if (!destinations?.mongodbUrl && !destinations?.meilisearchHost) {
    throw new Error(`${operationName} writes require resolved destination metadata`);
  }

  if (destinations.mongodbUrl) {
    assertMongoTargetMatches(options.target, destinations.mongodbUrl, operationName);
  }

  if (destinations.meilisearchHost) {
    assertMeilisearchTargetMatches(
      options.target,
      destinations.meilisearchHost,
      destinations.meilisearchIndexPrefix,
      operationName,
    );
  }
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseDataOpsArgs(argv: string[]): DataOpsOptions {
  const options: DataOpsOptions = {
    dryRun: true,
    execute: false,
    allowProduction: false,
    confirmProduction: false,
    replaceExisting: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        options.execute = false;
        break;
      case '--execute':
        options.execute = true;
        options.dryRun = false;
        break;
      case '--allow-production':
        options.allowProduction = true;
        break;
      case '--confirm-production':
        options.confirmProduction = true;
        break;
      case '--replace-existing':
        options.replaceExisting = true;
        break;
      case '--target': {
        const target = readFlagValue(argv, i, arg) as DataOpsTarget;
        if (!VALID_TARGETS.has(target)) {
          throw new Error(`--target must be one of: ${Array.from(VALID_TARGETS).join(', ')}`);
        }
        options.target = target;
        i += 1;
        break;
      }
      case '--csv': {
        options.csvPath = path.resolve(readFlagValue(argv, i, arg));
        i += 1;
        break;
      }
      case '--summary': {
        options.summaryPath = resolveSafeSummaryPath(readFlagValue(argv, i, arg));
        i += 1;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export function assertSafeWrite(
  options: DataOpsOptions,
  operationName: string,
  destinations?: DataOpsDestinations,
) {
  if (options.dryRun) return;

  if (!options.execute) {
    throw new Error(`${operationName} is not in dry-run mode but --execute was not provided`);
  }

  if (!options.target) {
    throw new Error(`${operationName} writes require --target local|test|dev|beta|prod`);
  }

  if (options.target === 'prod' && (!options.allowProduction || !options.confirmProduction)) {
    throw new Error(
      `${operationName} refuses prod writes without --allow-production --confirm-production`,
    );
  }

  assertDestinationMatchesTarget(options, operationName, destinations);
}

export function resolveCsvPath(scriptDir: string, explicitPath?: string): string {
  return explicitPath || path.resolve(scriptDir, '../web-scraper/fellowships/yale_fellowships.csv');
}

export function ensureReadableFile(filePath: string, label: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file not found at ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`${label} path is not a file: ${filePath}`);
  }

  if (stat.size === 0) {
    throw new Error(`${label} file is empty: ${filePath}`);
  }
}

export function maskConnectionString(value: string | undefined): string {
  if (!value) return '(unset)';
  return value.replace(/\/\/([^:/?#]+):([^@/?#]+)@/, '//***:***@');
}

export function summarizeValidation(result: ValidationResult) {
  return {
    errors: result.errors.length,
    warnings: result.warnings.length,
    errorMessages: result.errors,
    warningMessages: result.warnings,
  };
}

export function writeSummary(summaryPath: string | undefined, summary: unknown) {
  if (!summaryPath) return;
  const safeSummaryPath = resolveSafeSummaryPath(summaryPath);
  fs.mkdirSync(path.dirname(safeSummaryPath), { recursive: true });
  fs.writeFileSync(safeSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
}

export function validateFellowshipDocuments(
  fellowships: Array<{ title?: string; applicationLink?: string; description?: string }>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenTitles = new Set<string>();

  fellowships.forEach((fellowship, index) => {
    const row = index + 1;
    const title = fellowship.title?.trim();

    if (!title || title === 'Untitled Fellowship') {
      errors.push(`row ${row}: missing fellowship title`);
    } else {
      const normalizedTitle = title.toLowerCase();
      if (seenTitles.has(normalizedTitle)) {
        warnings.push(`row ${row}: duplicate fellowship title "${title}"`);
      }
      seenTitles.add(normalizedTitle);
    }

    if (!fellowship.description?.trim()) {
      warnings.push(`row ${row}: missing description`);
    }

    if (!fellowship.applicationLink?.trim()) {
      warnings.push(`row ${row}: missing application link`);
    }
  });

  return { errors, warnings };
}

export function validateAndFilterFellowshipDocuments<
  T extends { title?: string; applicationLink?: string; description?: string },
>(fellowships: T[]): { validation: ValidationResult; validFellowships: T[] } {
  return {
    validation: validateFellowshipDocuments(fellowships),
    validFellowships: fellowships.filter((f) => f.title && f.title !== 'Untitled Fellowship'),
  };
}

export function toMeiliListingDocument(doc: Record<string, any>) {
  const meiliDoc: Record<string, any> = { ...doc, id: doc._id?.toString?.() || doc.id };
  delete meiliDoc._id;
  delete meiliDoc.__v;
  delete meiliDoc.embedding;
  return meiliDoc;
}

export function validateMeiliListingDocuments(docs: Array<Record<string, any>>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  docs.forEach((doc, index) => {
    const row = index + 1;

    if (!doc.id || typeof doc.id !== 'string') {
      errors.push(`document ${row}: missing string id`);
    } else if (seenIds.has(doc.id)) {
      errors.push(`document ${row}: duplicate id "${doc.id}"`);
    } else {
      seenIds.add(doc.id);
    }

    if (!doc.title || typeof doc.title !== 'string') {
      errors.push(`document ${row}: missing title`);
    }

    if (!doc.description || typeof doc.description !== 'string') {
      warnings.push(`document ${row}: missing description`);
    }

    for (const forbiddenField of ['_id', '__v', 'embedding']) {
      if (forbiddenField in doc) {
        errors.push(`document ${row}: contains forbidden field "${forbiddenField}"`);
      }
    }
  });

  return { errors, warnings };
}
