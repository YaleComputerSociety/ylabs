import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { fellowshipSchema } from '../server/src/models/fellowship';
import {
  assertSafeWrite,
  ensureReadableFile,
  parseDataOpsArgs,
  resolveCsvPath,
  summarizeValidation,
  type DataOpsOptions,
  validateAndFilterFellowshipDocuments,
  writeSummary,
} from './dataOps';

// Load environment variables from server/.env
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

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
  existingCount: number | null;
  deletedCount: number;
  insertedCount: number;
  finalCount: number | null;
  stats: FellowshipImportStats;
}

// Top-level regions to extract, skipping countries.
const TOP_LEVEL_REGIONS = [
  'Africa',
  'Asia',
  'Europe',
  'Latin America and Caribbean',
  'Middle East & Persian Gulf',
  'North America',
  'Oceania',
];

function parseFilterValues(value: string | undefined): string[] {
  if (!value || !value.trim()) return [];
  return value
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseRegions(value: string | undefined): string[] {
  const allValues = parseFilterValues(value);
  return allValues.filter((v) => TOP_LEVEL_REGIONS.includes(v));
}

function cleanEmail(email: string | undefined): string {
  if (!email) return '';
  return email.replace(/^\/\//, '').trim();
}

function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr || !dateStr.trim()) return null;

  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

function cleanText(text: string | undefined): string {
  if (!text) return '';

  return text
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/function\s*\([^)]*\)\s*\{[\s\S]*?\}/g, '')
    .replace(/var\s+\w+\s*=[\s\S]*?;/g, '')
    .replace(/document\.\w+/g, '')
    .replace(/window\.\w+/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
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

function buildFellowshipImportStats(
  fellowships: ReturnType<typeof transformFellowshipRow>[],
): FellowshipImportStats {
  return {
    withYearOfStudy: fellowships.filter((f) => f.yearOfStudy.length > 0).length,
    withTermOfAward: fellowships.filter((f) => f.termOfAward.length > 0).length,
    withPurpose: fellowships.filter((f) => f.purpose.length > 0).length,
    withRegions: fellowships.filter((f) => f.globalRegions.length > 0).length,
    withCitizenship: fellowships.filter((f) => f.citizenshipStatus.length > 0).length,
    accepting: fellowships.filter((f) => f.isAcceptingApplications).length,
  };
}

function parseFellowshipCsv(csvPath: string): {
  rows: FellowshipCSVRow[];
  fellowships: ReturnType<typeof transformFellowshipRow>[];
} {
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rows: FellowshipCSVRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  return {
    rows,
    fellowships: rows.map(transformFellowshipRow),
  };
}

async function importFellowships(
  options: DataOpsOptions,
  mongoUrl: string,
): Promise<FellowshipImportResult> {
  const csvPath = resolveCsvPath(__dirname, options.csvPath);
  ensureReadableFile(csvPath, 'Fellowship CSV');

  console.log('\n=== Importing Fellowships from CSV ===\n');
  console.log(`Mode: ${options.dryRun ? 'DRY RUN (no database writes)' : 'EXECUTE'}`);
  console.log(`Target: ${options.target || '(not required for dry-run)'}`);
  console.log(`CSV Path: ${csvPath}`);

  console.log('Reading CSV file...');
  const { rows, fellowships } = parseFellowshipCsv(csvPath);
  console.log(`Found ${rows.length} rows in CSV`);

  const { validation, validFellowships } = validateAndFilterFellowshipDocuments(fellowships);
  console.log(`Valid fellowships to import: ${validFellowships.length}`);

  const validationSummary = summarizeValidation(validation);
  console.log('\nValidation:');
  console.log(`  - Errors: ${validationSummary.errors}`);
  console.log(`  - Warnings: ${validationSummary.warnings}`);
  validation.errors.forEach((error) => console.error(`  ERROR: ${error}`));
  validation.warnings.slice(0, 20).forEach((warning) => console.warn(`  WARNING: ${warning}`));
  if (validation.warnings.length > 20) {
    console.warn(
      `  ... ${validation.warnings.length - 20} additional warnings omitted from console`,
    );
  }

  const stats = buildFellowshipImportStats(validFellowships);
  console.log('\nData statistics:');
  console.log(`  - With Year of Study: ${stats.withYearOfStudy}`);
  console.log(`  - With Term of Award: ${stats.withTermOfAward}`);
  console.log(`  - With Purpose: ${stats.withPurpose}`);
  console.log(`  - With Regions: ${stats.withRegions}`);
  console.log(`  - With Citizenship: ${stats.withCitizenship}`);
  console.log(`  - Currently Accepting: ${stats.accepting}`);

  const summary = {
    mode: options.dryRun ? 'dry-run' : 'execute',
    target: options.target || null,
    csvPath,
    inputRows: rows.length,
    validFellowships: validFellowships.length,
    statistics: stats,
    validation: validationSummary,
  };

  writeSummary(options.summaryPath, summary);

  if (validation.errors.length > 0) {
    throw new Error('Fellowship CSV validation failed; fix errors before importing');
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

  if (options.dryRun) {
    console.log('\nDry run complete. No database writes were made.\n');
    return {
      csvPath,
      rowCount: rows.length,
      validCount: validFellowships.length,
      existingCount: null,
      deletedCount: 0,
      insertedCount: 0,
      finalCount: null,
      stats,
    };
  }

  console.log('\nConnecting to MongoDB...');
  const connection = await mongoose.createConnection(mongoUrl).asPromise();
  try {
    const FellowshipModel = connection.model('Fellowship', fellowshipSchema, 'fellowships');
    const existingCount = await FellowshipModel.countDocuments();
    console.log(`Existing fellowships in database: ${existingCount}`);

    let deletedCount = 0;
    if (existingCount > 0) {
      if (!options.replaceExisting) {
        throw new Error(
          'Refusing to delete existing fellowships without --replace-existing. Run a dry run first.',
        );
      }

      console.log('\nReplacing existing fellowships because --replace-existing was provided.');
      const deleteResult = await FellowshipModel.deleteMany({});
      deletedCount = deleteResult.deletedCount || 0;
      console.log(`Cleared existing fellowships: ${deletedCount}`);
    }

    console.log('Inserting fellowships...');
    const result = await FellowshipModel.insertMany(validFellowships, { ordered: false });
    const insertedCount = result.length;
    console.log(`Successfully inserted ${insertedCount} fellowships`);

    const finalCount = await FellowshipModel.countDocuments();
    console.log(`Total fellowships in database: ${finalCount}`);

    writeSummary(options.summaryPath, {
      ...summary,
      existingCount,
      deletedCount,
      insertedCount,
      finalCount,
    });

    return {
      csvPath,
      rowCount: rows.length,
      validCount: validFellowships.length,
      existingCount,
      deletedCount,
      insertedCount,
      finalCount,
      stats,
    };
  } finally {
    await connection.close();
  }
}

async function main(): Promise<void> {
  const options = parseDataOpsArgs(process.argv.slice(2));

  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) {
    console.error('ERROR: MONGODBURL not set in server/.env');
    process.exit(1);
  }
  assertSafeWrite(options, 'Fellowship import', { mongodbUrl: mongoUrl });

  await importFellowships(options, mongoUrl);
  console.log('\nImport command complete!\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
