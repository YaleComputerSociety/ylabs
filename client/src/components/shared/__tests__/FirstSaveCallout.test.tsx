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
});
