/**
 * Grid of public lead-investigator cards for a research entity: photo, name,
 * role pill, and department. Reads the department config to canonicalize each
 * lead's raw HR org-unit affiliation, and falls back to an initials avatar when
 * a member headshot is missing or fails to load.
 */
import { useState } from 'react';
import { LabMember, LabMemberRole } from '../../types/labDetail';
import {
  EXTERNAL_IMAGE_REFERRER_POLICY,
  EXTERNAL_LINK_REL,
  safeHttpUrl,
  safeMailtoHref,
} from '../../utils/url';
import { useConfig } from '../../hooks/useConfig';
import { canonicalizeResearcherDepartmentLabel } from '../../utils/researcherDepartmentLabel';
import { DepartmentNameRecord } from '../../utils/departmentNames';
import { cannotOwnResearchHome } from '../../utils/leadRoleDisplay';
import { orcidRecordUrlFromMemberUser } from '../../utils/principalInvestigatorLinks';
import { ExternalLinkIcon } from '../shared/icons';

interface LabMembersListProps {
  members: LabMember[];
  singleColumn?: boolean;
  entityDepartments?: Array<string | undefined | null>;
  resolveMemberProfileUrl?: (member: LabMember) => string | undefined;
}

const ROLE_LABELS: Record<LabMemberRole, string> = {
  pi: 'Principal Investigator',
  'co-pi': 'Co-PI',
  director: 'Director',
  'co-director': 'Co-Director',
  'core-faculty': 'Core Faculty',
  affiliated: 'Affiliated',
  postdoc: 'Postdoctoral Researcher',
  'grad-student': 'Graduate Student',
  undergrad: 'Undergraduate Researcher',
  staff: 'Research Staff',
};

const ROLE_PILL_CLASSES: Record<LabMemberRole, string> = {
  pi: 'bg-[var(--yr-blue-soft)] text-blue-700',
  'co-pi': 'bg-[var(--yr-blue-soft)] text-blue-700',
  director: 'bg-indigo-100 text-indigo-700',
  'co-director': 'bg-indigo-50 text-indigo-700',
  'core-faculty': 'bg-purple-50 text-purple-700',
  affiliated: 'bg-[var(--yr-panel-muted)] text-muted',
  postdoc: 'bg-teal-50 text-teal-700',
  'grad-student': 'bg-emerald-50 text-emerald-700',
  undergrad: 'bg-amber-50 text-amber-800',
  staff: 'bg-slate-100 text-slate-700',
};

const LEAD_ROLES: ReadonlySet<LabMemberRole> = new Set(['pi', 'co-pi', 'director', 'co-director']);

const NEUTRAL_NON_OWNER_ROLE_LABEL = 'Researcher';
const NEUTRAL_NON_OWNER_ROLE_PILL = 'bg-[var(--yr-panel-muted)] text-muted';

// Lower index = more prominent. Sort members so leaders come first.
const ROLE_ORDER: Record<LabMemberRole, number> = {
  pi: 0,
  director: 1,
  'co-pi': 2,
  'co-director': 3,
  'core-faculty': 4,
  affiliated: 5,
  postdoc: 6,
  'grad-student': 7,
  undergrad: 8,
  staff: 9,
};

