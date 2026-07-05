import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HttpStatusNotifier from '../HttpStatusNotifier';
import { RATE_LIMIT_EVENT, RateLimitDetail } from '../../utils/httpStatusEvents';

describe('HttpStatusNotifier', () => {
  it('shows rate-limit retry guidance from global events', async () => {
    render(<HttpStatusNotifier />);

    const detail: RateLimitDetail = {
      status: 429,
      message: 'Too many discovery requests, please try again later.',
      retryAfterSeconds: 120,
      path: '/research',
    };

    window.dispatchEvent(new CustomEvent(RATE_LIMIT_EVENT, { detail }));

    expect(await screen.findByText(/too many discovery requests/i)).toBeTruthy();
    expect(screen.getByText(/try again in about 2 minutes/i)).toBeTruthy();
  });
});
