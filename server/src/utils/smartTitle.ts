import { Department, DepartmentCategory } from '../models/department';

// Category priority order (highest to lowest) for determining suffix
const CATEGORY_PRIORITY: DepartmentCategory[] = [
  DepartmentCategory.COMPUTING_AI,
  DepartmentCategory.PHYSICAL_SCIENCES,
  DepartmentCategory.LIFE_SCIENCES,
  DepartmentCategory.HEALTH_MEDICINE,
  DepartmentCategory.ENVIRONMENTAL,
  DepartmentCategory.MATHEMATICS,
  DepartmentCategory.ECONOMICS,
  DepartmentCategory.SOCIAL_SCIENCES,
  DepartmentCategory.HUMANITIES_ARTS,
];

// Suffix mapping by category
const CATEGORY_SUFFIXES: Record<DepartmentCategory, string> = {
  [DepartmentCategory.COMPUTING_AI]: 'Lab',
  [DepartmentCategory.LIFE_SCIENCES]: 'Lab',
  [DepartmentCategory.PHYSICAL_SCIENCES]: 'Lab',
  [DepartmentCategory.HEALTH_MEDICINE]: 'Lab',
  [DepartmentCategory.ENVIRONMENTAL]: 'Lab',
  [DepartmentCategory.MATHEMATICS]: 'Research Group',
  [DepartmentCategory.ECONOMICS]: 'Research Group',
  [DepartmentCategory.SOCIAL_SCIENCES]: 'Research Group',
  [DepartmentCategory.HUMANITIES_ARTS]: 'Project',
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

export interface DepartmentDoc {
  abbreviation: string;
  displayName: string;
  categories: DepartmentCategory[];
  primaryCategory: DepartmentCategory;
}

export interface SmartTitleResult {
  title: string;
  suffix: string;
  determinedCategory: DepartmentCategory | 'Arts' | 'Unknown';
}

/**
 * Normalizes a string for comparison:
 * - Lowercase
 * - Trim whitespace
 * - Normalize apostrophes (curly to straight)
 * - Remove special characters except apostrophe
 * - Normalize multiple spaces
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[''`]/g, "'")  // Normalize all apostrophe variants
    .replace(/[^\w\s']/g, '') // Remove special chars except apostrophe
    .replace(/\s+/g, ' ');    // Normalize whitespace
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Determines if a title is "custom" (should be preserved) or "name-based" (should be replaced).
 *
 * Custom titles to KEEP:
 * - Titles that don't contain the owner's last name at all
 * - Titles with significant descriptive content beyond just name + suffix
 *
 * Name-based titles to REPLACE:
 * - "Smith Lab", "The Smith Lab", "Smith's Lab"
 * - "John Smith", "John Michael Smith" (just name variations)
 * - "Smith Research", "Smith Group", etc.
 * - "Dr. Smith Lab", "Professor Smith Research"
 *
 * @param title - The current listing title
 * @param firstName - Owner's first name
 * @param lastName - Owner's last name
 * @returns true if title is custom (preserve), false if name-based (replace)
 */
export function isCustomTitle(
  title: string,
  firstName: string,
  lastName: string
): boolean {
  if (!title || !lastName) {
    return false; // No title or no last name means we should generate one
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

  // Patterns that indicate name-based titles (should be replaced)
  const nameBasedPatterns = [
    // "Smith Lab", "The Smith Lab", "Smith's Lab", "Smiths Lab"
    new RegExp(`^(the\\s+)?${escapedLastName}('?s)?\\s+(${suffixPattern})$`, 'i'),

    // "John Smith", "John Michael Smith", "J. Smith" (just the name, possibly with middle names/initials)
    new RegExp(`^${escapedFirstName}(\\s+[a-z]+\\.?)*\\s+${escapedLastName}$`, 'i'),

    // Also handle first initial: "J Smith", "J. Smith"
    new RegExp(`^${escapedFirstName.charAt(0)}\\.?\\s+(\\w+\\s+)*${escapedLastName}$`, 'i'),

    // Just last name: "Smith"
    new RegExp(`^${escapedLastName}$`, 'i'),

    // "Dr. Smith Lab", "Prof. Smith Lab", "Professor Smith Lab"
    new RegExp(`^(dr\\.?|prof\\.?|professor)\\s+${escapedLastName}('?s)?\\s+(${suffixPattern})$`, 'i'),

    // "Dr. Smith", "Prof. Smith" (just title + name)
    new RegExp(`^(dr\\.?|prof\\.?|professor)\\s+${escapedLastName}$`, 'i'),

    // "The [LastName] [Suffix]" variants
    new RegExp(`^the\\s+${escapedLastName}\\s+(${suffixPattern})$`, 'i'),
  ];

  for (const pattern of nameBasedPatterns) {
    if (pattern.test(normalizedTitle)) {
      return false; // Name-based, should be replaced
    }
  }

  // If we get here, the title contains the last name but doesn't match simple patterns.
  // Check if it has significant additional descriptive content.
  // "Smith Computational Biology Lab" should be preserved (has descriptive words)
  // "Smith Lab" should be replaced (covered above)

  // Remove the last name and common suffixes, see what's left
  let remainingTitle = normalizedTitle;
  remainingTitle = remainingTitle.replace(new RegExp(`\\b${escapedLastName}\\b`, 'gi'), '');
  remainingTitle = remainingTitle.replace(new RegExp(`\\b(${suffixPattern})\\b`, 'gi'), '');
  remainingTitle = remainingTitle.replace(/\b(the|a|an|of|for|and|in|on|at)\b/gi, ''); // Remove common words
  remainingTitle = remainingTitle.replace(/[''`'s]/g, '').trim();

  // Count significant remaining words
  const remainingWords = remainingTitle.split(/\s+/).filter(w => w.length > 1);

  // If there are 2+ significant descriptive words remaining, treat as custom
  if (remainingWords.length >= 2) {
    return true;
  }

  // Default: treat as name-based if it contains the last name
  return false;
}

/**
 * Extracts department abbreviation from a displayName.
 * Handles "ABBR - Name" format.
 */
function extractAbbreviation(displayName: string): string {
  const match = displayName.match(/^([A-Z&/]+)\s*-\s*/);
  if (match) {
    return match[1];
  }
  // Fallback: return first word uppercase
  return displayName.split(/\s+/)[0].toUpperCase();
}

/**
 * Determines the appropriate suffix based on department categories.
 *
 * @param departments - Array of department displayNames (e.g., "CPSC - Computer Science")
 * @param lookup - Map of displayName to DepartmentDoc for category lookup
 * @returns The suffix and determined category
 */
function determineSuffix(
  departments: string[],
  lookup: Map<string, DepartmentDoc>
): { suffix: string; category: DepartmentCategory | 'Arts' | 'Unknown' } {
  // Collect all categories from all departments
  const allCategories = new Set<DepartmentCategory>();
  let hasArtsDepartment = false;
  let onlyArtsDepartments = true;

  for (const deptDisplayName of departments) {
    const dept = lookup.get(deptDisplayName);

    if (dept) {
      // Check for Arts departments (special case)
      if (ARTS_DEPARTMENT_ABBRS.includes(dept.abbreviation)) {
        hasArtsDepartment = true;
      } else {
        onlyArtsDepartments = false;
      }

      // Add all categories from this department
      for (const cat of dept.categories) {
        allCategories.add(cat);
      }
    } else {
      // Unknown department - try to extract abbreviation and check for Arts
      const abbr = extractAbbreviation(deptDisplayName);
      if (ARTS_DEPARTMENT_ABBRS.includes(abbr)) {
        hasArtsDepartment = true;
      } else {
        onlyArtsDepartments = false;
      }
    }
  }

  // If only Arts departments and no other categories, use Studio
  if (hasArtsDepartment && onlyArtsDepartments && allCategories.size === 0) {
    return { suffix: ARTS_SUFFIX, category: 'Arts' };
  }

  // If no valid categories found, use fallback
  if (allCategories.size === 0) {
    // Still check for Arts as fallback
    if (hasArtsDepartment) {
      return { suffix: ARTS_SUFFIX, category: 'Arts' };
    }
    return { suffix: DEFAULT_SUFFIX, category: 'Unknown' };
  }

  // Find highest priority category
  for (const priorityCategory of CATEGORY_PRIORITY) {
    if (allCategories.has(priorityCategory)) {
      return {
        suffix: CATEGORY_SUFFIXES[priorityCategory],
        category: priorityCategory
      };
    }
  }

  // Fallback (shouldn't reach here if categories are valid)
  return { suffix: DEFAULT_SUFFIX, category: 'Unknown' };
}

// Cache for department lookup
let departmentLookupCache: Map<string, DepartmentDoc> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Builds a lookup map from the Department collection.
 * Creates entries for both displayName ("CPSC - Computer Science") and name ("Computer Science")
 * to handle both old and new department formats in listings.
 */
export async function buildDepartmentLookup(): Promise<Map<string, DepartmentDoc>> {
  const departments = await Department.find({ isActive: true }).lean();
  const lookup = new Map<string, DepartmentDoc>();

  for (const dept of departments) {
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

    // Add lookup by abbreviation (e.g., "CPSC") for flexibility
    if (dept.abbreviation) {
      lookup.set(dept.abbreviation, deptDoc);
    }
  }

  return lookup;
}

/**
 * Gets the department lookup map, using cache if available and not expired.
 */
export async function getDepartmentLookup(): Promise<Map<string, DepartmentDoc>> {
  const now = Date.now();
  if (!departmentLookupCache || (now - cacheTimestamp) > CACHE_TTL) {
    departmentLookupCache = await buildDepartmentLookup();
    cacheTimestamp = now;
  }
  return departmentLookupCache;
}

/**
 * Invalidates the department lookup cache.
 * Call this when departments are updated.
 */
export function invalidateDepartmentLookupCache(): void {
  departmentLookupCache = null;
  cacheTimestamp = 0;
}

/**
 * Generates a smart title based on the owner's last name and department categories.
 *
 * @param lastName - Owner's last name
 * @param departments - Array of department displayNames
 * @param lookup - Optional pre-built department lookup map (will be fetched if not provided)
 * @returns SmartTitleResult with the generated title, suffix, and determined category
 */
export async function generateSmartTitle(
  lastName: string,
  departments: string[],
  lookup?: Map<string, DepartmentDoc>
): Promise<SmartTitleResult> {
  // Use provided lookup or fetch from cache
  const deptLookup = lookup || await getDepartmentLookup();

  // Determine the appropriate suffix based on departments
  const { suffix, category } = determineSuffix(departments, deptLookup);

  // Generate the title
  const title = `${lastName} ${suffix}`;

  return {
    title,
    suffix,
    determinedCategory: category
  };
}

/**
 * Processes a listing's title, either preserving a custom title or generating a smart one.
 *
 * @param currentTitle - The current/provided title (may be empty or a placeholder)
 * @param firstName - Owner's first name
 * @param lastName - Owner's last name
 * @param departments - Array of department displayNames
 * @param lookup - Optional pre-built department lookup map
 * @returns The title to use (either original custom title or newly generated smart title)
 */
export async function processListingTitle(
  currentTitle: string | undefined | null,
  firstName: string,
  lastName: string,
  departments: string[],
  lookup?: Map<string, DepartmentDoc>
): Promise<string> {
  // Check if we have a valid last name to work with
  if (!lastName) {
    // Can't generate smart title without last name, return current or empty
    return currentTitle || '';
  }

  // Check for placeholder title from skeleton
  const isPlaceholder = !currentTitle ||
    currentTitle.includes("* Your Lab's Name") ||
    currentTitle.trim() === '';

  // If we have a real title, check if it's custom
  if (!isPlaceholder && isCustomTitle(currentTitle, firstName, lastName)) {
    return currentTitle; // Preserve custom title
  }

  // Generate smart title if we have departments
  if (departments && departments.length > 0) {
    const result = await generateSmartTitle(lastName, departments, lookup);
    return result.title;
  }

  // Fallback: generate with default suffix
  return `${lastName} ${DEFAULT_SUFFIX}`;
}
