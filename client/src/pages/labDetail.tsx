/**
 * Lab detail page rendered at `/labs/:slug`.
 *
 * Smart-component responsibilities:
 *   - Resolve the slug from the URL and fetch the detail payload from
 *     `GET /api/research-groups/:slug` via the labDetailReducer.
 *   - Compose the small presentational components in `components/labs/`.
 *   - Own the "Inquire" modal toggle (delegated to the reducer so the
 *     transitions are pure and testable).
 *
 * No business logic lives in the layout components themselves — they take
 * props and render. This keeps the page consistent with the
 * `pages/profile.tsx` pattern.
 */
import { useEffect, useReducer } from 'react';
import { useParams } from 'react-router-dom';
import axios from '../utils/axios';
import {
  createInitialLabDetailState,
  labDetailReducer,
} from '../reducers/labDetailReducer';
import { LabDetailPayload } from '../types/labDetail';
import LabHeader from '../components/labs/LabHeader';
import LabMembersList from '../components/labs/LabMembersList';
import LabPapersList from '../components/labs/LabPapersList';
import LabActiveListings from '../components/labs/LabActiveListings';
import LabInquireCard from '../components/labs/LabInquireCard';
import LabInquireModal from '../components/labs/LabInquireModal';

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
    {children}
  </h2>
);

const LabDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const [state, dispatch] = useReducer(
    labDetailReducer,
    undefined,
    () => createInitialLabDetailState(),
  );
  const { payload, loading, error, isInquireModalOpen } = state;

  useEffect(() => {
    if (!slug) return;
    dispatch({ type: 'FETCH_START' });
    axios
      .get(`/research-groups/${slug}`)
      .then((res) => {
        dispatch({ type: 'FETCH_SUCCESS', payload: res.data as LabDetailPayload });
      })
      .catch((err) => {
        if (err?.response?.status === 404) {
          dispatch({ type: 'FETCH_FAILURE', payload: 'Lab not found.' });
        } else {
          dispatch({ type: 'FETCH_FAILURE', payload: 'Failed to load this lab.' });
        }
      });
  }, [slug]);

  if (loading && !payload) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 flex justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 text-center">
        <h2 className="text-xl font-semibold text-gray-800">{error}</h2>
        <p className="text-gray-500 mt-2">
          The lab you're looking for may not exist or may have been removed.
        </p>
      </div>
    );
  }

  if (!payload) return null;

  const { group, members, recentPapers, activeListings } = payload;
  const hasActiveListing = (activeListings?.length ?? 0) > 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-10">
          <LabHeader group={group} hasActiveListing={hasActiveListing} />

          <section>
            <SectionHeading>People</SectionHeading>
            <LabMembersList members={members} />
          </section>

          <section>
            <SectionHeading>Recent Papers</SectionHeading>
            <LabPapersList papers={recentPapers} />
          </section>

          <section>
            <SectionHeading>Active Listings</SectionHeading>
            <LabActiveListings listings={activeListings} />
          </section>
        </div>

        <aside className="lg:col-span-1">
          <div className="lg:sticky lg:top-8">
            <LabInquireCard
              group={group}
              members={members}
              hasActiveListing={hasActiveListing}
              onInquire={() => dispatch({ type: 'OPEN_INQUIRE_MODAL' })}
            />
          </div>
        </aside>
      </div>

      <LabInquireModal
        isOpen={isInquireModalOpen}
        onClose={() => dispatch({ type: 'CLOSE_INQUIRE_MODAL' })}
        group={group}
        members={members}
      />
    </div>
  );
};

export default LabDetail;
