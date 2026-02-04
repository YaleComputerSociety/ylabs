// Utility functions for parsing department strings
// All department DATA now comes from ConfigContext (fetched from MongoDB)

/**
 * Extract abbreviation from a department string.
 * Handles "ABBR - Name" format or returns first 4 chars uppercase.
 */
export const getDepartmentAbbreviation = (department: string): string => {
  // Check if department is already in "ABBR - Name" format
  const match = department.match(/^([A-Z&/]+)\s*-\s*/);
  if (match) {
    return match[1];
  }

  // For unknown formats, return first 4 letters uppercase
  return department.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase();
};

/**
 * Extract just the department name (without abbreviation prefix).
 * Handles "ABBR - Name" format.
 */
export const getDepartmentName = (department: string): string => {
  // Check if department is in "ABBR - Name" format
  const match = department.match(/^[A-Z&/]+\s*-\s*(.+)$/);
  if (match) {
    return match[1];
  }
  return department;
};

// Static list of department category names (for reference/typing)
export const researchAreaCategories = [
  "Biological Sciences",
  "Engineering",
  "Health & Medicine",
  "Humanities",
  "Physical Sciences",
  "Social Sciences",
] as const;

export type ResearchAreaCategory = typeof researchAreaCategories[number];
