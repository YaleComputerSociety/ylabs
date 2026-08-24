import { useEffect, useRef, useState } from 'react';
import { isCancel } from 'axios';
import { Link } from 'react-router-dom';
import axios from '../../utils/axios';
import { ResearcherSearchHit, ResearcherSearchResponse } from '../../types/researcherSearch';
import { researcherPersonPagePath } from '../../utils/researcherPersonPage';

const homeCountLabel = (homeCount: number): string => {
  if (homeCount <= 0) return 'Findable researcher';
  return homeCount === 1 ? 'Leads 1 research home' : `Leads ${homeCount} research homes`;
};

const affiliationLine = (hit: ResearcherSearchHit): string =>
  [hit.title, hit.primaryDepartment, hit.school]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join(' · ');

const PersonResultCard = ({ hit }: { hit: ResearcherSearchHit }) => {
  const href = researcherPersonPagePath(hit.publicKey);
  const affiliation = affiliationLine(hit);
  const body = (
    <>
      <p className="text-base font-semibold leading-tight text-slate-950">{hit.displayName}</p>
      {affiliation && <p className="mt-1 text-sm text-slate-600">{affiliation}</p>}
      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {homeCountLabel(hit.homeCount)}
      </p>
    </>
  );

  if (!href) {
    return <div className="yr-card rounded-md p-4">{body}</div>;
  }

  return (
    <Link
      to={href}
      className="yr-card yr-focus-ring block rounded-md p-4 transition-colors hover:border-blue-300 hover:bg-[var(--yr-blue-soft)]"
    >
      {body}
    </Link>
  );
};

const PeopleResults = ({ query }: { query: string }) => {
  const [hits, setHits] = useState<ResearcherSearchHit[]>([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      return;
    }

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    axios
      .post<ResearcherSearchResponse>(
        '/research/people/search',
        { q: trimmed, pageSize: 6 },
        { signal: controller.signal },
      )
      .then((res) => {
        if (requestId !== requestIdRef.current) return;
        setHits(Array.isArray(res.data?.hits) ? res.data.hits : []);
      })
      .catch((err) => {
        if (isCancel(err) || requestId !== requestIdRef.current) return;
        setHits([]);
      });

    return () => controller.abort();
  }, [query]);

  if (hits.length === 0) return null;

  return (
    <section aria-label="Researchers" className="mt-5">
      <div className="mb-3 flex w-full items-center justify-between gap-3">
        <h2 className="yr-kicker min-w-0 flex-1">Researchers</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {hits.map((hit) => (
          <PersonResultCard key={hit.id} hit={hit} />
        ))}
      </div>
    </section>
  );
};

export default PeopleResults;
