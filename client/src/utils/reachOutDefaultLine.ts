import { isCreativePracticeEntity, isFacultyResearchEntity } from './researchEntityCopy';

export type ReachOutDiscipline = 'lab' | 'socialScience' | 'humanities';

export type ReachOutRenderedContact =
  'leadCardEmail' | 'leadCardProfile' | 'pageAction' | 'directorySearch' | 'officialPages';

export interface ReachOutEntity {
  entityType?: string | null;
  kind?: string | null;
  creativePractice?: boolean | null;
}

const SOCIAL_SCIENCE_CATEGORIES = new Set(['Social Sciences', 'Economics']);
const HUMANITIES_CATEGORY = 'Humanities & Arts';

export const reachOutDiscipline = (
  entity: ReachOutEntity,
  firstDepartmentCategory?: string | null,
): ReachOutDiscipline => {
  if (isCreativePracticeEntity(entity)) return 'humanities';
  if (!isFacultyResearchEntity(entity)) return 'lab';
  if (firstDepartmentCategory === HUMANITIES_CATEGORY) return 'humanities';
  if (firstDepartmentCategory && SOCIAL_SCIENCE_CATEGORIES.has(firstDepartmentCategory)) {
    return 'socialScience';
  }
  return 'lab';
};

interface ReachOutRoute {
  prefix: string;
  contactLinkText?: string;
}

const ROUTES: Record<ReachOutRenderedContact, (leadEmail?: string) => ReachOutRoute> = {
  leadCardEmail: (leadEmail) =>
    leadEmail
      ? { prefix: 'at ', contactLinkText: leadEmail }
      : { prefix: 'at the address on their card' },
  leadCardProfile: () => ({ prefix: 'through ', contactLinkText: 'their official profile' }),
  pageAction: () => ({ prefix: 'through the link below' }),
  directorySearch: () => ({ prefix: 'after finding their address in the Yale Directory below' }),
  officialPages: () => ({ prefix: 'through the official pages listed below' }),
};

const leadNoun = (entity: ReachOutEntity, discipline: ReachOutDiscipline): string =>
  discipline !== 'lab' || isFacultyResearchEntity(entity) ? 'the professor' : 'the lead';

const ASK_CLAUSES: Record<ReachOutDiscipline, string> = {
  lab: 'name one project from this page and any related coursework, and ask if they have room for an undergraduate this term or next.',
  socialScience:
    'name a topic from this page and ask whether they have research-assistant or data work an undergraduate could help with.',
  humanities:
    'name a topic from this page and ask whether they would advise a senior essay or independent study on it.',
};

export interface ReachOutLineParts {
  lead: string;
  contactLinkText?: string;
  rest: string;
}

export const reachOutLineParts = ({
  entity,
  firstDepartmentCategory,
  renderedContact,
  leadEmail,
}: {
  entity: ReachOutEntity;
  firstDepartmentCategory?: string | null;
  renderedContact: ReachOutRenderedContact;
  leadEmail?: string;
}): ReachOutLineParts => {
  const discipline = reachOutDiscipline(entity, firstDepartmentCategory);
  const officeHours = discipline === 'humanities' ? ', or by going to their office hours' : '';
  const route = ROUTES[renderedContact](leadEmail?.trim() || undefined);
  return {
    lead: `Most undergraduates get started by emailing ${leadNoun(entity, discipline)} ${route.prefix}`,
    ...(route.contactLinkText ? { contactLinkText: route.contactLinkText } : {}),
    rest: `${officeHours}: ${ASK_CLAUSES[discipline]}`,
  };
};

export const reachOutLineText = ({ lead, contactLinkText = '', rest }: ReachOutLineParts): string =>
  `${lead}${contactLinkText}${rest}`;

export const reachOutDefaultLine = (options: Parameters<typeof reachOutLineParts>[0]): string =>
  reachOutLineText(reachOutLineParts(options));
