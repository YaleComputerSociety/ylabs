/**
 * Grid of public lead-investigator cards for a research entity: photo, name,
 * role pill, and department. Reads the department config to canonicalize each
 * lead's raw HR org-unit affiliation, and falls back to an initials avatar when
 * a member headshot is missing or fails to load.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LabMember, LabMemberRole } from '../../types/labDetail';
import { EXTERNAL_IMAGE_REFERRER_POLICY, EXTERNAL_LINK_REL, safeHttpUrl } from '../../utils/url';
import { useConfig } from '../../hooks/useConfig';
import { canonicalizeResearcherDepartmentLabel } from '../../utils/researcherDepartmentLabel';
import { DepartmentNameRecord } from '../../utils/departmentNames';
import { isTraineeLevelTitle } from '../../utils/leadRoleDisplay';

interface LabMembersListProps {
  members: LabMember[];
  singleColumn?: boolean;
  entityDepartments?: Array<string | undefined | null>;
  resolveMemberProfileUrl?: (member: LabMember) => string | undefined;
  resolvePersonHref?: (member: LabMember) => string | undefined;
}

const ROLE_LABELS: Record<LabMemberRole, string> = {
  pi: 'Principal Investigator',
  'co-pi': 'Co-PI',
  director: 'Director',
  'co-director': 'Co-Director',
  'core-faculty': 'Core Faculty',
  affiliated: 'Affiliated',
  alumni: 'Alumni',
  postdoc: 'Postdoctoral Researcher',
  'grad-student': 'Graduate Student',
  undergrad: 'Undergraduate Researcher',
  staff: 'Research Staff',
  affiliate: 'Other Current Member',
};

const ROLE_PILL_CLASSES: Record<LabMemberRole, string> = {
  pi: 'bg-[var(--yr-blue-soft)] text-blue-700',
  'co-pi': 'bg-[var(--yr-blue-soft)] text-blue-700',
  director: 'bg-indigo-100 text-indigo-700',
  'co-director': 'bg-indigo-50 text-indigo-700',
  'core-faculty': 'bg-purple-50 text-purple-700',
  affiliated: 'bg-[var(--yr-panel-muted)] text-gray-600',
  alumni: 'bg-[var(--yr-panel-muted)] text-gray-500',
  postdoc: 'bg-teal-50 text-teal-700',
  'grad-student': 'bg-emerald-50 text-emerald-700',
  undergrad: 'bg-amber-50 text-amber-800',
  staff: 'bg-slate-100 text-slate-700',
  affiliate: 'bg-[var(--yr-panel-muted)] text-gray-600',
};

const LEAD_ROLES: ReadonlySet<LabMemberRole> = new Set(['pi', 'co-pi', 'director', 'co-director']);

const NEUTRAL_TRAINEE_ROLE_LABEL = 'Researcher';
const NEUTRAL_TRAINEE_ROLE_PILL = 'bg-[var(--yr-panel-muted)] text-gray-600';

// Lower index = more prominent. Sort members so leaders come first.
const ROLE_ORDER: Record<LabMemberRole, number> = {
  pi: 0,
  director: 1,
  'co-pi': 2,
  'co-director': 3,
  'core-faculty': 4,
  affiliated: 5,
  alumni: 6,
  postdoc: 7,
  'grad-student': 8,
  undergrad: 9,
  staff: 10,
  affiliate: 11,
};

const ExternalLinkIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="flex-shrink-0 text-gray-400 transition-colors group-hover:text-blue-600"
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const LabMemberCard = ({
  user,
  role,
  singleColumn,
  departmentTable,
  entityDepartments,
  profileUrl,
  personHref,
}: {
  user: LabMember['user'];
  role: LabMemberRole;
  singleColumn: boolean;
  departmentTable: DepartmentNameRecord[];
  entityDepartments: Array<string | undefined | null>;
  profileUrl?: string;
  personHref?: string;
}) => {
  const [imageFailed, setImageFailed] = useState(false);
  const fullName = user.displayName || `${user.fname} ${user.lname}`.trim();
  const initials = `${user.fname?.charAt(0) || ''}${user.lname?.charAt(0) || ''}`.toUpperCase();
  const profileImageHref = safeHttpUrl(user.image_url);
  const departmentLabel = canonicalizeResearcherDepartmentLabel(
    user.primary_department || user.primaryDepartment,
    departmentTable,
    entityDepartments,
  );
  const isMisattributedTraineeLead = LEAD_ROLES.has(role) && isTraineeLevelTitle(user.title);
  const roleLabel = isMisattributedTraineeLead ? NEUTRAL_TRAINEE_ROLE_LABEL : ROLE_LABELS[role];
  const rolePillClassName = isMisattributedTraineeLead
    ? NEUTRAL_TRAINEE_ROLE_PILL
    : ROLE_PILL_CLASSES[role];
  const isExternalLink = Boolean(profileUrl) && !personHref;
  const isInteractive = isExternalLink || Boolean(personHref);
  const baseClassName = `group flex items-center rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] p-3 transition ${singleColumn ? 'gap-2' : 'gap-3'}`;
  const linkClassName = `${baseClassName} hover:border-blue-300 hover:bg-[var(--yr-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200`;
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
            className={`${singleColumn ? 'h-11 w-11 text-sm' : 'h-14 w-14'} flex items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-blue-200 font-semibold text-blue-700`}
          >
            {initials || fullName.charAt(0).toUpperCase() || '?'}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`${singleColumn ? 'text-xs leading-snug' : 'truncate text-sm'} font-semibold text-gray-900 ${isInteractive ? 'group-hover:text-blue-700' : ''}`}
        >
          {fullName}
        </p>
        {user.title && (
          <p
            className={`${singleColumn ? 'text-[11px] leading-snug' : 'truncate text-xs'} text-gray-500`}
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
              className={`${singleColumn ? 'max-w-full whitespace-normal text-[9px] leading-snug' : 'max-w-[10rem] truncate text-[10px]'} rounded-full bg-[var(--yr-panel-muted)] px-1.5 py-0.5 text-gray-700`}
            >
              {departmentLabel}
            </span>
          )}
        </div>
      </div>
      {isExternalLink && <ExternalLinkIcon />}
    </>
  );
  if (personHref) {
    return (
      <div className={`${baseClassName} flex-col !items-stretch`}>
        <Link
          to={personHref}
          aria-label={`View ${fullName}'s Yale Research profile`}
          className={`group flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${singleColumn ? 'gap-2' : 'gap-3'}`}
        >
          {identityBody}
        </Link>
        {profileUrl && (
          <a
            href={profileUrl}
            target="_blank"
            rel={EXTERNAL_LINK_REL}
            aria-label={`Open ${fullName}'s official profile`}
            className="mt-2 inline-flex items-center gap-1 self-start rounded-sm text-xs font-semibold text-[var(--yr-blue)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            View official profile
            <ExternalLinkIcon />
          </a>
        )}
      </div>
    );
  }
  if (isExternalLink && profileUrl) {
    return (
      <a
        href={profileUrl}
        target="_blank"
        rel={EXTERNAL_LINK_REL}
        aria-label={`Open ${fullName}'s official profile`}
        className={linkClassName}
      >
        {identityBody}
      </a>
    );
  }
  return <div className={baseClassName}>{identityBody}</div>;
};

const LabMembersList = ({
  members,
  singleColumn = false,
  entityDepartments = [],
  resolveMemberProfileUrl,
  resolvePersonHref,
}: LabMembersListProps) => {
  const { departments } = useConfig();
  if (!members || members.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--yr-line)] bg-[var(--yr-panel)] px-4 py-6 text-center">
        <p className="text-sm font-semibold text-gray-900">
          No principal investigator is attached yet
        </p>
        <p className="mx-auto mt-1 max-w-xl text-sm leading-relaxed text-gray-700">
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
            entityDepartments={entityDepartments}
            profileUrl={safeHttpUrl(resolveMemberProfileUrl?.(member))}
            personHref={resolvePersonHref?.(member)}
          />
        );
      })}
    </div>
  );
};

export default LabMembersList;
