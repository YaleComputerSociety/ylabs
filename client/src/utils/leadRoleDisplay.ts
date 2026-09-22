import { LabMember, LabMemberRole } from '../types/labDetail';

const TRAINEE_TITLE_PATTERN = /\b(post-?doctoral|post-?doc|research assistant)\b/i;
// A supervisory title alongside the trainee one exempts the person: a lecturer or
// director can supervise whatever else their title says. Mirrored in
// server/src/utils/traineeLevelTitle.ts, whose parity is pinned by a test (#2433).
const SUPERVISORY_TITLE_PATTERN = /\b(professor|lecturer|director|dean|chair)\b/i;

export const isTraineeLevelTitle = (title?: string): boolean => {
  const normalized = (title || '').trim();
  if (!normalized) return false;
  if (SUPERVISORY_TITLE_PATTERN.test(normalized)) return false;
  return TRAINEE_TITLE_PATTERN.test(normalized);
};

const PI_ROLES: ReadonlySet<LabMemberRole> = new Set(['pi', 'co-pi']);
const DIRECTOR_ROLES: ReadonlySet<LabMemberRole> = new Set(['director', 'co-director']);

export type LeadRoleFamily = 'pi' | 'director' | 'other';

export const leadRoleFamily = (member: LabMember): LeadRoleFamily => {
  if (isTraineeLevelTitle(member.user.title)) return 'other';
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
