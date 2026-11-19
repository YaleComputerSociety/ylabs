import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ScrollToTop from '../../components/shared/ScrollToTop';
import GettingStarted from '../gettingStarted';
import { expectNoAxeViolations } from '../../testUtils/axe';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(resolve));

const renderGuide = (path = '/getting-started') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <GettingStarted />
    </MemoryRouter>,
  );

describe('GettingStarted', () => {
  it('answers the questions a newcomer asks before a first email', () => {
    renderGuide();

    expect(
      screen.getByRole('heading', { level: 1, name: 'How to get started in research' }),
    ).toBeTruthy();
    for (const question of [
      'Can first-years join?',
      'What is a PI?',
      'How to write the first email',
      'If you do not hear back',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: question })).toBeTruthy();
    }
    expect(document.title).toBe('How to get started in research | y/labs');
  });

  it('points to Yale College advice and the programs board rather than making claims of its own', () => {
    renderGuide();

    expect(
      screen.getByRole('link', { name: 'choosing a faculty mentor' }).getAttribute('href'),
    ).toMatch(/^https:\/\/science\.yalecollege\.yale\.edu\//);
    expect(
      screen.getByRole('link', { name: 'Programs and fellowships' }).getAttribute('href'),
    ).toBe('/programs');
  });

  it('leaves focus alone when the page loads on a section link', () => {
    renderGuide('/getting-started#what-is-a-pi');

    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus to the section an in-app link names', async () => {
    render(
      <MemoryRouter initialEntries={['/research/fixture']}>
        <Link to="/getting-started#what-is-a-pi">What a PI does</Link>
        <Routes>
          <Route path="/getting-started" element={<GettingStarted />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'What a PI does' }));

    const heading = await screen.findByRole('heading', { level: 2, name: 'What is a PI?' });
    expect(document.activeElement).toBe(heading);
  });

  it('keeps the linked section in view after the route change scrolls the page', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const SECTION_SCROLL_TOP = 900;
    const scrollContainer = () => document.querySelector<HTMLElement>('[data-scroll-container]')!;
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn(() => {
      scrollContainer().scrollTop = SECTION_SCROLL_TOP;
    });
    render(
      <MemoryRouter initialEntries={['/research/fixture']}>
        <ScrollToTop />
        <div data-scroll-container>
          <Link to="/getting-started#what-is-a-pi">What a PI does</Link>
          <Routes>
            <Route path="/getting-started" element={<GettingStarted />} />
            <Route path="*" element={null} />
          </Routes>
        </div>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'What a PI does' }));
    await screen.findByRole('heading', { level: 2, name: 'What is a PI?' });
    await nextFrame();
    await nextFrame();

    Element.prototype.scrollIntoView = originalScrollIntoView;
    expect(scrollContainer().scrollTop).toBe(SECTION_SCROLL_TOP);
  });

  it('ignores a malformed section link', () => {
    renderGuide('/getting-started#%E0');

    expect(
      screen.getByRole('heading', { level: 1, name: 'How to get started in research' }),
    ).toBeTruthy();
  });

  it('has no serious accessibility violations', async () => {
    const { container } = renderGuide();
    await expectNoAxeViolations(container);
  });
});
