import { FormEvent, useState } from 'react';

import axios from '../../utils/axios';
import { clientErrorMessage } from '../../utils/clientErrorMessage';

type EndSessionsState =
  | { status: 'idle' }
  | { status: 'confirming'; netid: string }
  | { status: 'ending'; netid: string }
  | { status: 'ended'; netid: string }
  | { status: 'error'; message: string };

const NETID_SHAPE = /^[a-z0-9]{2,12}$/;

const EndAccountSessions = () => {
  const [netidInput, setNetidInput] = useState('');
  const [state, setState] = useState<EndSessionsState>({ status: 'idle' });

  const askToConfirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const netid = netidInput.trim().toLowerCase();
    if (!NETID_SHAPE.test(netid)) {
      setState({ status: 'error', message: 'Enter the NetID whose sessions should end.' });
      return;
    }
    setState({ status: 'confirming', netid });
  };

  const endSessions = async (netid: string) => {
    setState({ status: 'ending', netid });
    try {
      await axios.post(`/admin/accounts/${encodeURIComponent(netid)}/sessions/revoke`, {});
      setNetidInput('');
      setState({ status: 'ended', netid });
    } catch (error) {
      setState({
        status: 'error',
        message: clientErrorMessage(error, `Could not end the sessions for ${netid}.`),
      });
    }
  };

  const pendingNetid =
    state.status === 'confirming' || state.status === 'ending' ? state.netid : null;

  return (
    <section className="mb-10" aria-labelledby="end-account-sessions-title">
      <div className="mb-4 border-b border-line pb-2">
        <h2 id="end-account-sessions-title" className="yr-display text-2xl font-semibold text-ink">
          End Sessions
        </h2>
        <p className="text-sm text-muted">
          Sign one account out on every device, for example after a lost device or a suspected
          compromise. The person can sign in again through Yale CAS. This is recorded in the admin
          audit log.
        </p>
      </div>

      <form
        className="grid grid-cols-1 gap-3 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 md:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={askToConfirm}
      >
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-muted">NetID</span>
          <input
            className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-control)] px-3 py-2 font-mono text-sm focus:border-brand yr-focus-ring"
            value={netidInput}
            onChange={(event) => setNetidInput(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button
          className="inline-flex min-h-[44px] items-center justify-center self-end rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-brand-soft yr-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={pendingNetid !== null}
        >
          End Sessions
        </button>
      </form>

      <div aria-live="polite" className="mt-3">
        {pendingNetid && (
          <div className="flex flex-col gap-3 rounded-md border border-line-brand bg-brand-soft px-4 py-3 text-sm text-brand-navy md:flex-row md:items-center md:justify-between">
            <p>
              End every session for NetID{' '}
              <span className="font-mono font-semibold">{pendingNetid}</span>?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex min-h-[44px] items-center rounded-md bg-[var(--yr-blue)] px-4 py-2 font-semibold text-white hover:bg-brand-navy yr-focus-ring disabled:cursor-not-allowed disabled:bg-line-strong"
                onClick={() => void endSessions(pendingNetid)}
                disabled={state.status === 'ending'}
              >
                {state.status === 'ending' ? 'Ending…' : 'Confirm'}
              </button>
              <button
                type="button"
                className="inline-flex min-h-[44px] items-center rounded-md border border-line px-4 py-2 font-semibold text-ink hover:bg-white yr-focus-ring"
                onClick={() => setState({ status: 'idle' })}
                disabled={state.status === 'ending'}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {state.status === 'ended' && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Every session for NetID <span className="font-mono font-semibold">{state.netid}</span>{' '}
            has ended.
          </p>
        )}
        {state.status === 'error' && (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {state.message}
          </p>
        )}
      </div>
    </section>
  );
};

export default EndAccountSessions;
