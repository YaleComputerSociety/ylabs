import React from 'react';

interface StatusBadgeProps {
  isOpen: boolean;
}

const StatusBadge = React.memo(({ isOpen }: StatusBadgeProps) => (
  <span
    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
      isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
    }`}
  >
    {isOpen ? 'Open' : 'Closed'}
  </span>
));

StatusBadge.displayName = 'StatusBadge';

export default StatusBadge;
