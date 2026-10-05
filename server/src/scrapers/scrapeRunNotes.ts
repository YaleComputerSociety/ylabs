import { sanitizeLogValue } from '../utils/logSanitizer';

export const SCRAPE_RUN_NOTES_MAX_LENGTH = 4000;
export const SCRAPE_RUN_NOTES_TRUNCATED_SUFFIX = ' [notes-truncated]';

export function boundedScrapeRunNotes(notes: unknown): string | undefined {
  if (typeof notes !== 'string') return undefined;
  const sanitized = sanitizeLogValue(notes).trim();
  if (!sanitized) return undefined;
  if (sanitized.length <= SCRAPE_RUN_NOTES_MAX_LENGTH) return sanitized;
  const keep = SCRAPE_RUN_NOTES_MAX_LENGTH - SCRAPE_RUN_NOTES_TRUNCATED_SUFFIX.length;
  return `${sanitized.slice(0, keep)}${SCRAPE_RUN_NOTES_TRUNCATED_SUFFIX}`;
}
