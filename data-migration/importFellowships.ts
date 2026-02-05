import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { Fellowship, fellowshipSchema } from '../server/src/models/fellowship';

// Load environment variables from server/.env
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

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

interface CSVRow {
  index: string;
  title: string;
  summary: string;
  shareable_link: string;
  can_apply: string;
  full_description: string;
  eligibility: string;
  deadline: string;
  contact_email: string;
  complete_text_content: string;
  'listing_Begin Accepting Applications Date': string;
  'listing_Deadline Date (EST Time Zone)': string;
  'filter_Current Year of Study': string;
  'filter_Term of Award': string;
  'filter_Grant or Fellowship Purpose': string;
  'filter_Global Region or Country': string;
  'filter_Citizenship Status': string;
}

function transformRow(row: CSVRow) {
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

async function importFellowships() {
  const mongoUrl = process.env.MONGODBURL;

  if (!mongoUrl) {
    console.error('ERROR: MONGODBURL not set in environment');
    process.exit(1);
  }

  const csvPath = path.resolve(__dirname, '../web-scraper/fellowships/yale_fellowships.csv');

  if (!fs.existsSync(csvPath)) {
    console.error(`ERROR: CSV file not found at ${csvPath}`);
    process.exit(1);
  }

  console.log('\n=== Importing Fellowships from CSV ===\n');
  console.log(`CSV Path: ${csvPath}`);

  try {
    // Read and parse CSV
    console.log('Reading CSV file...');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const rows: CSVRow[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    });

    console.log(`Found ${rows.length} rows in CSV`);

    // Transform rows to fellowship documents
    console.log('Transforming data...');
    const fellowships = rows.map(transformRow);

    // Filter out any fellowships without titles
    const validFellowships = fellowships.filter(f => f.title && f.title !== 'Untitled Fellowship');
    console.log(`Valid fellowships to import: ${validFellowships.length}`);

    // Log some statistics
    const withYearOfStudy = validFellowships.filter(f => f.yearOfStudy.length > 0).length;
    const withTermOfAward = validFellowships.filter(f => f.termOfAward.length > 0).length;
    const withPurpose = validFellowships.filter(f => f.purpose.length > 0).length;
    const withRegions = validFellowships.filter(f => f.globalRegions.length > 0).length;
    const withCitizenship = validFellowships.filter(f => f.citizenshipStatus.length > 0).length;
    const accepting = validFellowships.filter(f => f.isAcceptingApplications).length;

    console.log('\nData statistics:');
    console.log(`  - With Year of Study: ${withYearOfStudy}`);
    console.log(`  - With Term of Award: ${withTermOfAward}`);
    console.log(`  - With Purpose: ${withPurpose}`);
    console.log(`  - With Regions: ${withRegions}`);
    console.log(`  - With Citizenship: ${withCitizenship}`);
    console.log(`  - Currently Accepting: ${accepting}`);

    // Connect to MongoDB
    console.log('\nConnecting to MongoDB...');
    const connection = await mongoose.createConnection(mongoUrl).asPromise();
    const FellowshipModel = connection.model('fellowships', fellowshipSchema);

    // Check existing count
    const existingCount = await FellowshipModel.countDocuments();
    console.log(`Existing fellowships in database: ${existingCount}`);

    // Ask for confirmation before proceeding
    if (existingCount > 0) {
      console.log('\nWARNING: This will DELETE all existing fellowships and replace them.');
      console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));

      console.log('Clearing existing fellowships...');
      await FellowshipModel.deleteMany({});
    }

    // Insert fellowships
    console.log('Inserting fellowships...');
    const result = await FellowshipModel.insertMany(validFellowships, { ordered: false });
    console.log(`Successfully inserted ${result.length} fellowships`);

    // Verify
    const finalCount = await FellowshipModel.countDocuments();
    console.log(`Total fellowships in database: ${finalCount}`);

    // Show sample fellowship
    const sample = await FellowshipModel.findOne().lean();
    console.log('\nSample fellowship:');
    console.log(`  Title: ${sample?.title}`);
    console.log(`  Summary: ${sample?.summary?.substring(0, 100)}...`);
    console.log(`  Year of Study: ${sample?.yearOfStudy?.join(', ')}`);
    console.log(`  Term of Award: ${sample?.termOfAward?.join(', ')}`);
    console.log(`  Purpose: ${sample?.purpose?.join(', ')}`);
    console.log(`  Regions: ${sample?.globalRegions?.join(', ')}`);
    console.log(`  Citizenship: ${sample?.citizenshipStatus?.join(', ')}`);

    // Close connection
    await connection.close();
    console.log('\nImport complete!\n');

  } catch (error) {
    console.error('Error during import:', error);
    process.exit(1);
  }
}

importFellowships().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
