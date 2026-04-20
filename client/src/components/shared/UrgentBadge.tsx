/**
 * Urgency indicator for fellowships with deadlines <= 14 days away.
 */
import React from 'react';

interface UrgentBadgeProps {
  daysUntil: number;
  variant: 'banner' | 'inline';
}

const UrgentBadge = ({ daysUntil, variant }: UrgentBadgeProps) => {
  const text = daysUntil === 1 ? 'Due tomorrow' : `${daysUntil} days left`;

  if (variant === 'banner') {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-3 py-1.5">
        <p className="text-sm font-medium text-amber-700">{text}</p>
      </div>
    );
  }

  return (
    <span className="text-xs font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded mb-1 inline-block">
      {text}
    </span>
  );
};

export default UrgentBadge;
