import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ScrollToTop from '../ScrollToTop';

const BackButton = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      Back
    </button>
  );
};

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ScrollToTop', () => {
  it('restores the app scroll container on browser back navigation', () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/research']}>
          <ScrollToTop />
          <div data-scroll-container>
            <Routes>
              <Route path="/research" element={<ResearchLink />} />
              <Route path="/research/profile" element={<BackButton />} />
            </Routes>
          </div>
        </MemoryRouter>
      </StrictMode>,
    );

    const scrollContainer = document.querySelector<HTMLElement>('[data-scroll-container]');
    expect(scrollContainer).toBeTruthy();

    act(() => {
      scrollContainer!.scrollTop = 420;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));
    expect(scrollContainer!.scrollTop).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(scrollContainer!.scrollTop).toBe(420);
  });

  it('leaves focus alone on first load so the first Tab reaches the skip link', () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/research']}>
          <ScrollToTop />
          <a href="#main-content">Skip to main content</a>
          <div data-scroll-container>
            <main id="main-content" tabIndex={-1}>
              <Routes>
                <Route path="/research" element={<ResearchLink />} />
              </Routes>
            </main>
          </div>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus into the main region when a scroll key is pressed with nothing focused', () => {
    render(
      <MemoryRouter initialEntries={['/research']}>
        <ScrollToTop />
        <nav>
          <NavbarLink />
        </nav>
        <div data-scroll-container>
          <main id="main-content" tabIndex={-1}>
            <Routes>
              <Route path="/research" element={<ResearchLink />} />
            </Routes>
          </main>
        </div>
      </MemoryRouter>,
    );

    const main = document.getElementById('main-content');
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: 'PageDown' });
    expect(document.activeElement).toBe(main);

    const navbarLink = screen.getByRole('button', { name: 'About' });
    navbarLink.focus();
    fireEvent.keyDown(navbarLink, { key: ' ' });
    expect(document.activeElement).toBe(navbarLink);
  });

  it('leaves scroll keys to the browser once a click has set the scroll origin', () => {
    render(
      <MemoryRouter initialEntries={['/research']}>
        <ScrollToTop />
        <div data-scroll-container>
          <main id="main-content" tabIndex={-1}>
            <div data-testid="inner-panel" style={{ overflowY: 'auto' }}>
              <p>Panel text</p>
            </div>
          </main>
        </div>
      </MemoryRouter>,
    );

    fireEvent.pointerDown(screen.getByText('Panel text'));
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: 'PageDown' });
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus into the main region on every route change', () => {
    render(
      <MemoryRouter initialEntries={['/research']}>
        <ScrollToTop />
        <nav>
          <NavbarLink />
        </nav>
        <div data-scroll-container>
          <main id="main-content" tabIndex={-1}>
            <Routes>
              <Route path="/research" element={<ResearchLink />} />
              <Route path="/research/profile" element={<BackButton />} />
              <Route path="/about" element={<h1>About y/labs</h1>} />
            </Routes>
          </main>
        </div>
      </MemoryRouter>,
    );

    const main = document.getElementById('main-content');

    const navbarLink = screen.getByRole('button', { name: 'About' });
    navbarLink.focus();
    fireEvent.click(navbarLink);
    expect(screen.getByRole('heading', { name: 'About y/labs' })).toBeTruthy();
    expect(document.activeElement).toBe(main);
  });

  it('moves focus into the main region when the activated link unmounts', () => {
    render(
      <MemoryRouter initialEntries={['/research']}>
        <ScrollToTop />
        <div data-scroll-container>
          <main id="main-content" tabIndex={-1}>
            <Routes>
              <Route path="/research" element={<ResearchLink />} />
              <Route path="/research/profile" element={<BackButton />} />
            </Routes>
          </main>
        </div>
      </MemoryRouter>,
    );

    const openProfile = screen.getByRole('button', { name: 'Open profile' });
    openProfile.focus();
    fireEvent.click(openProfile);
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(document.activeElement).toBe(document.getElementById('main-content'));
  });
});

const NavbarLink = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate('/about')}>
      About
    </button>
  );
};

const ResearchLink = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate('/research/profile')}>
      Open profile
    </button>
  );
};
