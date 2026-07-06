import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import LoginError from '../loginError';

const renderLoginError = () =>
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <LoginError />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
});

describe('LoginError', () => {
  it('shows an immediate CAS recovery path', () => {
    renderLoginError();

    expect(screen.getByRole('heading', { name: /we couldn't complete sign in/i })).toBeTruthy();
    const retryLink = screen.getByRole('link', { name: /try yale cas again/i });
    expect(retryLink.getAttribute('href')).toContain('/api/cas');
    expect(screen.getByRole('link', { name: /return to yale research/i })).toBeTruthy();
  });
});
