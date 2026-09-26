import { LabMember, LabMemberRole } from '../types/labDetail';

const TRAINEE_TITLE_PATTERN =
  /\b(post-?doctoral|post-?doc|research assistant|(?:ph\.?\s?d|doctoral|graduate|undergraduate|masters?|m\.?s)\.?\s+(?:student|candidate)|intern|pre-?doctoral|trainee)\b/i;
// A bare "Student", "MA Student" or "IDE Alumni" carries no degree qualifier, so the
// alternatives above never reach it. Two anchors keep the widening safe: the noun must
// end its clause, separating a rank ("IDE Student") from a modifier ("International
// Student Adviser"), and it must fall in the title's opening words, because an
// appointment names its rank there and prose does not. Mirrored in
// server/src/utils/traineeLevelTitle.ts, whose parity is pinned by a test (#2433).
const TRAINEE_HEAD_NOUN_PATTERN =
  /^(?:\S+\s+){0,3}(students?|alumn(?:us|a|i|ae))\s*(?:$|[,;&()/]|\band\b)/i;
// A supervisory title alongside the trainee one exempts the person: a lecturer or
// director can supervise whatever else their title says. Mirrored in
// server/src/utils/traineeLevelTitle.ts, whose parity is pinned by a test (#2433).
const SUPERVISORY_TITLE_PATTERN = /\b(professor|lecturer|director|dean|chair)\b/i;
// Yale profile titles arrive with U+00AD soft hyphens inside words, which defeat every
// \b-anchored read of them, the supervisory exemption included.
const SOFT_HYPHEN_PATTERN = /­/g;

export const isTraineeLevelTitle = (title?: string): boolean => {
  const normalized = (title || '').replace(SOFT_HYPHEN_PATTERN, '').trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (SUPERVISORY_TITLE_PATTERN.test(normalized)) return false;
  return TRAINEE_TITLE_PATTERN.test(normalized) || TRAINEE_HEAD_NOUN_PATTERN.test(normalized);
};

// An administrative, financial, technical or courtesy staff appointment is not a
// research appointment, so such a person does not own the research entity they are
// listed as leading. The Yale research-scientist and research-scholar ladder is
// exempt: independence is not readable from that string (#1897). Mirrored in
// server/src/utils/nonResearchStaffTitle.ts, whose parity is pinned by a test (#2433).
// Every head noun accepts its plural, because the corpus stores plural title
// categories ("Research Affiliates") that a singular noun followed by \b refuses.
const NON_RESEARCH_STAFF_TITLE_PATTERN =
  /\b(programmers?|analysts?|biostatisticians?|statisticians?|coordinators?|managers?|administrators?|technicians?|specialists?|research affiliates?)\b/i;
const RESEARCH_APPOINTMENT_TITLE_PATTERN = /\bresearch (?:scientists?|scholars?|associates?)\b/i;

export const isNonResearchStaffTitle = (title?: string): boolean => {
  const normalized = (title || '').replace(SOFT_HYPHEN_PATTERN, '').trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (SUPERVISORY_TITLE_PATTERN.test(normalized)) return false;
  if (RESEARCH_APPOINTMENT_TITLE_PATTERN.test(normalized)) return false;
  return NON_RESEARCH_STAFF_TITLE_PATTERN.test(normalized);
};

export const cannotOwnResearchHome = (title?: string): boolean =>
  isTraineeLevelTitle(title) || isNonResearchStaffTitle(title);

const PI_ROLES: ReadonlySet<LabMemberRole> = new Set(['pi', 'co-pi']);
const DIRECTOR_ROLES: ReadonlySet<LabMemberRole> = new Set(['director', 'co-director']);

export type LeadRoleFamily = 'pi' | 'director' | 'other';

export const leadRoleFamily = (member: LabMember): LeadRoleFamily => {
  if (cannotOwnResearchHome(member.user.title)) return 'other';
  if (PI_ROLES.has(member.role)) return 'pi';
  if (DIRECTOR_ROLES.has(member.role)) return 'director';
  return 'other';
};

export const leadSectionHeading = (members: LabMember[]): string => {
  if (members.length === 0) return 'Principal Investigator';
  const families = new Set(members.map(leadRoleFamily));
  if (families.size === 1) {
    if (families.has('pi')) {
      return members.length > 1 ? 'Principal Investigators' : 'Principal Investigator';
    }
    if (families.has('director')) {
      return members.length > 1 ? 'Directors' : 'Director';
    }
  }
  return 'Leadership';
};
