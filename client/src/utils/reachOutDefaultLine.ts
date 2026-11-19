import { isCreativePracticeEntity, isFacultyResearchEntity } from './researchEntityCopy';

export type ReachOutDiscipline = 'lab' | 'socialScience' | 'humanities';

export type ReachOutRenderedContact =
  'leadCardEmail' | 'leadCardProfile' | 'pageAction' | 'directorySearch' | 'officialPages';

export type ReachOutContact =
  | { kind: 'leadCardEmail'; email: string }
  | { kind: Exclude<ReachOutRenderedContact, 'leadCardEmail'> };

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
  verb: 'emailing' | 'contacting';
  prefix: string;
  contactLinkText?: string;
}

// The block's own action is a website or a join page, which may carry no address, so
// that route promises contact rather than an email (#6090).
const ROUTES: Record<Exclude<ReachOutRenderedContact, 'leadCardEmail'>, ReachOutRoute> = {
  leadCardProfile: {
    verb: 'emailing',
    prefix: 'through ',
    contactLinkText: 'their official profile',
  },
  pageAction: { verb: 'contacting', prefix: 'through the link below' },
  directorySearch: {
    verb: 'emailing',
    prefix: 'after finding their address in the Yale Directory below',
  },
  officialPages: { verb: 'emailing', prefix: 'through the official pages listed below' },
};

const reachOutRoute = (contact: ReachOutContact): ReachOutRoute =>
  contact.kind === 'leadCardEmail'
    ? { verb: 'emailing', prefix: 'at ', contactLinkText: contact.email }
    : ROUTES[contact.kind];

const leadNoun = (entity: ReachOutEntity, discipline: ReachOutDiscipline): string =>
  discipline !== 'lab' || isFacultyResearchEntity(entity) ? 'the professor' : 'the lead';

const ASK_CLAUSES: Record<ReachOutDiscipline, string> = {
  lab: 'name a topic from this page and any related coursework, and ask if they have room for an undergraduate this term or next.',
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
  contact,
}: {
  entity: ReachOutEntity;
  firstDepartmentCategory?: string | null;
  contact: ReachOutContact;
}): ReachOutLineParts => {
  const discipline = reachOutDiscipline(entity, firstDepartmentCategory);
  const officeHours = discipline === 'humanities' ? ', or by going to their office hours' : '';
  const route = reachOutRoute(contact);
  return {
    lead: `Most undergraduates get started by ${route.verb} ${leadNoun(entity, discipline)} ${route.prefix}`,
    ...(route.contactLinkText ? { contactLinkText: route.contactLinkText } : {}),
    rest: `${officeHours}: ${ASK_CLAUSES[discipline]}`,
  };
};
