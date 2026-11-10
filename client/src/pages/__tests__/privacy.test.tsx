import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Privacy from '../privacy';
import { PRIVACY_QUESTIONS_URL } from '../../utils/privacyNotice';
import { expectNoAxeViolations } from '../../testUtils/axe';

afterEach(() => {
  cleanup();
});

const renderPrivacy = () =>
  render(
    <MemoryRouter initialEntries={['/privacy']}>
      <Privacy />
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

  it('points questions at the public issue tracker', () => {
    renderPrivacy();

    const link = screen.getByRole('link', { name: 'y/labs GitHub repository' });
    expect(link.getAttribute('href')).toBe(PRIVACY_QUESTIONS_URL);
  });

  it('has no serious or critical accessibility violations', async () => {
    const { container } = renderPrivacy();
    await expectNoAxeViolations(container);
  });
});
