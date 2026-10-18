import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FirstSaveCallout from '../FirstSaveCallout';

const renderCallout = (props: Parameters<typeof FirstSaveCallout>[0]) =>
  render(
    <MemoryRouter>
      <FirstSaveCallout {...props} />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe('FirstSaveCallout', () => {
  it('frames the research plan next step as reaching out via the official profile, not emailing the PI', () => {
    renderCallout({ kind: 'researchPlan', onDismiss: vi.fn() });

    const body = screen.getByText(/official profile and reach out/i);
    expect(body.textContent).toContain('keep private notes');
    expect(screen.queryByText(/email/i)).toBeNull();
  });

  it('keeps the program next step free of any email promise', () => {
    renderCallout({ kind: 'program', onDismiss: vi.fn() });

    expect(screen.queryByText(/email/i)).toBeNull();
  });

  it('names the program next step with the watch vocabulary and links to Watched programs', () => {
    renderCallout({ kind: 'program', onDismiss: vi.fn() });

    expect(screen.getByText('Watching this program')).toBeTruthy();
    expect(screen.queryByText(/saved/i)).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Open Watched programs' }).getAttribute('href'),
    ).toBe('/dashboard?tab=programs');
  });

  it('keeps the research plan callout linking to the Dashboard', () => {
    renderCallout({ kind: 'researchPlan', onDismiss: vi.fn() });

    expect(screen.getByText('Research plan saved')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Dashboard' }).getAttribute('href')).toBe(
      '/dashboard',
    );
  });
});
