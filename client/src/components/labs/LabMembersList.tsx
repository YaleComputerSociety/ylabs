/**
 * Grid of member cards for a lab: photo, name, role pill, department,
 * link to /profile/:netid.
 *
 * Pure presentational — receives the member list as a prop.
 */
import { Link } from 'react-router-dom';
import { LabMember, LabMemberRole } from '../../types/labDetail';

interface LabMembersListProps {
  members: LabMember[];
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
  pi: 'bg-blue-100 text-blue-700',
  'co-pi': 'bg-blue-50 text-blue-700',
  director: 'bg-indigo-100 text-indigo-700',
  'co-director': 'bg-indigo-50 text-indigo-700',
  'core-faculty': 'bg-purple-50 text-purple-700',
  affiliated: 'bg-gray-100 text-gray-600',
  alumni: 'bg-gray-50 text-gray-500',
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

const LabMembersList = ({ members }: LabMembersListProps) => {
  if (!members || members.length === 0) {
    return <p className="text-gray-500 text-sm py-8 text-center">No members listed yet.</p>;
  }

  // Don't mutate the prop.
  const sorted = [...members].sort(
    (a, b) => (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99),
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {sorted.map(({ user, role }) => {
        const fullName = `${user.fname} ${user.lname}`.trim();
        const initials = `${user.fname?.charAt(0) || ''}${
          user.lname?.charAt(0) || ''
        }`.toUpperCase();
        return (
          <Link
            key={user.netid}
            to={`/profile/${user.netid}`}
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all bg-white"
          >
            <div className="flex-shrink-0">
              {user.image_url ? (
                <img
                  src={user.image_url}
                  alt={fullName}
                  className="w-14 h-14 rounded-full object-cover"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center text-blue-700 font-semibold">
                  {initials || '?'}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 truncate">{fullName}</p>
              {user.title && (
                <p className="text-xs text-gray-500 truncate">{user.title}</p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ROLE_PILL_CLASSES[role]}`}
                >
                  {ROLE_LABELS[role]}
                </span>
                {user.primary_department && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-500 truncate max-w-[10rem]">
                    {user.primary_department}
                  </span>
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
};

export default LabMembersList;
