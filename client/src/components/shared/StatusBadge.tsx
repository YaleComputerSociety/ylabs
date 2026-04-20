/**
 * Status indicator badge for listing confirmation state.
 * Uses icon + text so the cue is not color-only.
 */
import React from 'react';

interface StatusBadgeProps {
  isOpen: boolean;
}

const OpenIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ClosedIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const StatusBadge = React.memo(({ isOpen }: StatusBadgeProps) => (
  <span
    className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
      isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
    }`}
  >
    {isOpen ? <OpenIcon /> : <ClosedIcon />}
    {isOpen ? 'Open' : 'Closed'}
  </span>
));

StatusBadge.displayName = 'StatusBadge';

export default StatusBadge;
