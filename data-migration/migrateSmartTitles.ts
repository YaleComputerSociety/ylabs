import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Listing } from '../server/src/models/listing';
import { Department } from '../server/src/models/department';

// Load environment variables from server/.env
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

// =============================================================================
// CONFIGURATION - Category priorities and suffix mappings
// =============================================================================

enum DepartmentCategory {
  HUMANITIES = "Humanities",
  SOCIAL_SCIENCES = "Social Sciences",
  PHYSICAL_SCIENCES = "Physical Sciences",
  BIOLOGICAL_SCIENCES = "Biological Sciences",
  ENGINEERING = "Engineering",
  HEALTH_MEDICINE = "Health & Medicine"
}

// Category priority order (highest to lowest) for determining suffix
const CATEGORY_PRIORITY: DepartmentCategory[] = [
  DepartmentCategory.ENGINEERING,
  DepartmentCategory.PHYSICAL_SCIENCES,
  DepartmentCategory.BIOLOGICAL_SCIENCES,
  DepartmentCategory.HEALTH_MEDICINE,
  DepartmentCategory.SOCIAL_SCIENCES,
  DepartmentCategory.HUMANITIES,
];

// Suffix mapping by category
const CATEGORY_SUFFIXES: Record<DepartmentCategory, string> = {
  [DepartmentCategory.ENGINEERING]: 'Lab',
  [DepartmentCategory.PHYSICAL_SCIENCES]: 'Lab',
  [DepartmentCategory.BIOLOGICAL_SCIENCES]: 'Lab',
  [DepartmentCategory.HEALTH_MEDICINE]: 'Lab',
  [DepartmentCategory.SOCIAL_SCIENCES]: 'Research Group',
  [DepartmentCategory.HUMANITIES]: 'Project',
};

// Arts/Architecture departments that should use "Studio" suffix
const ARTS_DEPARTMENT_ABBRS = ['ARCH', 'ART', 'FILM', 'DRAM', 'THST'];
const ARTS_SUFFIX = 'Studio';

// Fallback suffix when no department or unknown category
const DEFAULT_SUFFIX = 'Research';

// Common name-based suffixes that indicate a non-custom title
const NAME_BASED_SUFFIXES = [
  'lab', 'laboratory', 'group', 'research', 'research group',
  'studio', 'project', 'team', 'center', 'centre', 'initiative'
];

// =============================================================================
// INTERFACES
// =============================================================================

interface DepartmentDoc {
  abbreviation: string;
  displayName: string;
  categories: DepartmentCategory[];
  primaryCategory: DepartmentCategory;
}

interface MigrationLog {
  listingId: string;
  oldTitle: string;
  newTitle: string;
  reason: 'name-based' | 'empty' | 'placeholder';
  departments: string[];
  determinedCategory: string;
  suffix: string;
}

interface SkippedLog {
  listingId: string;
  title: string;
  reason: 'custom-title' | 'no-departments' | 'missing-owner-info' | 'no-change';
  ownerLastName?: string;
}

// =============================================================================
// HELPER FUNCTIONS - Embedded to avoid import issues in standalone migration
// =============================================================================

/**
 * Normalizes a string for comparison
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[''`]/g, "'")
    .replace(/[^\w\s']/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Escapes special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Determines if a title is custom (should be preserved) or name-based (should be replaced)
 */
