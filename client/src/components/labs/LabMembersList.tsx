/**
 * Grid of public lead-investigator cards for a research entity: photo, name,
 * role pill, and department.
 *
 * Pure presentational — receives the member list as a prop.
 */
import { LabMember, LabMemberRole } from '../../types/labDetail';
import { EXTERNAL_IMAGE_REFERRER_POLICY, safeHttpUrl } from '../../utils/url';

interface LabMembersListProps {
  members: LabMember[];
  singleColumn?: boolean;
}

const ROLE_LABELS: Record<LabMemberRole, string> = {
  pi: 'Principal Investigator',
  'co-pi': 'Co-PI',
  director: 'Director',
  'co-director': 'Co-Director',
  'core-faculty': 'Core Faculty',
  affiliated: 'Affiliated',
  alumni: 'Alumni',
};

const ROLE_PILL_CLASSES: Record<LabMemberRole, string> = {
  pi: 'bg-[var(--yr-blue-soft)] text-blue-700',
  'co-pi': 'bg-[var(--yr-blue-soft)] text-blue-700',
  director: 'bg-indigo-100 text-indigo-700',
  'co-director': 'bg-indigo-50 text-indigo-700',
  'core-faculty': 'bg-purple-50 text-purple-700',
  affiliated: 'bg-[var(--yr-panel-muted)] text-gray-600',
  alumni: 'bg-[var(--yr-panel-muted)] text-gray-500',
};

// Lower index = more prominent. Sort members so leaders come first.
const ROLE_ORDER: Record<LabMemberRole, number> = {
  pi: 0,
  director: 1,
  'co-pi': 2,
  'co-director': 3,
  'core-faculty': 4,
  affiliated: 5,
  alumni: 6,
};

const LabMembersList = ({ members, singleColumn = false }: LabMembersListProps) => {
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
      {sorted.map(({ user, role }) => {
        const fullName = user.displayName || `${user.fname} ${user.lname}`.trim();
        const initials = `${user.fname?.charAt(0) || ''}${
          user.lname?.charAt(0) || ''
        }`.toUpperCase();
        const profileImageHref = safeHttpUrl(user.image_url);
        const content = (
          <>
            <div className="flex-shrink-0">
              {profileImageHref ? (
                <img
                  src={profileImageHref}
                  alt={fullName}
                  referrerPolicy={EXTERNAL_IMAGE_REFERRER_POLICY}
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
                className={`${singleColumn ? 'text-xs leading-snug' : 'truncate text-sm'} font-semibold text-gray-900`}
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
                  className={`${singleColumn ? 'text-[9px]' : 'text-[10px]'} rounded-full px-1.5 py-0.5 font-medium ${ROLE_PILL_CLASSES[role]}`}
                >
                  {ROLE_LABELS[role]}
                </span>
                {user.primary_department && (
                  <span
                    className={`${singleColumn ? 'max-w-full whitespace-normal text-[9px] leading-snug' : 'max-w-[10rem] truncate text-[10px]'} rounded-full bg-[var(--yr-panel-muted)] px-1.5 py-0.5 text-gray-500`}
                  >
                    {user.primary_department}
                  </span>
                )}
              </div>
            </div>
          </>
        );
        const className = `flex items-center rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] p-3 transition ${singleColumn ? 'gap-2' : 'gap-3'}`;
        const key = `${user.publicKey || fullName}-${role}`;
        // Lead-investigator cards are intentionally non-interactive: the
        // professor's official profile is reached via the decision-summary
        // action buttons, so the card name is not a duplicate link.
        return (
          <div key={key} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
};

export default LabMembersList;
