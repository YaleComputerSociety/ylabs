const RESEARCH_BROWSE_PATH = '/research';

const parseResearchAreaCsv = (value: string | null): string[] => {
  const seen = new Set<string>();
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => {
      const lower = entry.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
};

const isAreaFilteredBrowse = (pathname: string, params: URLSearchParams): boolean =>
  pathname === RESEARCH_BROWSE_PATH &&
  !(params.get('q') || '').trim() &&
  !(params.get('dept') || '').trim() &&
  parseResearchAreaCsv(params.get('researchAreas')).length > 0;

export const buildResearchAreaFilterHref = (
  canonicalArea: string,
  currentPathname = '',
  currentSearch = '',
): string => {
  const area = canonicalArea.trim();
  const currentParams = new URLSearchParams(currentSearch);

  if (!isAreaFilteredBrowse(currentPathname, currentParams)) {
    const freshParams = new URLSearchParams();
    freshParams.set('researchAreas', area);
    return `${RESEARCH_BROWSE_PATH}?${freshParams.toString()}`;
  }

  const existingAreas = parseResearchAreaCsv(currentParams.get('researchAreas'));
  const mergedAreas = existingAreas.some((entry) => entry.toLowerCase() === area.toLowerCase())
    ? existingAreas
    : [...existingAreas, area];
  currentParams.set('researchAreas', mergedAreas.join(','));
  return `${RESEARCH_BROWSE_PATH}?${currentParams.toString()}`;
};
