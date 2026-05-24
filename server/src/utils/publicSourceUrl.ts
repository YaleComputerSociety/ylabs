import { parseNormalizedHttpUrl } from './urlNormalization';

type ParsedHttpUrl = NonNullable<ReturnType<typeof parseNormalizedHttpUrl>>;

function isForbiddenEngineeringSource(parsed: ParsedHttpUrl): boolean {
  return (
    parsed.host === 'engineering.yale.edu' &&
    (/^\/research-and-faculty\/faculty-directory\/[^/]+$/.test(parsed.path) ||
      /^\/academic-study\/departments\/[^/]+\/faculty\/load_faculty(?:\/|$)/.test(parsed.path))
  );
}

export function isForbiddenEngineeringSourceUrl(value: unknown): boolean {
  const parsed = parseNormalizedHttpUrl(value);
  return Boolean(parsed && isForbiddenEngineeringSource(parsed));
}

export function isPubliclyExposableSourceUrl(value: unknown): value is string {
  const parsed = parseNormalizedHttpUrl(value);
  return Boolean(parsed && !isForbiddenEngineeringSource(parsed));
}

export function publicSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = parseNormalizedHttpUrl(value);
  return parsed && !isForbiddenEngineeringSource(parsed) ? value.trim() : undefined;
}

export function publicSourceUrls(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map(publicSourceUrl).filter((url): url is string => Boolean(url));
}
