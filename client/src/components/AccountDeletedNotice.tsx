import { useState } from 'react';

import { takeAccountDeletedNotice } from '../utils/accountData';

const deletedBeforeThisPageLoad = takeAccountDeletedNotice();

const AccountDeletedNotice = () => {
  const [shown, setShown] = useState(deletedBeforeThisPageLoad);

  if (!shown) return null;

  return (
    <div className="mx-auto mt-3 w-full max-w-5xl px-4">
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-line bg-success-soft px-4 py-2 text-sm text-ink"
      >
        <span>
          Your y/labs data was deleted and you are signed out. Signing in again starts a new, empty
          account.
        </span>
        <button
          type="button"
          className="inline-flex min-h-11 items-center font-semibold underline yr-focus-ring"
          onClick={() => setShown(false)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};

export default AccountDeletedNotice;
