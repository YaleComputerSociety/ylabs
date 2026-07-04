import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ErrorBoundary from '../ErrorBoundary';
import { captureClientError } from '../../utils/errorTracking';

vi.mock('../../utils/errorTracking', () => ({
  captureClientError: vi.fn(),
}));

const BrokenComponent = () => {
  throw new Error('render failed');
};

describe('ErrorBoundary', () => {
  it('renders recovery UI and captures render errors', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh page/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go home/i })).toBeInTheDocument();
    expect(captureClientError).toHaveBeenCalledWith(expect.any(Error), expect.any(String));

    consoleError.mockRestore();
  });

  it('reloads the page from the recovery action', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: /refresh page/i }));

    expect(reload).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
