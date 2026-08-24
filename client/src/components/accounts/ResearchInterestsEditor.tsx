/**
 * Account surface for a student's self-declared research interests.
 *
 * Interests are chosen only from the governed research-area vocabulary (the same
 * terms the /research search box suggests) and persisted to the account. When
 * set, they personalize the default "Recommended" order on the Research page.
 * See issue #1468.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from '../../utils/axios';
import useConfig from '../../hooks/useConfig';
import ResearchAreaTypeahead from '../research/ResearchAreaTypeahead';
import LoadingSpinner from '../shared/LoadingSpinner';

const MAX_INTERESTS = 15;
const CURRENT_CLASS_YEAR = 2026;
const GRADUATION_YEAR_OPTIONS = Array.from({ length: 8 }, (_, index) => CURRENT_CLASS_YEAR + index);

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface StudentResearchInterests {
  researchInterests: string[];
  graduationYear: number | null;
}

const arraysEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const ResearchInterestsEditor = () => {
  const { researchAreas } = useConfig();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [interests, setInterests] = useState<string[]>([]);
  const [graduationYear, setGraduationYear] = useState<number | null>(null);
  const [savedState, setSavedState] = useState<StudentResearchInterests>({
    researchInterests: [],
    graduationYear: null,
  });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    axios
      .get<StudentResearchInterests>('/users/researchInterests')
      .then((response) => {
        if (!active) return;
        const loaded = {
          researchInterests: Array.isArray(response.data?.researchInterests)
            ? response.data.researchInterests
            : [],
          graduationYear:
            typeof response.data?.graduationYear === 'number'
              ? response.data.graduationYear
              : null,
        };
        setInterests(loaded.researchInterests);
        setGraduationYear(loaded.graduationYear);
        setSavedState(loaded);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const governedAreaNames = useMemo(
    () =>
      Array.from(new Set(researchAreas.map((area) => area.name.trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [researchAreas],
  );

  const availableOptions = useMemo(() => {
    const selected = new Set(interests.map((value) => value.toLowerCase()));
    return governedAreaNames
      .filter((name) => !selected.has(name.toLowerCase()))
      .map((name) => ({ value: name }));
  }, [governedAreaNames, interests]);

  const addInterest = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setSaveStatus('idle');
      setInterests((current) => {
        if (current.length >= MAX_INTERESTS) return current;
        if (current.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
          return current;
        }
        return [...current, trimmed];
      });
    },
    [],
  );

  const removeInterest = useCallback((value: string) => {
    setSaveStatus('idle');
    setInterests((current) => current.filter((existing) => existing !== value));
  }, []);

  const isDirty =
    !arraysEqual(interests, savedState.researchInterests) ||
    graduationYear !== savedState.graduationYear;

  const onSave = async () => {
    setSaveStatus('saving');
    try {
      const response = await axios.put<StudentResearchInterests>('/users/researchInterests', {
        data: { researchInterests: interests, graduationYear },
      });
      const saved = {
        researchInterests: Array.isArray(response.data?.researchInterests)
          ? response.data.researchInterests
          : [],
        graduationYear:
          typeof response.data?.graduationYear === 'number' ? response.data.graduationYear : null,
      };
      setInterests(saved.researchInterests);
      setGraduationYear(saved.graduationYear);
      setSavedState(saved);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  };

  if (loading) {
    return (
      <div className="yr-card rounded-md p-6">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <section className="yr-card rounded-md p-5 sm:p-6" aria-labelledby="research-interests-heading">
      <div className="mb-4">
        <h2 id="research-interests-heading" className="text-lg font-semibold text-slate-900">
          Research interests
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Pick the research areas you care about. We&apos;ll use them to reorder the{' '}
          <Link to="/research" className="font-medium text-[var(--yr-blue)] hover:underline">
            Recommended
          </Link>{' '}
          feed toward homes that fit you. You can change or clear this anytime.
        </p>
      </div>

      {loadError && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          We couldn&apos;t load your saved interests. You can still set them below.
        </div>
      )}

      <div className="mb-4">
        {interests.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Selected research interests">
            {interests.map((interest) => (
              <li key={interest}>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--yr-line-strong)] bg-[var(--yr-blue-soft)] py-1 pl-3 pr-1.5 text-sm text-slate-800">
                  {interest}
                  <button
                    type="button"
                    onClick={() => removeInterest(interest)}
                    aria-label={`Remove ${interest}`}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-slate-500 hover:bg-white hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            No interests yet. Add a few research areas to personalize your feed.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          {interests.length >= MAX_INTERESTS ? (
            <p className="text-sm text-slate-500">
              You&apos;ve added the maximum of {MAX_INTERESTS} interests. Remove one to add another.
            </p>
          ) : (
            <ResearchAreaTypeahead
              options={availableOptions}
              hasSelections={interests.length > 0}
              onSelect={addInterest}
            />
          )}
        </div>
        <label className="block min-w-0 text-sm font-medium text-slate-800">
          Expected graduation year (optional)
          <select
            value={graduationYear ?? ''}
            onChange={(event) => {
              setSaveStatus('idle');
              const value = event.target.value;
              setGraduationYear(value ? Number(value) : null);
            }}
            className="mt-1 min-h-11 w-full rounded-md border border-[var(--yr-line-strong)] bg-white px-3 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            <option value="">Prefer not to say</option>
            {GRADUATION_YEAR_OPTIONS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || saveStatus === 'saving'}
          className="min-h-11 rounded-md bg-[var(--yr-blue)] px-5 text-sm font-semibold text-white hover:bg-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:bg-slate-200 disabled:text-slate-500"
        >
          {saveStatus === 'saving' ? 'Saving...' : 'Save interests'}
        </button>
        {saveStatus === 'saved' && !isDirty && (
          <span role="status" className="text-sm text-emerald-700">
            Interests saved.
          </span>
        )}
        {saveStatus === 'error' && (
          <span role="alert" className="text-sm text-red-700">
            Could not save. Please try again.
          </span>
        )}
      </div>
    </section>
  );
};

export default ResearchInterestsEditor;
