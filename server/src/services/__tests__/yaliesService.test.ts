import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  validateUser: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

vi.mock('../userService', () => ({
  createUser: mocks.createUser,
  validateUser: mocks.validateUser,
}));

const ORIGINAL_ENV = { ...process.env };

describe('yaliesService', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('does not send an outbound Yalies request when the API key is missing', async () => {
    process.env.YALIES_API_KEY = '';
    const { fetchYalie } = await import('../yaliesService');

    await expect(fetchYalie('abc123')).resolves.toBeNull();

    expect(axios.post).not.toHaveBeenCalled();
  });

  it('uses the current Yalies API key when fetching a user', async () => {
    process.env.YALIES_API_KEY = '';
    const { fetchYalie } = await import('../yaliesService');
    process.env.YALIES_API_KEY = 'fresh-key';
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: [
        {
          netid: 'abc123',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada.lovelace@yale.edu',
          year: 2026,
          school_code: 'YC',
          college: 'Grace Hopper',
          major: ['Computer Science'],
        },
      ],
    });
    mocks.validateUser.mockResolvedValueOnce(null);
    mocks.createUser.mockImplementationOnce(async (user) => user);

    await fetchYalie('abc123');

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.yalies.io/v2/people',
      { filters: { netid: ['abc123'] } },
      { headers: { Authorization: 'Bearer fresh-key' } },
    );
  });
});
