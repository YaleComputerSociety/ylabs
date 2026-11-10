import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ConfigContext, { defaultConfigContext } from '../../../contexts/ConfigContext';
import UserContext from '../../../contexts/UserContext';
import Dashboard from '../../../pages/dashboard';

const mocks = vi.hoisted(() => ({
  deleteAccountData: vi.fn(),
  downloadAccountData: vi.fn(),
  leaveAfterAccountDeletion: vi.fn(),
}));

vi.mock('../../../utils/accountData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/accountData')>();
  return {
    ...actual,
    deleteAccountData: mocks.deleteAccountData,
    downloadAccountData: mocks.downloadAccountData,
    leaveAfterAccountDeletion: mocks.leaveAfterAccountDeletion,
  };
});

vi.mock('../../accounts/SavedResearchPlans', () => ({ default: () => <section /> }));
vi.mock('../../accounts/ProgramWatch', () => ({ default: () => <section /> }));

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
};

const renderDashboard = (enabled: boolean, initialEntry = '/dashboard') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: true,
          user: { netId: 'user1', userType: 'undergraduate', userConfirmed: true } as any,
          checkContext: vi.fn(),
        }}
      >
        <ConfigContext.Provider
          value={{ ...defaultConfigContext, features: { accountDataControls: enabled } }}
        >
          <Dashboard />
          <LocationProbe />
        </ConfigContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

const openDeleteDialog = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Delete my data' }));
  return screen.getByRole('dialog', { name: 'Delete your y/labs data' });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Your data controls on the dashboard (#4156)', () => {
  it('shows no data controls while the release flag is off', () => {
    renderDashboard(false);

    expect(screen.queryByRole('heading', { name: 'Your data' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download my data' })).toBeNull();
  });

  it('downloads the export from the section', async () => {
    mocks.downloadAccountData.mockResolvedValue(undefined);
    renderDashboard(true);

    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));

    await waitFor(() => expect(mocks.downloadAccountData).toHaveBeenCalledTimes(1));
  });

  it('says so when the download fails', async () => {
    mocks.downloadAccountData.mockRejectedValue(new Error('network'));
    renderDashboard(true);

    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));

    expect(await screen.findByText('The download did not start. Please try again.')).toBeTruthy();
  });

  it('offers the export first and keeps delete off until the phrase is typed', () => {
    renderDashboard(true);
    const dialog = within(openDeleteDialog());

    expect(dialog.getByText(/cannot be undone/)).toBeTruthy();
    expect(dialog.getByText(/Signing in again later starts a new, empty account\./)).toBeTruthy();
    expect(
      dialog.getByText(/a\s+maintainer deletes that account too, in a separate run/),
    ).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Download my data' })).toBeTruthy();
    const confirm = dialog.getByRole('button', { name: 'Delete my data' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(dialog.getByLabelText(/to confirm/), { target: { value: 'delete' } });
    expect(confirm.disabled).toBe(true);

    fireEvent.change(dialog.getByLabelText(/to confirm/), {
      target: { value: 'Delete my data ' },
    });
    expect(confirm.disabled).toBe(false);
  });

  const confirmDeletion = () => {
    const dialog = within(openDeleteDialog());
    fireEvent.change(dialog.getByLabelText(/to confirm/), {
      target: { value: 'delete my data' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Delete my data' }));
  };

  it('leaves the signed-in app once the deletion succeeds', async () => {
    mocks.deleteAccountData.mockResolvedValue('deleted');
    renderDashboard(true);

    confirmDeletion();

    await waitFor(() => expect(mocks.leaveAfterAccountDeletion).toHaveBeenCalledTimes(1));
  });

  it('sends the student through CAS again when the sign-in is not recent', async () => {
    mocks.deleteAccountData.mockResolvedValue('recent_sign_in_required');
    renderDashboard(true);

    confirmDeletion();

    const link = await screen.findByRole('link', { name: 'Sign in again' });
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost');
    expect(href.pathname).toMatch(/\/api\/cas$/);
    expect(href.searchParams.get('redirect')).toBe('/dashboard?data=delete');
    expect(href.searchParams.get('reauth')).toBe('1');
    expect(mocks.leaveAfterAccountDeletion).not.toHaveBeenCalled();
  });

  it('explains a deletion that did not finish', async () => {
    mocks.deleteAccountData.mockResolvedValue('failed');
    renderDashboard(true);

    confirmDeletion();

    expect(await screen.findByText(/Deletion did not finish/)).toBeTruthy();
  });

  it('reopens the delete dialog after the fresh sign-in and drops the intent from the URL', async () => {
    renderDashboard(true, '/dashboard?data=delete');

    expect(screen.getByRole('dialog', { name: 'Delete your y/labs data' })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/dashboard'));
  });
});
