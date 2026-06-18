import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { fellowshipSchema } from '../server/src/models/fellowship';
import {
  assertScriptApplyAllowed,
  type ScriptApplyGuardResult,
} from '../server/src/scripts/scriptWriteGuards';

// Load environment variables from server/.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

export interface FellowshipImportCliOptions {
  apply: boolean;
  confirmFellowshipImport?: boolean;
  replaceExisting: boolean;
  csvPath?: string;
  output?: string;
}

interface FellowshipImportStats {
  withYearOfStudy: number;
  withTermOfAward: number;
  withPurpose: number;
  withRegions: number;
  withCitizenship: number;
  accepting: number;
}

interface FellowshipImportResult {
  csvPath: string;
  rowCount: number;
  validCount: number;
  existingCount: number;
  deletedCount: number;
  insertedCount: number;
  stats?: FellowshipImportStats;
}

// Top-level regions to extract (skip countries)
const TOP_LEVEL_REGIONS = [
  'Africa',
  'Asia',
  'Europe',
  'Latin America and Caribbean',
  'Middle East & Persian Gulf',
  'North America',
  'Oceania',
];

// Parse semicolon-separated filter values into arrays
function parseFilterValues(value: string | undefined): string[] {
  if (!value || !value.trim()) return [];
  return value.split(';').map(v => v.trim()).filter(Boolean);
}

// Extract top-level regions only (no countries)
function parseRegions(value: string | undefined): string[] {
  const allValues = parseFilterValues(value);
  return allValues.filter(v => TOP_LEVEL_REGIONS.includes(v));
}

// Clean contact email (remove // prefix if present)
function cleanEmail(email: string | undefined): string {
  if (!email) return '';
  return email.replace(/^\/\//, '').trim();
}

// Parse date string to Date object
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr || !dateStr.trim()) return null;

  // Try to parse various date formats
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

// Clean HTML/JavaScript from text content
function cleanText(text: string | undefined): string {
  if (!text) return '';

  // Remove common JavaScript artifacts
  let cleaned = text
    // Remove script tags and their content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove style tags and their content
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Remove HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Remove JavaScript code patterns
    .replace(/function\s*\([^)]*\)\s*\{[\s\S]*?\}/g, '')
    .replace(/var\s+\w+\s*=[\s\S]*?;/g, '')
    .replace(/document\.\w+/g, '')
    .replace(/window\.\w+/g, '')
    // Remove CSS
    .replace(/\{[^}]*\}/g, '')
    // Remove special characters and extra whitespace
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

export interface FellowshipCSVRow {
  index?: string;
  title?: string;
  summary?: string;
  shareable_link?: string;
  can_apply?: string;
  full_description?: string;
  eligibility?: string;
  deadline?: string;
  contact_email?: string;
  complete_text_content?: string;
  'listing_Begin Accepting Applications Date'?: string;
  'listing_Deadline Date (EST Time Zone)'?: string;
  'filter_Current Year of Study'?: string;
  'filter_Term of Award'?: string;
  'filter_Grant or Fellowship Purpose'?: string;
  'filter_Global Region or Country'?: string;
  'filter_Citizenship Status'?: string;
}

export function transformFellowshipRow(row: FellowshipCSVRow) {
  return {
    title: row.title?.trim() || 'Untitled Fellowship',
    competitionType: '',
    summary: row.summary?.trim() || '',
    description: cleanText(row.full_description) || cleanText(row.summary) || '',
    applicationInformation: '',
    eligibility: row.eligibility?.trim() || '',
    restrictionsToUseOfAward: '',
    additionalInformation: '',
    links: [] as { label: string; url: string }[],
    applicationLink: row.shareable_link?.trim() || '',
    isAcceptingApplications: row.can_apply === '1',
    applicationOpenDate: parseDate(row['listing_Begin Accepting Applications Date']),
    deadline: parseDate(row['listing_Deadline Date (EST Time Zone)']),
    contactName: '',
    contactEmail: cleanEmail(row.contact_email),
    contactPhone: '',
    contactOffice: '',
    yearOfStudy: parseFilterValues(row['filter_Current Year of Study']),
    termOfAward: parseFilterValues(row['filter_Term of Award']),
    purpose: parseFilterValues(row['filter_Grant or Fellowship Purpose']),
    globalRegions: parseRegions(row['filter_Global Region or Country']),
    citizenshipStatus: parseFilterValues(row['filter_Citizenship Status']),
    archived: false,
    views: 0,
    favorites: 0,
  };
}

