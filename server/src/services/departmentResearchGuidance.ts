/**
 * The page's own title is the evidence, because the lane-authored record title names every
 * configured page "<Department> Undergraduate Research", including undergraduate-program
 * overviews and senior-essay registration pages that #4113 holds (#4285). The classifier, the
 * programs visibility gate and the served `departmentResearchGuidance` flag the client renders
 * from all key on these predicates, so changing one changes all three.
 *
 * A senior-essay page is the second guidance kind (#5298): in the humanities and most social
 * sciences the senior essay is the research an undergraduate does, so its page is admitted under
 * its own predicate and label rather than by widening the research-guidance one, which would call
 * a requirement page research guidance.
 */

const UNDERGRADUATE_RESEARCH_GUIDANCE_TITLE =
  /\bundergraduate(?:\s+[a-z&]+){0,2}\s+research\b|\bresearch\s+opportunit(?:y|ies)\b/i;

const NON_GUIDANCE_TITLE =
  /\b(?:senior|capstone|thesis|essays?|applications?|apply|internships?|scholars?|fellowships?|grants?|awards?|prizes?|scholarships?|funds?|funding|stipends?|summer|news|flyers?|events?|graduate|professional|postdoc(?:toral)?|doctoral|phd)\b/i;

const SENIOR_ESSAY_GUIDANCE_TITLE = /\bsenior\s+(?:essays?|projects?|requirements?)\b/i;

const NON_SENIOR_ESSAY_GUIDANCE_TITLE =
  /\b(?:applications?|apply|deadlines?|registration|forms?|prospectus|internships?|scholars?|fellowships?|grants?|awards?|prizes?|scholarships?|funds?|funding|stipends?|summer|news|flyers?|events?|graduate|professional|postdoc(?:toral)?|doctoral|phd)\b/i;

export const DEPARTMENT_RESEARCH_GUIDE_KIND = 'DEPARTMENT_RESEARCH_GUIDE' as const;

export const DEPARTMENT_SENIOR_ESSAY_GUIDE_KIND = 'DEPARTMENT_SENIOR_ESSAY_GUIDE' as const;

export const DEPARTMENT_RESEARCH_GUIDANCE_REASON = 'department_research_guidance';

export const DEPARTMENT_SENIOR_ESSAY_GUIDANCE_REASON = 'department_senior_essay_guidance';

export const departmentGuidanceKinds = ['research', 'senior_essay'] as const;

export type DepartmentGuidanceKind = (typeof departmentGuidanceKinds)[number];

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

export function pageTitleNamesSeniorEssayGuidance(pageTitle: unknown): boolean {
  const title = normalizedText(pageTitle);
  return (
    title.length > 0 &&
    SENIOR_ESSAY_GUIDANCE_TITLE.test(title) &&
    !NON_SENIOR_ESSAY_GUIDANCE_TITLE.test(title)
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

export function isDepartmentSeniorEssayGuidancePage(
  facts: DepartmentResearchGuidanceFacts,
): boolean {
  return pageTitleNamesSeniorEssayGuidance(facts.sourcePageTitle) && !statesApplicationCycle(facts);
}

type StoredGuidanceFacts = DepartmentResearchGuidanceFacts & { programKind?: unknown };

export function isDepartmentResearchGuidance(program: StoredGuidanceFacts): boolean {
  return (
    program.programKind === DEPARTMENT_RESEARCH_GUIDE_KIND &&
    isDepartmentResearchGuidancePage(program)
  );
}

export function isDepartmentSeniorEssayGuidance(program: StoredGuidanceFacts): boolean {
  return (
    program.programKind === DEPARTMENT_SENIOR_ESSAY_GUIDE_KIND &&
    isDepartmentSeniorEssayGuidancePage(program)
  );
}

export function departmentGuidanceKindOf(
  program: StoredGuidanceFacts,
): DepartmentGuidanceKind | null {
  if (isDepartmentResearchGuidance(program)) return 'research';
  if (isDepartmentSeniorEssayGuidance(program)) return 'senior_essay';
  return null;
}

export function departmentGuidanceReason(kind: DepartmentGuidanceKind): string {
  return kind === 'senior_essay'
    ? DEPARTMENT_SENIOR_ESSAY_GUIDANCE_REASON
    : DEPARTMENT_RESEARCH_GUIDANCE_REASON;
}
