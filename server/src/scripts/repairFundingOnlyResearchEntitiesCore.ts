const FUNDING_ENTITY_SLUG_RE = /^(?:nsf|nih)-pi-/i;
const FUNDING_SOURCE_HOSTS = new Set(['reporter.nih.gov', 'api.reporter.nih.gov', 'api.nsf.gov']);

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function urlHostname(value: unknown): string {
  const url = textValue(value);
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isFundingSourceUrl(value: unknown): boolean {
  const host = urlHostname(value);
  if (!host) return false;
  return (
    FUNDING_SOURCE_HOSTS.has(host) ||
    host.endsWith('.reporter.nih.gov') ||
    host.endsWith('.nsf.gov')
  );
}

function hasNonFundingSourceUrl(values: unknown): boolean {
  return (
    Array.isArray(values) &&
    values.some((value) => /^https?:/i.test(textValue(value)) && !isFundingSourceUrl(value))
  );
}

export function isRepairableFundingOnlyShell(entity: any): boolean {
  if (!FUNDING_ENTITY_SLUG_RE.test(textValue(entity?.slug))) return false;
  if (textValue(entity?.websiteUrl) && !isFundingSourceUrl(entity.websiteUrl)) return false;
  if (textValue(entity?.website) && !isFundingSourceUrl(entity.website)) return false;
  if (textValue(entity?.profileSynthesisDescription)) return false;
  if (textValue(entity?.descriptionSource) && textValue(entity.descriptionSource) !== 'NONE') {
    return false;
  }
  return !hasNonFundingSourceUrl(entity?.sourceUrls);
}
