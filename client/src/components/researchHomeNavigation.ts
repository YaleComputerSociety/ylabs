/**
 * Navigation contract shared by the brand logo controls and the research page:
 * the logo always targets a clean research home and always carries an explicit
 * reset intent, because the research page restores in-page state (an
 * unsubmitted draft query, browse position) from a snapshot keyed only by the
 * target search params, so a bare `/research` URL alone never guarantees a
 * clean home no matter which route the click came from.
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

export const researchHomeResetState = (): ResearchHomeResetState => ({ resetResearchHome: true });
