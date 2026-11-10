import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import ConfigContext, { defaultConfigContext } from '../../contexts/ConfigContext';
import Privacy from '../privacy';
import { PRIVACY_CONTACT_EMAIL, PRIVACY_CONTACT_MAILTO } from '../../utils/privacyContact';
import { DIRECTORY_REMOVAL_REQUEST_EMAIL, PRIVACY_QUESTIONS_URL } from '../../utils/privacyNotice';
import { expectNoAxeViolations } from '../../testUtils/axe';

afterEach(() => {
  cleanup();
});

const renderPrivacy = (accountDataControls = false) =>
  render(
    <MemoryRouter initialEntries={['/privacy']}>
      <ConfigContext.Provider
        value={{ ...defaultConfigContext, features: { accountDataControls } }}
      >
        <Privacy />
      </ConfigContext.Provider>
    </MemoryRouter>,
  );

describe('Privacy', () => {
  it('names every service that receives data and how long activity is kept', () => {
    renderPrivacy();

    expect(screen.getByRole('heading', { level: 1, name: 'What y/labs collects' })).toBeTruthy();
    const text = document.body.textContent ?? '';
    for (const service of ['PostHog', 'OpenAI', 'Sentry', 'Google Fonts', 'Yale CAS', 'Yalies']) {
      expect(text).toContain(service);
    }
    expect(text).toContain('1,095 days');
    expect(text).toContain('30 days');
    expect(text).toContain('yalelabs.io');
  });

  it('keeps the public issue tracker for general questions only', () => {
    renderPrivacy();

    const link = screen.getByRole('link', { name: 'y/labs GitHub repository' });
    expect(link.getAttribute('href')).toBe(PRIVACY_QUESTIONS_URL);
    expect(link.closest('p')?.textContent).toContain('For general questions');
    expect(link.closest('p')?.textContent).toContain(PRIVACY_CONTACT_EMAIL);
  });

  it('sends a private data request to the maintainer address, answered within 30 days', () => {
    renderPrivacy();

    const link = screen.getByRole('link', { name: PRIVACY_CONTACT_EMAIL });
    expect(link.getAttribute('href')).toBe(PRIVACY_CONTACT_MAILTO);
    const paragraph = link.closest('p')?.textContent ?? '';
    expect(paragraph).toContain('If you cannot sign in');
    expect(paragraph).toContain('within 30 days');
    expect(paragraph).toContain('Do not send a request about your own data as a GitHub issue');
  });

  it('describes the dashboard deletion only while the release flag is on', () => {
    renderPrivacy(false);
    expect(document.body.textContent).not.toContain('under Your data');
    cleanup();

    renderPrivacy(true);
    const text = document.body.textContent ?? '';
    expect(text).toContain('under Your data');
    expect(text).toContain('enter your Yale password again');
    expect(text).toContain('a maintainer deletes that account too');
    expect(screen.getByRole('link', { name: PRIVACY_CONTACT_EMAIL })).toBeTruthy();
  });

  it('ships no removal address until one is named, and says what a removal request stores', () => {
    renderPrivacy();

    expect(DIRECTORY_REMOVAL_REQUEST_EMAIL).toBeUndefined();
    const text = document.body.textContent ?? '';
    expect(text).toContain(
      'If y/labs lists you and you would like to be removed, sign in and use Remove me on your dashboard.',
    );
    expect(text).not.toContain('from the address Yale publishes for you');
    expect(text).toContain(
      'the request stores only your netid, the listing it matched and the request status.',
    );
  });

  it('has no serious or critical accessibility violations', async () => {
    const { container } = renderPrivacy();
    await expectNoAxeViolations(container);
  });
});
