import { LabContactRoute, LabMember } from '../types/labDetail';
import { ResearchGroup } from '../types/researchGroup';

export interface LabOutreachContact {
  email: string;
  lname: string;
  name?: string;
  role?: string;
}

const DIRECT_CONTACT_POLICIES = new Set(['DIRECT_CONTACT_OK', 'UNKNOWN', undefined]);
const DIRECT_ROUTE_TYPES = new Set(['FACULTY_PI', 'LAB_MANAGER', 'PROGRAM_MANAGER', 'DEPARTMENT_CONTACT']);

const memberLastName = (member?: LabMember): string =>
  String(member?.user?.lname || '').trim();

const routeDisplayName = (route: LabContactRoute): string =>
  String(route.name || route.label || '').trim();

const lastToken = (value: string): string => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
};

const matchingLeadMemberLastName = (members: LabMember[], route: LabContactRoute): string => {
  const routeName = routeDisplayName(route).toLowerCase();
  const match = members.find((member) => {
    const memberName = [member.user?.fname, member.user?.lname]
      .filter(Boolean)
      .join(' ')
      .trim()
      .toLowerCase();
    return routeName && memberName && routeName === memberName;
  });
  return memberLastName(match);
};

export const resolveLabOutreachContact = (
  group: ResearchGroup,
  members: LabMember[],
  contactRoutes: LabContactRoute[] = [],
): LabOutreachContact | null => {
  if (group.contactEmail) {
    const leadMember = members.find((m) => m.role === 'pi' || m.role === 'director');
    return {
      email: group.contactEmail,
      lname: memberLastName(leadMember) || group.contactName || '',
      name: group.contactName || undefined,
      role: group.contactRole || undefined,
    };
  }

  const route = contactRoutes
    .filter(
      (item) =>
        item.email &&
        DIRECT_ROUTE_TYPES.has(item.routeType) &&
        DIRECT_CONTACT_POLICIES.has(item.contactPolicy),
    )
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))[0];
  if (!route?.email) return null;

  const name = routeDisplayName(route);
  return {
    email: route.email,
    lname: matchingLeadMemberLastName(members, route) || lastToken(name),
    name: name || undefined,
    role: route.role,
  };
};
