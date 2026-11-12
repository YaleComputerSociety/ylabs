export const DEPARTMENT_HEADING_CHROME_PATTERN = /^other\s+departments?\b/i;

export const isDepartmentHeadingChrome = (value: unknown): boolean =>
  typeof value === 'string' && DEPARTMENT_HEADING_CHROME_PATTERN.test(value.trim());
