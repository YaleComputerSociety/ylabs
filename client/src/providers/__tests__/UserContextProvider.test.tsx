import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import UserContext from '../../contexts/UserContext';
import UserContextProvider from '../UserContextProvider';
import axios from '../../utils/axios';
import { AUTH_FAILURE_EVENT } from '../../utils/httpStatusEvents';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedAxiosGet = vi.mocked(axios.get);

const Probe = () => (
  <UserContext.Consumer>
    {({ isAuthenticated, user }) => (
      <div>
        <span>{isAuthenticated ? 'authenticated' : 'logged out'}</span>
        <span>{user?.netId}</span>
      </div>
    )}
  </UserContext.Consumer>
);

describe('UserContextProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxiosGet.mockResolvedValue({
      data: {
        auth: true,
        user: { netId: 'abc123', userType: 'student' },
      },
    });
  });

  it('clears auth state when the shared API client reports a 401', async () => {
    render(
      <UserContextProvider>
        <Probe />
      </UserContextProvider>,
    );

    expect(await screen.findByText('authenticated')).toBeTruthy();
    expect(screen.getByText('abc123')).toBeTruthy();

    window.dispatchEvent(new CustomEvent(AUTH_FAILURE_EVENT, { detail: { status: 401 } }));

    await waitFor(() => expect(screen.getByText('logged out')).toBeTruthy());
    expect(screen.queryByText('abc123')).toBeNull();
  });
});
