import type { LabMember } from '../types/labDetail';

/**
 * The four served lead labels, and the priority order the detail page renders them in.
 *
 * Owned here rather than in the page because the lead dedupe is one of the two things
 * #3207 recorded that a stored row does not carry, so anything measuring the served
 * action-link pair needs the same dedupe the page applies. This was a third
 * client-side copy of the four labels, inline in `labDetail.tsx` as
 * `PUBLIC_LEAD_ROLES` and unrecorded in `docs/role-label-dialects.md`.
 *
 * The priority map derives its key set from the label set, so the two cannot drift.
 */
export const PUBLIC_LEAD_ROLE_ORDER = ['pi', 'co-pi', 'director', 'co-director'] as const;

export type PublicLeadRole = (typeof PUBLIC_LEAD_ROLE_ORDER)[number];

export const PUBLIC_LEAD_ROLES: ReadonlySet<string> = new Set(PUBLIC_LEAD_ROLE_ORDER);

export const LEAD_ROLE_PRIORITY: ReadonlyMap<string, number> = new Map(
  PUBLIC_LEAD_ROLE_ORDER.map((role, index) => [role, index]),
);

const UNRANKED_LEAD_ROLE = 99;

const leadRolePriority = (role: string): number =>
  LEAD_ROLE_PRIORITY.get(role) ?? UNRANKED_LEAD_ROLE;

export const memberPersonName = (member: LabMember): string =>
  member.user.displayName || [member.user.fname, member.user.lname].filter(Boolean).join(' ');

export const memberDisplayName = (member: LabMember): string =>
  memberPersonName(member) || 'Lead professor';

const normalizedMemberIdentityPart = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const leadMemberIdentityKey = (member: LabMember): string => {
  const user = member.user;
  const stableId = normalizedMemberIdentityPart(user.netid || user._id);
  if (stableId) return `id:${stableId}`;

  const name = normalizedMemberIdentityPart(memberDisplayName(member));
  const department = normalizedMemberIdentityPart(
    user.primary_department || user.primaryDepartment,
  );
  const title = normalizedMemberIdentityPart(user.title);
  return [name, department, title].filter(Boolean).join('|');
};

export const dedupeLeadMembers = (members: LabMember[]): LabMember[] => {
  const byPerson = new Map<string, LabMember>();

  for (const member of members) {
    if (!PUBLIC_LEAD_ROLES.has(member.role)) continue;
    const key = leadMemberIdentityKey(member);
    if (!key) continue;

    const current = byPerson.get(key);
    if (!current || leadRolePriority(member.role) < leadRolePriority(current.role)) {
      byPerson.set(key, member);
    }
  }

  return Array.from(byPerson.values()).sort(
    (a, b) => leadRolePriority(a.role) - leadRolePriority(b.role),
  );
};
