import { useId } from 'react';
import type { ProgramDateBoundary } from '../../utils/programDates';
import type { ProgramDateDraft } from '../../utils/programDateDraft';

interface Props {
  label: string;
  boundary: ProgramDateBoundary;
  draft: ProgramDateDraft;
  onChange: (draft: ProgramDateDraft) => void;
  labelClassName: string;
  inputClassName: string;
}

const UNTIMED_MEANING: Record<ProgramDateBoundary, string> = {
  deadline: 'Leave the time blank for a deadline at the end of that day.',
  opens: 'Leave the time blank for an opening at the start of that day.',
};

const ProgramDateFields = ({
  label,
  boundary,
  draft,
  onChange,
  labelClassName,
  inputClassName,
}: Props) => {
  const id = useId();
  const dateId = `${id}-date`;
  const timeId = `${id}-time`;
  const hintId = `${id}-hint`;

  return (
    <fieldset aria-describedby={hintId}>
      <legend className={labelClassName}>{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={dateId} className="block text-xs text-muted">
            Date
          </label>
          <input
            id={dateId}
            type="date"
            value={draft.date}
            onChange={(e) =>
              onChange({ date: e.target.value, time: e.target.value ? draft.time : '' })
            }
            className={inputClassName}
          />
        </div>
        <div>
          <label htmlFor={timeId} className="block text-xs text-muted">
            Time (ET, optional)
          </label>
          <input
            id={timeId}
            type="time"
            value={draft.time}
            disabled={!draft.date}
            onChange={(e) => onChange({ ...draft, time: e.target.value })}
            className={inputClassName}
          />
        </div>
      </div>
      <p id={hintId} className="mt-1 text-xs text-muted">
        New York time. {UNTIMED_MEANING[boundary]}
        {!draft.date && ' Pick a date before adding a time.'}
      </p>
    </fieldset>
  );
};

export default ProgramDateFields;
