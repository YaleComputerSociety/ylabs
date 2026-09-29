interface LoadErrorNoticeProps {
  title: string;
  detail: string;
  onRetry: () => void;
  headingLevel?: 2 | 3;
}

const LoadErrorNotice = ({ title, detail, onRetry, headingLevel = 3 }: LoadErrorNoticeProps) => {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div role="alert" className="rounded-card border border-amber-200 bg-amber-50 p-5 text-center">
      <Heading className="text-base font-semibold text-amber-900">{title}</Heading>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-amber-900">{detail}</p>
      <button
        type="button"
        onClick={onRetry}
        className="yr-pressable yr-focus-ring mt-4 inline-flex min-h-[44px] items-center rounded-control border border-brand bg-panel px-3 py-2 text-sm font-semibold text-brand transition-colors hover:bg-[var(--yr-panel-muted)]"
      >
        Try again
      </button>
    </div>
  );
};

export default LoadErrorNotice;
