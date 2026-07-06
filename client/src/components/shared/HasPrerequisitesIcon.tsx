/**
 * Tooltip icon shown when a listing has applicant prerequisites.
 * Focusable via keyboard with aria-describedby so the tip is announced by SRs.
 */
import React, { useId } from 'react';

interface HasPrerequisitesIconProps {
  size?: number;
}

const HasPrerequisitesIcon = ({ size = 16 }: HasPrerequisitesIconProps) => {
  const tipId = useId();
  return (
    <span
      className="relative group/tip inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
      tabIndex={0}
      role="img"
      aria-label="Has application details"
      aria-describedby={tipId}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#9ca3af"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="hover:stroke-amber-600 group-focus/tip:stroke-amber-600 transition-colors"
        aria-hidden="true"
      >
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
        <path d="M9 17h6" />
        <path d="M9 13h6" />
      </svg>
      <span
        id={tipId}
        role="tooltip"
        className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800/75 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover/tip:opacity-100 group-focus/tip:opacity-100 transition-opacity pointer-events-none z-20"
      >
        Has Application Details
      </span>
    </span>
  );
};

export default HasPrerequisitesIcon;
