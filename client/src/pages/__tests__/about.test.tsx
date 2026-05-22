import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import About from '../about';

afterEach(() => {
  cleanup();
});

describe('About', () => {
  it('uses current Yale Research naming for project history and links', () => {
    render(<About />);

    expect(screen.getByText(/Yale Research is a/)).toBeTruthy();
    expect(screen.getByText(/product that gives students/)).toBeTruthy();
    expect(screen.queryByText(/collaboration between/i)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Yale Research alumni' })).toBeTruthy();
    expect(screen.getByText('Founder')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Yale Research GitHub' })).toBeTruthy();
    expect(screen.queryByText(/RDB/)).toBeNull();
  });

  it('labels organization logo links with full names', () => {
    render(<About />);

    expect(screen.getAllByRole('link', { name: 'Yale Computer Society website' }).length).toBe(1);
    expect(
      screen.getAllByRole('link', { name: 'Yale Undergraduate Research Association website' })
        .length,
    ).toBe(1);
    expect(screen.queryByRole('link', { name: 'y/cs Website' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'YURA Website' })).toBeNull();
  });

  it('keeps the feedback prompt current and below the main page heading', () => {
    render(<About />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Help improve Yale Research' }),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: /first release/i })).toBeNull();
  });
});
