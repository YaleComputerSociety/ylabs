/**
 * Modal shell: backdrop, centered container, Escape-to-close, body-scroll lock,
 * focus trap, and focus restoration (all via useModalBehavior).
 */
import React, { useRef } from 'react';
import ModalCloseButton from './ModalCloseButton';
import useModalBehavior from '../../hooks/useModalBehavior';

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
  closeOnBackdrop?: boolean;
  headerClassName?: string;
  bodyClassName?: string;
}

const sizeClasses: Record<NonNullable<ModalShellProps['size']>, string> = {
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
};

const ModalShell = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'lg',
  closeOnBackdrop = true,
  headerClassName = '',
  bodyClassName = '',
}: ModalShellProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useModalBehavior(isOpen, onClose, containerRef);

  if (!isOpen) return null;

  const handleBackdrop = (e: React.MouseEvent) => {
    if (closeOnBackdrop && e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[1200] flex items-start justify-center overflow-y-auto p-4 pt-16"
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        className={`bg-white rounded-lg shadow-2xl w-full flex flex-col overflow-hidden max-h-[85vh] focus:outline-none ${sizeClasses[size]}`}
      >
        {title !== undefined && (
          <div className={`flex items-start justify-between px-6 py-4 border-b border-gray-200 ${headerClassName}`}>
            <div className="flex-1 min-w-0">{title}</div>
            <ModalCloseButton onClick={onClose} />
          </div>
        )}
        <div className={`flex-1 overflow-y-auto px-6 py-4 ${bodyClassName}`}>
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-200 bg-gray-50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default ModalShell;
