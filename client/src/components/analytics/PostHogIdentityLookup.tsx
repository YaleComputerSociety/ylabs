import { FormEvent, useState } from 'react';

import axios from '../../utils/axios';
import { clientErrorMessage } from '../../utils/clientErrorMessage';

type PostHogIdentityResponse = { productAnalyticsId: string; netid: string };

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; result: PostHogIdentityResponse }
  | { status: 'error'; message: string };

const POSTHOG_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PostHogIdentityLookup = () => {
  const [productAnalyticsId, setProductAnalyticsId] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });

  const resolveId = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = productAnalyticsId.trim();
    if (!POSTHOG_ID_SHAPE.test(candidate)) {
      setLookup({ status: 'error', message: 'Paste the full PostHog distinct ID.' });
      return;
    }
    setLookup({ status: 'loading' });
    try {
      const { data } = await axios.get<PostHogIdentityResponse>(
        `/analytics/product-analytics-ids/${encodeURIComponent(candidate)}`,
      );
      setLookup({ status: 'found', result: data });
    } catch (error) {
      setLookup({
        status: 'error',
        message: clientErrorMessage(error, 'Could not look up that PostHog ID.'),
      });
    }
  };

  return (
    <section className="mb-10" aria-labelledby="posthog-identity-lookup-title">
      <div className="mb-4 border-b border-line pb-2">
        <h2
          id="posthog-identity-lookup-title"
          className="yr-display text-2xl font-semibold text-ink"
        >
          PostHog ID Lookup
        </h2>
        <p className="text-sm text-muted">
          PostHog only ever receives an opaque per-account ID. Paste one here to see which NetID it
          belongs to, without the NetID leaving y/labs.
        </p>
      </div>

      <form
        className="grid grid-cols-1 gap-3 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 md:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(event) => void resolveId(event)}
      >
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-muted">
            PostHog distinct ID
          </span>
          <input
            className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-control)] px-3 py-2 font-mono text-sm focus:border-brand yr-focus-ring"
            value={productAnalyticsId}
            onChange={(event) => setProductAnalyticsId(event.target.value)}
            placeholder="00000000-0000-4000-8000-000000000000"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button
          className="inline-flex min-h-[44px] items-center justify-center self-end rounded-md bg-[var(--yr-blue)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring disabled:cursor-not-allowed disabled:bg-line-strong"
          type="submit"
          disabled={lookup.status === 'loading'}
        >
          {lookup.status === 'loading' ? 'Looking up…' : 'Look Up'}
        </button>
      </form>

      <div aria-live="polite" className="mt-3">
        {lookup.status === 'found' && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            This PostHog ID belongs to NetID{' '}
            <span className="font-mono font-semibold">{lookup.result.netid}</span>.
          </p>
        )}
        {lookup.status === 'error' && (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {lookup.message}
          </p>
        )}
      </div>
    </section>
  );
};

export default PostHogIdentityLookup;
