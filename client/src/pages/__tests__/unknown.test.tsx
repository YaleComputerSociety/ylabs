import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('../../utils/axios', () => ({ default: { put: mocks.put } }));

import Unknown from '../unknown';

afterEach(() => {
  cleanup();
  mocks.put.mockReset();
});

const fillValidForm = async () => {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('First name'), 'Ada');
  await user.type(screen.getByLabelText('Last name'), 'Lovelace');
  await user.type(screen.getByLabelText('Email'), 'ada@yale.edu');
  await user.selectOptions(screen.getByLabelText('Role at Yale'), 'undergraduate');
  return user;
};

describe('Unknown onboarding', () => {
  it('uses a native labelled role control and current Yale Research language', () => {
    render(<Unknown />);

    expect(screen.getByRole('heading', { name: 'Tell us how you use Yale Research' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Role at Yale' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeTruthy();
    expect(screen.queryByText(/y\/labs/i)).toBeNull();
  });

  it('associates announced validation errors and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    render(<Unknown />);

    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    const summary = screen.getByRole('alert');
    expect(summary.textContent).toContain('First name is required');
    const firstName = screen.getByLabelText('First name');
    expect(firstName.getAttribute('aria-invalid')).toBe('true');
    expect(firstName.getAttribute('aria-describedby')).toBe('firstName-error');
    await waitFor(() => expect(document.activeElement).toBe(firstName));
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('shows loading and completion only after the persisted user is confirmed', async () => {
    let resolveRequest!: (value: unknown) => void;
    mocks.put.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    render(<Unknown />);
    const user = await fillValidForm();

    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(screen.getByRole('button', { name: 'Saving account setup...' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Your account setup is complete' })).toBeNull();

    resolveRequest({ data: { user: { fname: 'Ada', lname: 'Lovelace', userType: 'undergraduate', userConfirmed: false } } });
    expect(await screen.findByRole('heading', { name: 'Your account setup is complete' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Continue to Yale Research' }).getAttribute('href')).toBe('/');
  });

  it('does not claim completion when persistence fails or returns mismatched data', async () => {
    mocks.put.mockResolvedValue({ data: { user: { fname: 'Different', lname: 'User', userType: 'graduate' } } });
    render(<Unknown />);
    const user = await fillValidForm();
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
    expect(screen.queryByRole('heading', { name: 'Your account setup is complete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeEnabled();
  });
});