export function parseFellowshipImportArgs(argv: string[]): FellowshipImportCliOptions {
  const options: FellowshipImportCliOptions = {
    apply: false,
    confirmFellowshipImport: false,
    replaceExisting: false,
  };
  const parseRequiredPath = (flag: '--csv' | '--output', value: string | undefined): string => {
    const parsed = value?.trim();
    if (!parsed || parsed.startsWith('--')) throw new Error(`${flag} requires a path`);
    return parsed;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--live') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--replace-existing') {
      options.replaceExisting = true;
      continue;
    }
    if (arg === '--confirm-fellowship-import') {
      options.confirmFellowshipImport = true;
      continue;
    }
    if (arg.startsWith('--confirm-fellowship-import=')) {
      throw new Error('--confirm-fellowship-import does not accept a value');
    }
    if (arg === '--csv') {
      options.csvPath = parseRequiredPath('--csv', argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--csv=')) {
      options.csvPath = parseRequiredPath('--csv', arg.slice('--csv='.length));
      continue;
    }
    if (arg === '--output') {
      options.output = parseRequiredPath('--output', argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredPath('--output', arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown fellowship import argument: ${arg}`);
  }

  return options;
}

export function assertFellowshipImportApplyAllowed(args: {
  apply: boolean;
  confirmFellowshipImport?: boolean;
  csvPath?: string;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): ScriptApplyGuardResult {
  if (args.apply && !args.csvPath) {
    throw new Error('--csv is required when --apply is set for fellowship CSV import');
  }
  if (args.apply && !args.confirmFellowshipImport) {
    throw new Error(
      '--confirm-fellowship-import is required when --apply is set for fellowship CSV import',
    );
  }

  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'fellowship CSV import',
    mongoUrl: args.mongoUrl,
    env: args.env,
  });
}

export function buildFellowshipImportOutput<T extends object>(
  result: T,
  metadata: {
    generatedAt?: string;
    environment?: string;
    db?: string;
    options: FellowshipImportCliOptions;
  },
): T & {
  generatedAt: string;
  environment?: string;
  db?: string;
  options: FellowshipImportCliOptions;
} {
  return {
    generatedAt: metadata.generatedAt || new Date().toISOString(),
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
    ...result,
  };
}

function writeFellowshipImportOutput(result: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

function parseFellowshipCsv(csvPath: string): { rows: FellowshipCSVRow[]; validFellowships: ReturnType<typeof transformFellowshipRow>[]; stats: FellowshipImportStats } {
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rows: FellowshipCSVRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });
  const fellowships = rows.map(transformFellowshipRow);
  const validFellowships = fellowships.filter(f => f.title && f.title !== 'Untitled Fellowship');
  const stats: FellowshipImportStats = {
    withYearOfStudy: validFellowships.filter(f => f.yearOfStudy.length > 0).length,
    withTermOfAward: validFellowships.filter(f => f.termOfAward.length > 0).length,
    withPurpose: validFellowships.filter(f => f.purpose.length > 0).length,
    withRegions: validFellowships.filter(f => f.globalRegions.length > 0).length,
    withCitizenship: validFellowships.filter(f => f.citizenshipStatus.length > 0).length,
    accepting: validFellowships.filter(f => f.isAcceptingApplications).length,
  };

  return { rows, validFellowships, stats };
}

async function importFellowships(options: FellowshipImportCliOptions, mongoUrl: string): Promise<FellowshipImportResult> {
  const csvPath = path.resolve(
    options.csvPath || path.resolve(__dirname, '../web-scraper/fellowships/yale_fellowships.csv'),
  );

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at ${csvPath}`);
  }

  console.log('\n=== Importing Fellowships from CSV ===\n');
  console.log(`CSV Path: ${csvPath}`);
  console.log(`Mode: ${options.apply ? 'APPLY' : 'DRY RUN'}`);

  console.log('Reading CSV file...');
  const { rows, validFellowships, stats } = parseFellowshipCsv(csvPath);
  console.log(`Found ${rows.length} rows in CSV`);
  console.log(`Valid fellowships to import: ${validFellowships.length}`);

  console.log('\nData statistics:');
  console.log(`  - With Year of Study: ${stats.withYearOfStudy}`);
  console.log(`  - With Term of Award: ${stats.withTermOfAward}`);
  console.log(`  - With Purpose: ${stats.withPurpose}`);
  console.log(`  - With Regions: ${stats.withRegions}`);
  console.log(`  - With Citizenship: ${stats.withCitizenship}`);
  console.log(`  - Currently Accepting: ${stats.accepting}`);

  console.log('\nConnecting to MongoDB...');
  const connection = await mongoose.createConnection(mongoUrl).asPromise();
  try {
    const FellowshipModel = connection.model('Fellowship', fellowshipSchema, 'fellowships');
    const existingCount = await FellowshipModel.countDocuments();
    console.log(`Existing fellowships in database: ${existingCount}`);

    let deletedCount = 0;
    let insertedCount = 0;
    if (options.apply) {
      if (existingCount > 0 && !options.replaceExisting) {
        throw new Error(
          'Apply mode found existing fellowships. Re-run with --replace-existing to acknowledge the delete-and-replace import.',
        );
      }
      if (existingCount > 0) {
        const deleteResult = await FellowshipModel.deleteMany({});
        deletedCount = deleteResult.deletedCount || 0;
        console.log(`Cleared existing fellowships: ${deletedCount}`);
      }
      const result = await FellowshipModel.insertMany(validFellowships, { ordered: false });
      insertedCount = result.length;
      console.log(`Successfully inserted ${insertedCount} fellowships`);
    } else {
      console.log('Dry run only; no fellowships were deleted or inserted.');
    }

    const sample = validFellowships[0];
    if (sample) {
      console.log('\nSample transformed fellowship:');
      console.log(`  Title: ${sample.title}`);
      console.log(`  Summary: ${sample.summary?.substring(0, 100)}...`);
      console.log(`  Year of Study: ${sample.yearOfStudy?.join(', ')}`);
      console.log(`  Term of Award: ${sample.termOfAward?.join(', ')}`);
      console.log(`  Purpose: ${sample.purpose?.join(', ')}`);
      console.log(`  Regions: ${sample.globalRegions?.join(', ')}`);
      console.log(`  Citizenship: ${sample.citizenshipStatus?.join(', ')}`);
    }

    return {
      csvPath,
      rowCount: rows.length,
      validCount: validFellowships.length,
      existingCount,
      deletedCount,
      insertedCount,
      stats,
    };
  } finally {
    await connection.close();
  }
}

async function main(): Promise<void> {
  const options = parseFellowshipImportArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) {
    console.error('ERROR: MONGODBURL not set in server/.env');
    process.exit(1);
  }
  const guard = assertFellowshipImportApplyAllowed({
    apply: options.apply,
    confirmFellowshipImport: options.confirmFellowshipImport,
    csvPath: options.csvPath,
    mongoUrl,
  });
  const result = await importFellowships(options, mongoUrl);
  const output = buildFellowshipImportOutput(result, {
    environment: guard.environment,
    db: guard.dbLabel,
    options,
  });
  writeFellowshipImportOutput(output, options.output);
  console.log('\nImport command complete!\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
