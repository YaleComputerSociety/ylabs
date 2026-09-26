/**
 * Status indicator badge for listing confirmation state.
 * Uses icon + text so the cue is not color-only.
 */
import React from 'react';
import { CheckIcon, CloseIcon } from './icons';

interface StatusBadgeProps {
  isOpen: boolean;
}

const OpenIcon = () => <CheckIcon size={10} />;

const ClosedIcon = () => <CloseIcon size={10} />;

const StatusBadge = React.memo(({ isOpen }: StatusBadgeProps) => (
  <span
    className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
      isOpen ? 'bg-green-100 text-green-700' : 'bg-[var(--yr-panel-muted)] text-muted'
    }`}
  >
    {isOpen ? <OpenIcon /> : <ClosedIcon />}
    {isOpen ? 'Open' : 'Closed'}
  </span>
));

StatusBadge.displayName = 'StatusBadge';

export default StatusBadge;
