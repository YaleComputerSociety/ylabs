/**
 * Remove direct contact details from public-facing evidence excerpts while
 * preserving enough quote context for source review.
 */
export function redactDirectContactInfo(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
    .replace(
      /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g,
      '[phone redacted]',
    );
}
