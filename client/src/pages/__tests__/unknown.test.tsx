import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import Unknown from '../unknown';

afterEach(() => {
  cleanup();
});

describe('Unknown', () => {
  it('frames account setup with current Yale Research language', () => {
    render(<Unknown />);

    expect(screen.getByRole('heading', { name: 'Tell us how you use Yale Research' })).toBeTruthy();
    expect(
      screen.getByText(/you can start searching as soon as this is saved/i),
    ).toBeTruthy();
    expect(screen.getByText('What changes after this')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Student-facing pathways' })).toBeTruthy();
    expect(screen.queryByText(/y\/labs/i)).toBeNull();
  });

  it('gives the role selector an accessible student-facing label', () => {
    render(<Unknown />);

    expect(screen.getByLabelText('Role at Yale')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open role options' })).toBeTruthy();
    expect(screen.queryByLabelText('User Type')).toBeNull();
  });

  it('opens the role options without covering the submit action', async () => {
    const user = userEvent.setup();
    render(<Unknown />);

    await user.click(screen.getByRole('button', { name: 'Open role options' }));

    expect(screen.getByRole('listbox', { name: 'Role at Yale options' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Undergraduate Student' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue to Yale Research' })).toBeTruthy();
    expect(screen.queryByText(/Yale Labs/i)).toBeNull();
  });
});