function isCustomTitle(title: string, firstName: string, lastName: string): boolean {
  if (!title || !lastName) {
    return false;
  }

  const normalizedTitle = normalizeString(title);
  const normalizedFirstName = normalizeString(firstName || '');
  const normalizedLastName = normalizeString(lastName);

  // If title doesn't contain the last name at all, it's definitely custom
  if (!normalizedTitle.includes(normalizedLastName)) {
    return true;
  }

  const escapedFirstName = escapeRegex(normalizedFirstName);
  const escapedLastName = escapeRegex(normalizedLastName);
  const suffixPattern = NAME_BASED_SUFFIXES.map(s => escapeRegex(s)).join('|');

  const nameBasedPatterns = [
    // "Smith Lab", "The Smith Lab", "Smith's Lab", "Smiths Lab"
    new RegExp(`^(the\\s+)?${escapedLastName}('?s)?\\s+(${suffixPattern})$`, 'i'),
    // "John Smith", "John Michael Smith" (name with middle names)
    new RegExp(`^${escapedFirstName}(\\s+[a-z]+\\.?)*\\s+${escapedLastName}$`, 'i'),
    // First initial: "J Smith", "J. Smith"
    new RegExp(`^${escapedFirstName.charAt(0)}\\.?\\s+(\\w+\\s+)*${escapedLastName}$`, 'i'),
    // Just last name: "Smith"
    new RegExp(`^${escapedLastName}$`, 'i'),
    // "Dr. Smith Lab", "Prof. Smith Lab"
    new RegExp(`^(dr\\.?|prof\\.?|professor)\\s+${escapedLastName}('?s)?\\s+(${suffixPattern})$`, 'i'),
    // "Dr. Smith" (just title + name)
    new RegExp(`^(dr\\.?|prof\\.?|professor)\\s+${escapedLastName}$`, 'i'),
    // "The [LastName] [Suffix]"
    new RegExp(`^the\\s+${escapedLastName}\\s+(${suffixPattern})$`, 'i'),
  ];

  for (const pattern of nameBasedPatterns) {
    if (pattern.test(normalizedTitle)) {
      return false;
    }
  }

  // Check for significant additional descriptive content
  let remainingTitle = normalizedTitle;
  remainingTitle = remainingTitle.replace(new RegExp(`\\b${escapedLastName}\\b`, 'gi'), '');
  remainingTitle = remainingTitle.replace(new RegExp(`\\b(${suffixPattern})\\b`, 'gi'), '');
  remainingTitle = remainingTitle.replace(/\b(the|a|an|of|for|and|in|on|at)\b/gi, '');
  remainingTitle = remainingTitle.replace(/[''`'s]/g, '').trim();

  const remainingWords = remainingTitle.split(/\s+/).filter(w => w.length > 1);

  if (remainingWords.length >= 2) {
    return true;
  }

  return false;
}

/**
 * Extracts department abbreviation from displayName
 */
function extractAbbreviation(displayName: string): string {
  const match = displayName.match(/^([A-Z&/]+)\s*-\s*/);
  if (match) {
    return match[1];
  }
  return displayName.split(/\s+/)[0].toUpperCase();
}

/**
 * Determines the appropriate suffix based on department categories
 */
function determineSuffix(
  departments: string[],
  lookup: Map<string, DepartmentDoc>
): { suffix: string; category: string } {
  const allCategories = new Set<DepartmentCategory>();
  let hasArtsDepartment = false;
  let onlyArtsDepartments = true;

  for (const deptDisplayName of departments) {
    const dept = lookup.get(deptDisplayName);

    if (dept) {
      if (ARTS_DEPARTMENT_ABBRS.includes(dept.abbreviation)) {
        hasArtsDepartment = true;
      } else {
        onlyArtsDepartments = false;
      }

      for (const cat of dept.categories) {
        allCategories.add(cat);
      }
    } else {
      const abbr = extractAbbreviation(deptDisplayName);
      if (ARTS_DEPARTMENT_ABBRS.includes(abbr)) {
        hasArtsDepartment = true;
      } else {
        onlyArtsDepartments = false;
      }
    }
  }

  if (hasArtsDepartment && onlyArtsDepartments && allCategories.size === 0) {
    return { suffix: ARTS_SUFFIX, category: 'Arts' };
  }

  if (allCategories.size === 0) {
    if (hasArtsDepartment) {
      return { suffix: ARTS_SUFFIX, category: 'Arts' };
    }
    return { suffix: DEFAULT_SUFFIX, category: 'Unknown' };
  }

  for (const priorityCategory of CATEGORY_PRIORITY) {
    if (allCategories.has(priorityCategory)) {
      return {
        suffix: CATEGORY_SUFFIXES[priorityCategory],
        category: priorityCategory
      };
    }
  }

  return { suffix: DEFAULT_SUFFIX, category: 'Unknown' };
}

/**
 * Checks if a title is a placeholder from skeleton
 */
function isPlaceholderTitle(title: string | undefined | null): boolean {
  if (!title) return true;
  if (title.includes("* Your Lab's Name")) return true;
  if (title.trim() === '') return true;
  return false;
}

// =============================================================================
// MAIN MIGRATION FUNCTION
// =============================================================================

async function migrateSmartTitles(dryRun: boolean = true) {
  const prodUrl = process.env.MONGODBURL;
  const migrationUrl = process.env.MONGODBURL_MIGRATION;

  if (!prodUrl) {
    console.error('ERROR: MONGODBURL (Production) not set in environment');
    process.exit(1);
  }

  if (!migrationUrl) {
    console.error('ERROR: MONGODBURL_MIGRATION (ProductionMigration) not set in environment');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log('SMART TITLE MIGRATION');
  console.log('='.repeat(80));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (changes will be applied)'}`);
  console.log('='.repeat(80) + '\n');

  const migrationLogs: MigrationLog[] = [];
  const skippedLogs: SkippedLog[] = [];

  let prodConnection: mongoose.Connection | null = null;
  let migrationConnection: mongoose.Connection | null = null;

  try {
    // Connect to Production for departments
    console.log('Connecting to Production database (for departments)...');
    prodConnection = await mongoose.createConnection(prodUrl).asPromise();
    console.log('Connected to Production\n');

    // Connect to ProductionMigration for listings
    console.log('Connecting to ProductionMigration database (for listings)...');
    migrationConnection = await mongoose.createConnection(migrationUrl).asPromise();
    console.log('Connected to ProductionMigration\n');

    // Create models on appropriate connections
    const DepartmentModel = prodConnection.model('departments', Department.schema);
    const ListingModel = migrationConnection.model('listings', Listing.schema);

    // Build department lookup (map by displayName, name, AND abbreviation for old format compatibility)
    console.log('Building department lookup from Production...');
    const departments = await DepartmentModel.find({ isActive: true }).lean();
    const lookup = new Map<string, DepartmentDoc>();

    for (const dept of departments as any[]) {
      const deptDoc: DepartmentDoc = {
        abbreviation: dept.abbreviation,
        displayName: dept.displayName,
        categories: dept.categories as DepartmentCategory[],
        primaryCategory: dept.primaryCategory as DepartmentCategory
      };

      // Add lookup by displayName (e.g., "CPSC - Computer Science")
      lookup.set(dept.displayName, deptDoc);

      // Add lookup by name (e.g., "Computer Science") for old format compatibility
      if (dept.name && dept.name !== dept.displayName) {
        lookup.set(dept.name, deptDoc);
      }

      // Add lookup by abbreviation (e.g., "CPSC")
      if (dept.abbreviation) {
        lookup.set(dept.abbreviation, deptDoc);
      }
    }
    console.log(`Loaded ${departments.length} departments (${lookup.size} lookup entries)\n`);

    // Fetch all listings from ProductionMigration
    console.log('Fetching listings from ProductionMigration...');
    const listings = await ListingModel.find({}).lean();
    console.log(`Found ${listings.length} total listings\n`);

    // Process each listing
    console.log('Processing listings...\n');
    const bulkOps: any[] = [];

    for (const listing of listings) {
      const listingId = listing._id.toString();
      const currentTitle = (listing.title as string) || '';
      const ownerFirstName = (listing.ownerFirstName as string) || '';
      const ownerLastName = (listing.ownerLastName as string) || '';
      const listingDepartments = (listing.departments || []) as string[];

      // Skip if missing owner last name
      if (!ownerLastName) {
        skippedLogs.push({
          listingId,
          title: currentTitle,
          reason: 'missing-owner-info'
        });
        continue;
      }

      // Skip if no departments
      if (listingDepartments.length === 0) {
        skippedLogs.push({
          listingId,
          title: currentTitle,
          reason: 'no-departments',
          ownerLastName
        });
        continue;
      }

      // Determine the reason for potential replacement
      const isPlaceholder = isPlaceholderTitle(currentTitle);
      const isCustom = !isPlaceholder && isCustomTitle(currentTitle, ownerFirstName, ownerLastName);

      // Skip if title is custom
      if (isCustom) {
        skippedLogs.push({
          listingId,
          title: currentTitle,
          reason: 'custom-title',
          ownerLastName
        });
        continue;
      }

      // Generate smart title
      const { suffix, category } = determineSuffix(listingDepartments, lookup);
      const newTitle = `${ownerLastName} ${suffix}`;

      // Only update if title actually changes
      if (newTitle === currentTitle) {
        skippedLogs.push({
          listingId,
          title: currentTitle,
          reason: 'no-change',
          ownerLastName
        });
        continue;
      }

      // Log the change
      let reason: 'name-based' | 'empty' | 'placeholder';
      if (isPlaceholder) {
        reason = currentTitle ? 'placeholder' : 'empty';
      } else {
        reason = 'name-based';
      }

      migrationLogs.push({
        listingId,
        oldTitle: currentTitle || '(empty)',
        newTitle,
        reason,
        departments: listingDepartments,
        determinedCategory: category,
        suffix
      });

      if (!dryRun) {
        bulkOps.push({
          updateOne: {
            filter: { _id: listing._id },
            update: { $set: { title: newTitle } }
          }
        });
      }
    }

    // Execute smart title bulk update
    if (!dryRun && bulkOps.length > 0) {
      console.log(`Executing ${bulkOps.length} smart title updates...`);
      const result = await ListingModel.bulkWrite(bulkOps);
      console.log(`Modified: ${result.modifiedCount}\n`);
    }

    // Set applicantDescription to empty string on all listings that don't have it
    if (!dryRun) {
      console.log('Setting applicantDescription field on all listings...');
      const applicantResult = await ListingModel.updateMany(
        { applicantDescription: { $exists: false } },
        { $set: { applicantDescription: '' } }
      );
      console.log(`Set applicantDescription on ${applicantResult.modifiedCount} listings\n`);
    } else {
      const missingCount = await ListingModel.countDocuments({ applicantDescription: { $exists: false } });
      console.log(`[DRY RUN] Would set applicantDescription on ${missingCount} listings\n`);
    }

    // Print results
    console.log('\n' + '='.repeat(80));
    console.log('MIGRATION RESULTS');
    console.log('='.repeat(80) + '\n');

    const customSkips = skippedLogs.filter(s => s.reason === 'custom-title').length;
    const noDeptSkips = skippedLogs.filter(s => s.reason === 'no-departments').length;
    const noOwnerSkips = skippedLogs.filter(s => s.reason === 'missing-owner-info').length;
    const noChangeSkips = skippedLogs.filter(s => s.reason === 'no-change').length;

    console.log(`Total listings processed: ${listings.length}`);
    console.log(`Titles to update: ${migrationLogs.length}`);
    console.log(`Skipped (custom title - preserved): ${customSkips}`);
    console.log(`Skipped (no departments): ${noDeptSkips}`);
    console.log(`Skipped (missing owner info): ${noOwnerSkips}`);
    console.log(`Skipped (no change needed): ${noChangeSkips}`);

    // Print summary by suffix
    if (migrationLogs.length > 0) {
      console.log('\n' + '-'.repeat(60));
      console.log('CHANGES ' + (dryRun ? '(would be made)' : '(applied)'));
      console.log('-'.repeat(60) + '\n');

      const bySuffix = new Map<string, number>();
      const byReason = new Map<string, number>();

      for (const log of migrationLogs) {
        bySuffix.set(log.suffix, (bySuffix.get(log.suffix) || 0) + 1);
        byReason.set(log.reason, (byReason.get(log.reason) || 0) + 1);
      }

      console.log('Summary by suffix:');
      for (const [suffix, count] of Array.from(bySuffix.entries()).sort((a, b) => b[1] - a[1])) {
        console.log(`  "${suffix}": ${count} listings`);
      }

      console.log('\nSummary by reason:');
      for (const [reason, count] of Array.from(byReason.entries()).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${reason}: ${count} listings`);
      }

      console.log('\nDetailed changes (first 30):');
      for (const log of migrationLogs.slice(0, 30)) {
        console.log(`  [${log.listingId.slice(-8)}] "${log.oldTitle}" -> "${log.newTitle}"`);
        console.log(`           Reason: ${log.reason}, Category: ${log.determinedCategory}`);
      }
      if (migrationLogs.length > 30) {
        console.log(`  ... and ${migrationLogs.length - 30} more`);
      }
    }

    // Print preserved custom titles (sample)
    const customTitleSkips = skippedLogs.filter(s => s.reason === 'custom-title');
    if (customTitleSkips.length > 0) {
      console.log('\n' + '-'.repeat(60));
      console.log('PRESERVED CUSTOM TITLES (sample of 15)');
      console.log('-'.repeat(60) + '\n');
      for (const log of customTitleSkips.slice(0, 15)) {
        console.log(`  [${log.listingId.slice(-8)}] "${log.title}"`);
      }
      if (customTitleSkips.length > 15) {
        console.log(`  ... and ${customTitleSkips.length - 15} more`);
      }
    }

    await prodConnection.close();
    await migrationConnection.close();
    console.log('\nDisconnected from databases');

    if (dryRun && migrationLogs.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('To apply these changes, run with --live flag:');
      console.log('  npm run migrate:smart-titles:live');
      console.log('='.repeat(80) + '\n');
    }

  } catch (error) {
    console.error('Migration error:', error);
    if (prodConnection) {
      await prodConnection.close();
    }
    if (migrationConnection) {
      await migrationConnection.close();
    }
    process.exit(1);
  }
}

// =============================================================================
// ENTRY POINT
// =============================================================================

const args = process.argv.slice(2);
const dryRun = !args.includes('--live');

migrateSmartTitles(dryRun).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