const LabMemberCard = ({
  user,
  role,
  singleColumn,
  departmentTable,
  pillEligibleLabels,
  entityDepartments,
  profileUrl,
}: {
  user: LabMember['user'];
  role: LabMemberRole;
  singleColumn: boolean;
  departmentTable: DepartmentNameRecord[];
  pillEligibleLabels: readonly string[];
  entityDepartments: Array<string | undefined | null>;
  profileUrl?: string;
}) => {
  const [imageFailed, setImageFailed] = useState(false);
  const fullName = user.displayName || `${user.fname} ${user.lname}`.trim();
  const initials = `${user.fname?.charAt(0) || ''}${user.lname?.charAt(0) || ''}`.toUpperCase();
  const profileImageHref = safeHttpUrl(user.image_url);
  const departmentLabel = canonicalizeResearcherDepartmentLabel(
    user.primary_department || user.primaryDepartment,
    departmentTable,
    { pillEligibleLabels, entityDepartments },
  );
  const isMisattributedLead = LEAD_ROLES.has(role) && cannotOwnResearchHome(user.title);
  const roleLabel = isMisattributedLead ? NEUTRAL_NON_OWNER_ROLE_LABEL : ROLE_LABELS[role];
  const rolePillClassName = isMisattributedLead
    ? NEUTRAL_NON_OWNER_ROLE_PILL
    : ROLE_PILL_CLASSES[role];
  const orcidUrl = orcidRecordUrlFromMemberUser(user);
  const resolvedEmailHref = safeMailtoHref(user.email);

  const isExternalLink = Boolean(profileUrl);
  const isInteractive = isExternalLink;
  const baseClassName = `group flex items-center rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-3 transition-colors ${singleColumn ? 'gap-2' : 'gap-3'}`;
  const linkClassName = `${baseClassName} hover:border-line-brand hover:bg-brand-soft yr-focus-ring`;
  const identityBody = (
    <>
      <div className="flex-shrink-0">
        {profileImageHref && !imageFailed ? (
          <img
            src={profileImageHref}
            alt={fullName}
            referrerPolicy={EXTERNAL_IMAGE_REFERRER_POLICY}
            onError={() => setImageFailed(true)}
            className={`${singleColumn ? 'h-11 w-11' : 'h-14 w-14'} rounded-full object-cover`}
          />
        ) : (
          <div
            className={`${singleColumn ? 'h-11 w-11 text-sm' : 'h-14 w-14'} flex items-center justify-center rounded-full bg-gradient-to-br from-brand-soft to-line-brand font-semibold text-brand`}
          >
            {initials || fullName.charAt(0).toUpperCase() || '?'}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`${singleColumn ? 'text-xs leading-snug' : 'truncate text-sm'} font-semibold text-ink ${isInteractive ? 'group-hover:text-brand' : ''}`}
        >
          {fullName}
        </p>
        {user.title && (
          <p
            className={`${singleColumn ? 'text-[11px] leading-snug' : 'truncate text-xs'} text-muted`}
          >
            {user.title}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            className={`${singleColumn ? 'text-[9px]' : 'text-[10px]'} rounded-full px-1.5 py-0.5 font-medium ${rolePillClassName}`}
          >
            {roleLabel}
          </span>
          {departmentLabel && (
            <span
              className={`${singleColumn ? 'max-w-full whitespace-normal text-[9px] leading-snug' : 'max-w-[10rem] truncate text-[10px]'} rounded-full bg-[var(--yr-panel-muted)] px-1.5 py-0.5 text-ink-soft`}
            >
              {departmentLabel}
            </span>
          )}
        </div>
        {isExternalLink && (
          <p
            className={`${singleColumn ? 'text-[10px]' : 'text-xs'} mt-1.5 font-medium text-brand group-hover:underline`}
          >
            View official profile
          </p>
        )}
      </div>
      {isExternalLink && (
        <ExternalLinkIcon
          className="flex-shrink-0 text-muted transition-colors group-hover:text-brand"
          size={14}
        />
      )}
    </>
  );
  const identityCard =
    isExternalLink && profileUrl ? (
      <a
        href={profileUrl}
        target="_blank"
        rel={EXTERNAL_LINK_REL}
        aria-label={`Open ${fullName}'s official profile`}
        className={linkClassName}
      >
        {identityBody}
      </a>
    ) : (
      <div className={baseClassName}>{identityBody}</div>
    );
  const sideLinkClassName = `${singleColumn ? 'text-[10px]' : 'text-xs'} yr-focus-ring self-start rounded-control px-1 font-medium text-muted hover:text-brand hover:underline`;
  if (!orcidUrl && !resolvedEmailHref) return identityCard;
  return (
    <div className="flex flex-col gap-1">
      {identityCard}
      {orcidUrl && (
        <a
          href={orcidUrl}
          target="_blank"
          rel={EXTERNAL_LINK_REL}
          aria-label={`Open ${fullName}'s ORCID record`}
          className={sideLinkClassName}
        >
          ORCID {user.orcid}
        </a>
      )}
      {resolvedEmailHref && (
        <a href={resolvedEmailHref} aria-label={`Email ${fullName}`} className={sideLinkClassName}>
          {user.email}
        </a>
      )}
    </div>
  );
};

const LabMembersList = ({
  members,
  singleColumn = false,
  entityDepartments = [],
  resolveMemberProfileUrl,
}: LabMembersListProps) => {
  const { departments, departmentPillEligibleLabels } = useConfig();
  if (!members || members.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-[var(--yr-line)] bg-[var(--yr-panel)] px-4 py-6 text-center">
        <p className="text-sm font-semibold text-ink">No principal investigator is attached yet</p>
        <p className="mx-auto mt-1 max-w-xl text-sm leading-relaxed text-ink-soft">
          Check the official profile for current leadership.
        </p>
      </div>
    );
  }

  // Don't mutate the prop.
  const sorted = [...members]
    .filter(({ user, role }, index, rows) => {
      const userKey = user.publicKey || [user.fname, user.lname].filter(Boolean).join(' ');
      const key = `${String(userKey).toLowerCase()}:${role}`;
      return (
        index ===
        rows.findIndex(({ user: candidateUser, role: candidateRole }) => {
          const candidateUserKey =
            candidateUser.publicKey ||
            [candidateUser.fname, candidateUser.lname].filter(Boolean).join(' ');
          return `${String(candidateUserKey).toLowerCase()}:${candidateRole}` === key;
        })
      );
    })
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99));

  return (
    <div
      className={`grid grid-cols-1 gap-4 ${singleColumn ? '' : 'sm:grid-cols-2 lg:grid-cols-3'}`}
    >
      {sorted.map((member) => {
        const { user, role } = member;
        const fullName = user.displayName || `${user.fname} ${user.lname}`.trim();
        const key = `${user.publicKey || fullName}-${role}`;
        return (
          <LabMemberCard
            key={key}
            user={user}
            role={role}
            singleColumn={singleColumn}
            departmentTable={departments}
            pillEligibleLabels={departmentPillEligibleLabels}
            entityDepartments={entityDepartments}
            profileUrl={safeHttpUrl(resolveMemberProfileUrl?.(member))}
          />
        );
      })}
    </div>
  );
};

export default LabMembersList;
