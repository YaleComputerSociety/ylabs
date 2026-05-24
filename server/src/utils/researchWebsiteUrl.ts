import { isForbiddenEngineeringSourceUrl } from './publicSourceUrl';
import { isHttpUrl, normalizedHostMatchesSuffix, parseNormalizedHttpUrl } from './urlNormalization';

const YSM_LAB_WEBSITES_INDEX_RE =
  /^https?:\/\/medicine\.yale\.edu\/about\/a-to-z-index\/atoz\/lab-websites\/?$/i;
const GENERIC_RESEARCH_SERVICE_HOSTS = new Set(['glassshop.yale.edu', 'wordpress.org']);

export function isDepartmentFacultyListUrl(value: unknown): boolean {
  const parsed = parseNormalizedHttpUrl(value);
  if (!parsed) return false;
  return (
    normalizedHostMatchesSuffix(parsed.host, 'yale.edu') &&
    (/^\/people\/faculty(?:-|\/|$)/.test(parsed.path) ||
      /^\/academic-study\/departments\/[^/]+\/faculty\/load_faculty(?:\/|$)/.test(parsed.path))
  );
}

function isFacultyProfileUrl(value: unknown): boolean {
  const parsed = parseNormalizedHttpUrl(value);
  return Boolean(
    parsed &&
    normalizedHostMatchesSuffix(parsed.host, 'yale.edu') &&
    /(?:^|\/)(?:profile|people\/faculty(?:-|\/))/.test(parsed.path),
  );
}

export function isGenericResearchWebsiteIndexUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (YSM_LAB_WEBSITES_INDEX_RE.test(url)) return true;
  if (isForbiddenEngineeringSourceUrl(url)) return true;
  if (isDepartmentFacultyListUrl(url)) return true;
  const parsed = parseNormalizedHttpUrl(url);
  return Boolean(parsed && GENERIC_RESEARCH_SERVICE_HOSTS.has(parsed.host));
}

export function isUsableResearchWebsiteUrl(value: unknown): value is string {
  return isHttpUrl(value) && !isGenericResearchWebsiteIndexUrl(value);
}

export function firstUsableResearchWebsiteUrl(values: unknown[]): string {
  for (const value of values) {
    const candidates = (Array.isArray(value) ? value : [value]).filter(isUsableResearchWebsiteUrl);
    const preferred = candidates.find((candidate) => !isFacultyProfileUrl(candidate));
    if (preferred) return preferred.trim();
    if (candidates[0]) return candidates[0].trim();
  }
  return '';
}
