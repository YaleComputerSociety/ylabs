import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import DirectoryRemovalRequestSentence from '../DirectoryRemovalRequestSentence';
import { PRIVACY_CONTACT_EMAIL, PRIVACY_CONTACT_MAILTO } from '../../../utils/privacyContact';

afterEach(() => {
  cleanup();
});

describe('DirectoryRemovalRequestSentence', () => {
  it('renders the approved sentence with the privacy mailbox as a mailto link', () => {
    const { container } = render(
      <MemoryRouter>
        <DirectoryRemovalRequestSentence />
      </MemoryRouter>,
    );

    expect(container.textContent).toBe(
      'If y/labs lists you and you would like to be removed, sign in and use Remove me on your dashboard, or email ycs.maintenance.ylabs@gmail.com from the address Yale publishes for you.',
    );
    expect(screen.getByRole('link', { name: PRIVACY_CONTACT_EMAIL }).getAttribute('href')).toBe(
      PRIVACY_CONTACT_MAILTO,
    );
    expect(screen.getByRole('link', { name: 'your dashboard' }).getAttribute('href')).toBe(
      '/dashboard',
    );
  });
});
