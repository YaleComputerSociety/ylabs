import fs from 'fs';
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

const VALID_TARGETS = new Set<DataOpsTarget>(['local', 'test', 'dev', 'beta', 'prod']);

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
        options.summaryPath = path.resolve(readFlagValue(argv, i, arg));
        i += 1;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export function assertSafeWrite(options: DataOpsOptions, operationName: string) {
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
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
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
