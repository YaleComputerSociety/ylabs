/**
 * Standard close button for modals. X icon, subtle hover.
 */
import React from 'react';

interface ModalCloseButtonProps {
  onClick: (e: React.MouseEvent) => void;
  label?: string;
}

const ModalCloseButton = ({ onClick, label = 'Close' }: ModalCloseButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
);

export default ModalCloseButton;
