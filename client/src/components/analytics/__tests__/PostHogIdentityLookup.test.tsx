import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PostHogIdentityLookup from '../PostHogIdentityLookup';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn() },
}));

const mockedGet = (axios as unknown as { get: ReturnType<typeof vi.fn> }).get;

const SYNTHETIC_POSTHOG_ID = '3f2b6c1e-8d4a-4f0b-9c7e-2a1d5e6f7a8b';

const submit = (value: string) => {
  fireEvent.change(screen.getByLabelText('PostHog distinct ID'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Look Up' }));
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PostHogIdentityLookup', () => {
  it('resolves a pasted PostHog ID to its NetID through the admin endpoint', async () => {
    mockedGet.mockResolvedValue({
      data: { productAnalyticsId: SYNTHETIC_POSTHOG_ID, netid: 'test456' },
    });
    render(<PostHogIdentityLookup />);

    submit(`  ${SYNTHETIC_POSTHOG_ID}  `);

    expect(await screen.findByText('test456')).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith(
      `/analytics/product-analytics-ids/${SYNTHETIC_POSTHOG_ID}`,
    );
  });

  it('refuses a value that is not a PostHog ID without calling the server', async () => {
    render(<PostHogIdentityLookup />);

    submit('test456');

    expect(await screen.findByText('Paste the full PostHog distinct ID.')).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('shows the server answer when no account holds the ID', async () => {
    mockedGet.mockRejectedValue({
      response: { status: 404, data: { error: 'No account holds this PostHog ID' } },
    });
    render(<PostHogIdentityLookup />);

    submit(SYNTHETIC_POSTHOG_ID);

    expect(await screen.findByText('No account holds this PostHog ID')).toBeInTheDocument();
  });
});
