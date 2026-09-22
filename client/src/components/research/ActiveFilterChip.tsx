interface ActiveFilterChipProps {
  axis: string;
  value: string;
  onRemove: () => void;
}

const ActiveFilterChip = ({ axis, value, onRemove }: ActiveFilterChipProps) => (
  <button
    type="button"
    onClick={onRemove}
    aria-label={`Remove ${axis}: ${value}`}
    className="yr-focus-ring inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 text-sm text-slate-700"
  >
    <span className="min-w-0 truncate">
      {axis}: {value}
    </span>
    <span aria-hidden="true" className="shrink-0">
      ×
    </span>
  </button>
);

export default ActiveFilterChip;
