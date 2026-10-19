import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import HttpStatusNotifier from '../HttpStatusNotifier';
import { announcePageLoginPrompt, dispatchAuthRequired } from '../../utils/httpStatusEvents';

afterEach(() => {
  cleanup();
});

const renderNotifier = () =>
  render(
    <MemoryRouter initialEntries={['/research/example-lab?ref=share']}>
      <HttpStatusNotifier />
    </MemoryRouter>,
  );

describe('HttpStatusNotifier', () => {
  it('gives an expired session a working way back to login', () => {
    renderNotifier();
    act(() => dispatchAuthRequired());

    expect(screen.getByText('Your session needs a fresh login.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Log in again' }).getAttribute('href')).toBe('/login');
  });

  it('stays out of the way while the page shows its own login prompt', () => {
    renderNotifier();
    act(() => announcePageLoginPrompt(true));
    act(() => dispatchAuthRequired());
    expect(screen.queryByText('Your session needs a fresh login.')).toBeNull();

    act(() => announcePageLoginPrompt(false));
    act(() => dispatchAuthRequired());
    expect(screen.getByText('Your session needs a fresh login.')).toBeTruthy();
  });

  it('clears an auth notice that arrived just before the page took over the prompt', () => {
    renderNotifier();
    act(() => dispatchAuthRequired());
    act(() => announcePageLoginPrompt(true));
    expect(screen.queryByText('Your session needs a fresh login.')).toBeNull();
  });
});
