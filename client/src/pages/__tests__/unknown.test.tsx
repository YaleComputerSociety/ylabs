import { cleanup, render, screen } from '@testing-library/react';
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
    expect(screen.queryByText(/y\/labs/i)).toBeNull();
  });

  it('gives the role selector an accessible student-facing label', () => {
    render(<Unknown />);

    expect(screen.getByLabelText('Role at Yale')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open role options' })).toBeTruthy();
    expect(screen.queryByLabelText('User Type')).toBeNull();
  });
});
