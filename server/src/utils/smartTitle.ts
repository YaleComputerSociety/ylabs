/**
 * Smart title generation for listings based on professor name and department.
 */
import { Department, DepartmentCategory } from '../models/department';

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

const ARTS_DEPARTMENT_ABBRS = ['ARCH', 'ART', 'FILM', 'DRAM', 'THST'];
const ARTS_SUFFIX = 'Studio';

const DEFAULT_SUFFIX = 'Research';

const NAME_BASED_SUFFIXES = [
  'lab',
  'laboratory',
  'group',
  'research',
  'research group',
  'studio',
  'project',
  'team',
  'center',
  'centre',
  'initiative',
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
    .replace(/[''`]/g, "'") // Normalize all apostrophe variants
    .replace(/[^\w\s']/g, '') // Remove special chars except apostrophe
    .replace(/\s+/g, ' ');
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
export function isCustomTitle(title: string, firstName: string, lastName: string): boolean {
  if (!title || !lastName) {
    return false;
  }

  const normalizedTitle = normalizeString(title);
  const normalizedFirstName = normalizeString(firstName || '');
  const normalizedLastName = normalizeString(lastName);

  if (!normalizedTitle.includes(normalizedLastName)) {
    return true;
  }

  const escapedFirstName = escapeRegex(normalizedFirstName);
  const escapedLastName = escapeRegex(normalizedLastName);
  const suffixPattern = NAME_BASED_SUFFIXES.map((s) => escapeRegex(s)).join('|');

  const nameBasedPatterns = [
    new RegExp(`^(the\\s+)?${escapedLastName}('?s)?\\s+(${suffixPattern})$`, 'i'),

    new RegExp(`^${escapedFirstName}(\\s+[a-z]+\\.?)*\\s+${escapedLastName}$`, 'i'),

    new RegExp(`^${escapedFirstName.charAt(0)}\\.?\\s+(\\w+\\s+)*${escapedLastName}$`, 'i'),

    new RegExp(`^${escapedLastName}$`, 'i'),

    new RegExp(
      `^(dr\\.?|prof\\.?|professor)\\s+${escapedLastName}('?s)?\\s+(${suffixPattern})$`,
      'i',
    ),

    new RegExp(`^(dr\\.?|prof\\.?|professor)\\s+${escapedLastName}$`, 'i'),

    new RegExp(`^the\\s+${escapedLastName}\\s+(${suffixPattern})$`, 'i'),
  ];

  for (const pattern of nameBasedPatterns) {
    if (pattern.test(normalizedTitle)) {
      return false;
    }
  }

  let remainingTitle = normalizedTitle;
  remainingTitle = remainingTitle.replace(new RegExp(`\\b${escapedLastName}\\b`, 'gi'), '');
  remainingTitle = remainingTitle.replace(new RegExp(`\\b(${suffixPattern})\\b`, 'gi'), '');
  remainingTitle = remainingTitle.replace(/\b(the|a|an|of|for|and|in|on|at)\b/gi, '');
  remainingTitle = remainingTitle.replace(/[''`'s]/g, '').trim();

  const remainingWords = remainingTitle.split(/\s+/).filter((w) => w.length > 1);

  if (remainingWords.length >= 2) {
    return true;
  }

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
  lookup: Map<string, DepartmentDoc>,
): { suffix: string; category: DepartmentCategory | 'Arts' | 'Unknown' } {
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
        category: priorityCategory,
      };
    }
  }

  return { suffix: DEFAULT_SUFFIX, category: 'Unknown' };
}

let departmentLookupCache: Map<string, DepartmentDoc> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

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
      primaryCategory: dept.primaryCategory as DepartmentCategory,
    };

    lookup.set(dept.displayName, deptDoc);

    if (dept.name && dept.name !== dept.displayName) {
      lookup.set(dept.name, deptDoc);
    }

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
  if (!departmentLookupCache || now - cacheTimestamp > CACHE_TTL) {
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
  lookup?: Map<string, DepartmentDoc>,
): Promise<SmartTitleResult> {
  const deptLookup = lookup || (await getDepartmentLookup());

  const { suffix, category } = determineSuffix(departments, deptLookup);

  const title = `${lastName} ${suffix}`;

  return {
    title,
    suffix,
    determinedCategory: category,
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
  lookup?: Map<string, DepartmentDoc>,
): Promise<string> {
  if (!lastName) {
    return currentTitle || '';
  }

  const isPlaceholder =
    !currentTitle || currentTitle.includes("* Your Lab's Name") || currentTitle.trim() === '';

  if (!isPlaceholder && isCustomTitle(currentTitle, firstName, lastName)) {
    return currentTitle;
  }

  if (departments && departments.length > 0) {
    const result = await generateSmartTitle(lastName, departments, lookup);
    return result.title;
  }

  return `${lastName} ${DEFAULT_SUFFIX}`;
}
