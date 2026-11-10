import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import DirectoryRemovalRequestSentence from '../DirectoryRemovalRequestSentence';

afterEach(() => {
  cleanup();
});

const renderSentence = (email?: string) =>
  render(
    <MemoryRouter>
      <DirectoryRemovalRequestSentence email={email} />
    </MemoryRouter>,
  );

describe('DirectoryRemovalRequestSentence', () => {
  it('renders the approved sentence with the email clause when an address is set', () => {
    const { container } = renderSentence('removals@example.edu');

    expect(container.textContent).toBe(
      'If y/labs lists you and you would like to be removed, sign in and use Remove me on your dashboard, or email removals@example.edu from the address Yale publishes for you.',
    );
    expect(screen.getByRole('link', { name: 'removals@example.edu' }).getAttribute('href')).toBe(
      'mailto:removals@example.edu',
    );
    expect(screen.getByRole('link', { name: 'your dashboard' }).getAttribute('href')).toBe(
      '/dashboard',
    );
  });

  it('drops the email clause when no address is set', () => {
    const { container } = renderSentence(undefined);

    expect(container.textContent).toBe(
      'If y/labs lists you and you would like to be removed, sign in and use Remove me on your dashboard.',
    );
    expect(screen.queryByRole('link', { name: /@/ })).toBeNull();
  });
});
