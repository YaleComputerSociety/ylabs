import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import LoginError from '../loginError';

const renderLoginError = () =>
  render(
    <MemoryRouter>
      <LoginError />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
});

describe('LoginError', () => {
  it('centres its actions in the card rather than against its left edge', () => {
    const { container } = renderLoginError();

    const actionRow = screen.getByRole('link', { name: /return to y\/labs/i })
      .parentElement as HTMLElement;
    expect(actionRow.className).toContain('mx-auto');
    expect(container.querySelector('.max-w-md')).toBe(actionRow);
  });

  it('gives the secondary action a control radius rather than a container one', () => {
    renderLoginError();

    const returnLink = screen.getByRole('link', { name: /return to y\/labs/i });
    expect(returnLink.className).toContain('rounded-control');
    expect(returnLink.className).not.toContain('rounded-card');
  });

  it('shows an immediate CAS recovery path', () => {
    renderLoginError();

    expect(screen.getByRole('heading', { name: /we couldn't complete sign in/i })).toBeTruthy();
    const retryLink = screen.getByRole('link', { name: /try yale cas again/i });
    expect(retryLink.getAttribute('href')).toContain('/api/cas');
    expect(screen.getByRole('link', { name: /return to y\/labs/i })).toBeTruthy();
  });
});
