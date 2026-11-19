import { useEffect, useId, useRef, useState } from 'react';
import { InfoIcon } from './icons';

interface InfoTipProps {
  label: string;
  text: string;
  tipId?: string;
  align?: 'start' | 'end';
  className?: string;
}

// The tip text stays in the DOM while closed so other controls can name it in
// aria-describedby; a referenced node is read even when it is hidden.
const InfoTip = ({ label, text, tipId, align = 'start', className = '' }: InfoTipProps) => {
  const ownId = useId();
  const id = tipId ?? ownId;
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const closeOnOutsidePress = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('mousedown', closeOnOutsidePress);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('mousedown', closeOnOutsidePress);
    };
  }, [open]);

  return (
    <span
      ref={wrapperRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="yr-focus-ring inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:text-ink"
      >
        <InfoIcon size={14} />
      </button>
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className={`absolute ${align === 'end' ? 'right-0' : 'left-0'} top-full z-20 mt-1 w-56 rounded-control border border-[var(--yr-line)] bg-[var(--yr-panel)] px-2.5 py-1.5 text-xs font-normal leading-snug text-ink-soft shadow-yr-overlay`}
      >
        {text}
      </span>
    </span>
  );
};

export default InfoTip;
