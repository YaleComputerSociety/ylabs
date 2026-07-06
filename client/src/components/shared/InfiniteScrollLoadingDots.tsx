import LoadingSpinner from './LoadingSpinner';

interface InfiniteScrollLoadingDotsProps {
  label: string;
}

const InfiniteScrollLoadingDots = ({ label }: InfiniteScrollLoadingDotsProps) => (
  <div
    role="status"
    aria-live="polite"
    className="flex flex-col items-center justify-center gap-2 py-6 text-sm text-gray-600"
  >
    <LoadingSpinner size="md" inline />
    <span>{label}</span>
  </div>
);

export default InfiniteScrollLoadingDots;
