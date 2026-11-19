import { act, cleanup, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../utils/axios';
import UserContext from '../../contexts/UserContext';
import UserContextProvider from '../UserContextProvider';
import { dispatchAuthRequired } from '../../utils/httpStatusEvents';
import { wasSignedInLastVisit } from '../../utils/lastKnownSession';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockedGet = (axios as unknown as { get: ReturnType<typeof vi.fn> }).get;

const SessionState = () => {
  const { isLoading, isAuthenticated } = useContext(UserContext);
  return <p>{isLoading ? 'checking' : isAuthenticated ? 'signed in' : 'signed out'}</p>;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('UserContextProvider when a request reports an expired session', () => {
  it('treats the visitor as signed out so the login page offers sign-in', async () => {
    mockedGet.mockResolvedValue({
      data: { auth: true, user: { netId: 'zz001', userType: 'undergraduate' } },
    });

    render(
      <UserContextProvider>
        <SessionState />
      </UserContextProvider>,
    );
    expect(await screen.findByText('signed in')).toBeTruthy();
    expect(wasSignedInLastVisit()).toBe(true);

    act(() => {
      dispatchAuthRequired();
    });

    expect(screen.getByText('signed out')).toBeTruthy();
    expect(wasSignedInLastVisit()).toBe(false);
  });
});
