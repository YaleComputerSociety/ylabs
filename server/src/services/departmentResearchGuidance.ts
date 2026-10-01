/**
 * The page's own title is the evidence, because the lane-authored record title names every
 * configured page "<Department> Undergraduate Research", including undergraduate-program
 * overviews and senior-essay registration pages that #4113 holds (#4285). The classifier, the
 * programs visibility gate and the client's guidance rendering all key on this predicate, so
 * changing it changes all three.
 */

const UNDERGRADUATE_RESEARCH_GUIDANCE_TITLE =
  /\bundergraduate(?:\s+[a-z&]+){0,2}\s+research\b|\bresearch\s+opportunit(?:y|ies)\b/i;

const NON_GUIDANCE_TITLE =
  /\b(?:senior|capstone|thesis|essays?|applications?|apply|internships?|scholars?|fellowships?|grants?|awards?|prizes?|scholarships?|funds?|funding|stipends?|summer|news|flyers?|events?|graduate|professional|postdoc(?:toral)?|doctoral|phd)\b/i;

export const DEPARTMENT_RESEARCH_GUIDE_KIND = 'DEPARTMENT_RESEARCH_GUIDE' as const;

export const DEPARTMENT_RESEARCH_GUIDANCE_REASON = 'department_research_guidance';

const normalizedText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function pageTitleNamesUndergraduateResearchGuidance(pageTitle: unknown): boolean {
  const title = normalizedText(pageTitle);
  return (
    title.length > 0 &&
    UNDERGRADUATE_RESEARCH_GUIDANCE_TITLE.test(title) &&
    !NON_GUIDANCE_TITLE.test(title)
  );
}

export interface ApplicationCycleFacts {
  deadline?: unknown;
  applicationOpenDate?: unknown;
  isAcceptingApplications?: unknown;
}

export function statesApplicationCycle(program: ApplicationCycleFacts): boolean {
  return Boolean(
    program.deadline || program.applicationOpenDate || program.isAcceptingApplications === true,
  );
}

export interface DepartmentResearchGuidanceFacts extends ApplicationCycleFacts {
  sourcePageTitle?: unknown;
}

export function isDepartmentResearchGuidancePage(facts: DepartmentResearchGuidanceFacts): boolean {
  return (
    pageTitleNamesUndergraduateResearchGuidance(facts.sourcePageTitle) &&
    !statesApplicationCycle(facts)
  );
}

export function isDepartmentResearchGuidance(
  program: DepartmentResearchGuidanceFacts & { programKind?: unknown },
): boolean {
  return (
    program.programKind === DEPARTMENT_RESEARCH_GUIDE_KIND &&
    isDepartmentResearchGuidancePage(program)
  );
}
