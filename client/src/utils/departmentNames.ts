/**
 * Department name parsing and abbreviation utilities.
 */

/**
 * Extract abbreviation from a department string.
 * Handles "ABBR - Name" format or returns first 4 chars uppercase.
 */
export const getDepartmentAbbreviation = (department: string): string => {
  const match = department.match(/^([A-Z&/]+)\s*-\s*/);
  if (match) {
    return match[1];
  }

  return department.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase();
};
