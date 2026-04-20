/**
 * Department chip list: primary highlighted in blue, secondaries in gray.
 * Shared between ProfileHeader and ProfileEditor view-mode so the two can't drift.
 */
import React from 'react';

interface DepartmentChipsProps {
  primary?: string | null;
  secondary?: string[] | null;
  size?: 'xs' | 'sm';
  className?: string;
}

const DepartmentChips = React.memo(({ primary, secondary, size = 'xs', className = '' }: DepartmentChipsProps) => {
  const secondaries = (secondary || []).filter(Boolean);
  if (!primary && secondaries.length === 0) return null;

  const textSize = size === 'sm' ? 'text-sm' : 'text-xs';

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {primary && (
        <span className={`${textSize} rounded-md px-2 py-1 bg-blue-100 text-blue-700 font-medium`}>
          {primary}
        </span>
      )}
      {secondaries.map((dept) => (
        <span key={dept} className={`${textSize} rounded-md px-2 py-1 bg-gray-100 text-gray-600`}>
          {dept}
        </span>
      ))}
    </div>
  );
});

DepartmentChips.displayName = 'DepartmentChips';

export default DepartmentChips;
