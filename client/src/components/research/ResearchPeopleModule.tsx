import { useEffect, useState } from 'react';
import { isCancel } from 'axios';
import { Link } from 'react-router-dom';

import axios from '../../utils/axios';
import type { ResearcherSearchResponse, ResearcherSummary } from '../../types/researcherProfile';

interface ResearchPeopleModuleProps {
  query: string;
}

const fetchResearchers = async (
  query: string,
  signal: AbortSignal,
): Promise<ResearcherSummary[]> => {
  const response = await axios.post<ResearcherSearchResponse>(
    '/research/researchers/search',
    { q: query },
    { signal },
  );
  return Array.isArray(response.data?.researchers) ? response.data.researchers : [];
};

const affiliationLine = (person: ResearcherSummary): string =>
  [person.primaryDepartment, person.school]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join(' · ');

const homeCountLabel = (homeCount: number): string => {
  if (homeCount <= 0) return 'Research profile';
  return `${homeCount} research ${homeCount === 1 ? 'home' : 'homes'} at Yale`;
};

const ResearchPeopleModule = ({ query }: ResearchPeopleModuleProps) => {
  const trimmedQuery = query.trim();
  const [people, setPeople] = useState<ResearcherSummary[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!trimmedQuery) {
      setPeople([]);
      setFailed(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setFailed(false);

    void (async () => {
      try {
        const results = await fetchResearchers(trimmedQuery, controller.signal);
        if (!active || controller.signal.aborted) return;
        setPeople(results);
      } catch (error) {
        if (!active || controller.signal.aborted || isCancel(error)) return;
        setPeople([]);
        setFailed(true);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [trimmedQuery]);

  if (!trimmedQuery || failed || people.length === 0) {
    return null;
  }

  return (
    <section aria-label="Researchers matching your search" className="mt-5">
      <div className="mb-3">
        <h2 className="yr-kicker">People</h2>
        <p className="mt-1 text-sm text-slate-600">
          Researchers matching your search. Each page unifies every research home they lead or
          co-lead.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[repeat(3,minmax(0,1fr))]">
        {people.map((person) => (
          <Link
            key={person.id}
            to={`/researcher/${person.id}`}
            className="yr-card yr-focus-ring flex flex-col rounded-md p-4 transition-colors hover:border-blue-300"
          >
            <p className="yr-kicker text-[0.62rem]">Researcher</p>
            <span className="mt-1 text-base font-semibold leading-snug text-gray-950">
              {person.displayName}
            </span>
            {person.title && (
              <span className="mt-1 text-sm font-medium text-gray-700">{person.title}</span>
            )}
            {affiliationLine(person) && (
              <span className="mt-0.5 text-sm text-gray-500">{affiliationLine(person)}</span>
            )}
            <span className="mt-3 text-xs font-medium text-[var(--yr-blue)]">
              {homeCountLabel(person.homeCount)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
};

export default ResearchPeopleModule;
