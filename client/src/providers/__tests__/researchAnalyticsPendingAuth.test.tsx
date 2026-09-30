import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

type MockedAxios = { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

const batchPosts = (post: ReturnType<typeof vi.fn>) =>
  post.mock.calls.filter(([url]) => url === '/analytics/research/batch') as Array<
    [string, { events: Array<Record<string, unknown>> }]
  >;

const renderWithPendingSessionCheck = async () => {
  vi.resetModules();
  const { default: axios } = await import('../../utils/axios');
  const analytics = await import('../../utils/researchAnalytics');
  const { default: UserContextProvider } = await import('../UserContextProvider');
  const mockedAxios = axios as unknown as MockedAxios;

  let answerSessionCheck: (auth: boolean) => void = () => {};
  mockedAxios.get.mockImplementation(
    () =>
      new Promise((resolveCheck) => {
        answerSessionCheck = (auth: boolean) =>
          resolveCheck({
            data: auth
              ? { auth: true, user: { netId: 'zz001', userType: 'undergraduate' } }
              : { auth: false },
          });
      }),
  );
  mockedAxios.post.mockResolvedValue({ status: 202 });

  render(
    <UserContextProvider>
      <div />
    </UserContextProvider>,
  );

  return {
    post: mockedAxios.post,
    trackFirstResultsView: () =>
      analytics.trackResearchResultsView(
        'browse:pending-session',
        [{ _id: 'synthetic-entity' }],
        'browse',
        1,
      ),
    flush: () => analytics.flushResearchAnalytics(),
    answerSessionCheck: (auth: boolean) => answerSessionCheck(auth),
  };
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('research analytics while the session check is pending', () => {
  it('discards a page-load event buffered before the check answers logged out', async () => {
    const { post, trackFirstResultsView, flush, answerSessionCheck } =
      await renderWithPendingSessionCheck();

    await act(async () => {
      await trackFirstResultsView();
    });
    expect(batchPosts(post)).toHaveLength(0);

    await act(async () => {
      answerSessionCheck(false);
    });
    await act(async () => {
      await flush();
    });

    expect(batchPosts(post)).toHaveLength(0);
  });

  it('delivers a page-load event buffered before the check answers signed in', async () => {
    const { post, trackFirstResultsView, flush, answerSessionCheck } =
      await renderWithPendingSessionCheck();

    await act(async () => {
      await trackFirstResultsView();
    });

    await act(async () => {
      answerSessionCheck(true);
    });
    await act(async () => {
      await flush();
    });

    const posts = batchPosts(post);
    expect(posts).toHaveLength(1);
    expect(posts[0][1].events).toEqual([
      expect.objectContaining({ eventType: 'research_results_view' }),
    ]);
  });

  it('sends no unload beacon while the check is pending and keeps the event for delivery', async () => {
    const { post, trackFirstResultsView, flush, answerSessionCheck } =
      await renderWithPendingSessionCheck();

    await act(async () => {
      await trackFirstResultsView();
    });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(batchPosts(post)).toHaveLength(0);

    await act(async () => {
      answerSessionCheck(true);
    });
    await act(async () => {
      await flush();
    });

    expect(batchPosts(post)).toHaveLength(1);
  });
});
