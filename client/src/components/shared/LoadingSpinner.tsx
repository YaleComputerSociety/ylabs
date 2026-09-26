/**
 * Reusable loading spinner component.
 */
import { useEffect, useState } from 'react';
import { PulseLoader } from 'react-spinners';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  inline?: boolean;
  /** Set false to paint immediately, for a surface that is known to be slow. */
  deferred?: boolean;
}

const sizeMap = { sm: 6, md: 10, lg: 15 };

/**
 * A response faster than this never shows a spinner, and once shown the spinner
 * stays for the minimum so it cannot flash. Without both halves a quick load
 * produces a single frame of spinner, which reads as a glitch rather than as
 * progress.
 */
const SHOW_AFTER_MS = 200;
const MIN_VISIBLE_MS = 400;

export const useDeferredVisibility = (enabled: boolean): boolean => {
  const [visible, setVisible] = useState(!enabled);
  const [shownAt, setShownAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || visible) return undefined;
    const timer = setTimeout(() => {
      setVisible(true);
      setShownAt(Date.now());
    }, SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [enabled, visible]);

  useEffect(() => {
    if (shownAt === null) return undefined;
    const remaining = MIN_VISIBLE_MS - (Date.now() - shownAt);
    if (remaining <= 0) return undefined;
    const timer = setTimeout(() => setShownAt(null), remaining);
    return () => clearTimeout(timer);
  }, [shownAt]);

  return visible;
};

const LoadingSpinner = ({ size = 'md', inline = false, deferred = true }: LoadingSpinnerProps) => {
  const visible = useDeferredVisibility(deferred);

  const loader = <PulseLoader color="var(--yr-blue)" size={sizeMap[size]} loading={visible} />;

  if (inline) return loader;

  return <div className="flex min-h-[2.5rem] items-center justify-center py-4">{loader}</div>;
};

export default LoadingSpinner;
