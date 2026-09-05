/**
 * Navigation contract shared by the brand logo controls and the research page:
 * the logo always targets a clean research home, and asks the page to drop its
 * in-page search state when the URL alone cannot express the reset.
 */
export const RESEARCH_HOME_PATH = '/research';

export interface ResearchHomeResetState {
  resetResearchHome: true;
}

export const isResearchHomeResetState = (state: unknown): boolean =>
  typeof state === 'object' &&
  state !== null &&
  (state as { resetResearchHome?: unknown }).resetResearchHome === true;

export const isResearchHomeLocation = (location: { pathname: string; search: string }) =>
  location.pathname === RESEARCH_HOME_PATH && location.search === '';

export const researchHomeResetState = (location: {
  pathname: string;
  search: string;
}): ResearchHomeResetState | undefined =>
  isResearchHomeLocation(location) ? { resetResearchHome: true } : undefined;
