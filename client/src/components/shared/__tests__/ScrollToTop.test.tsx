import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ScrollToTop from '../ScrollToTop';

const BackButton = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
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
});

const ResearchLink = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/research/profile')}>
      Open profile
    </button>
  );
};
