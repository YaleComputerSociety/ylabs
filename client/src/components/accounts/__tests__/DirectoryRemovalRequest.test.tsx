import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DirectoryRemovalRequest, {
  DIRECTORY_REMOVAL_REQUEST_PATH,
  REMOVAL_ACCEPTED_MESSAGE,
  REMOVAL_REQUESTED_MESSAGE,
  REMOVE_ME_LABEL,
} from '../DirectoryRemovalRequest';
import axios from '../../../utils/axios';
import { expectNoAxeViolations } from '../../../testUtils/axe';
import { PRIVACY_CONTACT_EMAIL, PRIVACY_CONTACT_MAILTO } from '../../../utils/privacyContact';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const csrfMock = vi.hoisted(() => ({
  sessionCsrfHeaders: vi.fn(async () => ({ 'X-CSRF-Token': 't'.repeat(64) })),
}));
vi.mock('../../../utils/sessionCsrf', () => csrfMock);

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const eligibility = (eligible: boolean, status?: 'pending' | 'accepted' | 'declined') => ({
  data: {
    eligible,
    request: status ? { status, createdAt: '2026-11-01T00:00:00.000Z' } : null,
  },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DirectoryRemovalRequest', () => {
  it('shows nothing to a signed-in person y/labs does not list', async () => {
    mockedAxios.get.mockResolvedValue(eligibility(false));
    const { container } = render(<DirectoryRemovalRequest />);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());
    await flush();

    expect(mockedAxios.get.mock.calls[0][0]).toBe(DIRECTORY_REMOVAL_REQUEST_PATH);
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button', { name: REMOVE_ME_LABEL })).toBeNull();
  });

  it('shows nothing when eligibility cannot be read', async () => {
    mockedAxios.get.mockRejectedValue(new Error('network'));
    const { container } = render(<DirectoryRemovalRequest />);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());
    await flush();

    expect(container.textContent).toBe('');
  });

  it('lets a listed person ask to be removed and confirms it', async () => {
    mockedAxios.get.mockResolvedValue(eligibility(true));
    let resolvePost: (value: unknown) => void = () => undefined;
    mockedAxios.post.mockReturnValue(new Promise((resolve) => (resolvePost = resolve)));
    const { container } = render(<DirectoryRemovalRequest />);

    const button = await screen.findByRole('button', { name: REMOVE_ME_LABEL });
    await expectNoAxeViolations(container);
    fireEvent.click(button);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    await waitFor(() => expect(mockedAxios.post).toHaveBeenCalledTimes(1));
    expect(csrfMock.sessionCsrfHeaders).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(DIRECTORY_REMOVAL_REQUEST_PATH, undefined, {
      headers: { 'X-CSRF-Token': 't'.repeat(64) },
    });

    resolvePost({ data: { request: { status: 'pending', createdAt: '2026-11-10T00:00:00Z' } } });
    const message = await screen.findByRole('status');
    expect(message.textContent).toBe(REMOVAL_REQUESTED_MESSAGE);
    expect(REMOVAL_REQUESTED_MESSAGE).toBe(
      "We'll stop showing you within 7 days. You can ask to be listed again at any time.",
    );
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(screen.queryByRole('button', { name: REMOVE_ME_LABEL })).toBeNull();
  });

  it('shows the pending confirmation while a request is pending', async () => {
    mockedAxios.get.mockResolvedValue(eligibility(true, 'pending'));
    render(<DirectoryRemovalRequest />);

    expect((await screen.findByRole('status')).textContent).toBe(REMOVAL_REQUESTED_MESSAGE);
    expect(screen.queryByRole('button', { name: REMOVE_ME_LABEL })).toBeNull();
  });

  it('says an accepted request was accepted', async () => {
    mockedAxios.get.mockResolvedValue(eligibility(true, 'accepted'));
    render(<DirectoryRemovalRequest />);

    expect((await screen.findByRole('status')).textContent).toBe(
      'Your request was accepted. You will stop appearing on y/labs within 7 days.',
    );
    expect(REMOVAL_ACCEPTED_MESSAGE).toBe(
      'Your request was accepted. You will stop appearing on y/labs within 7 days.',
    );
    expect(screen.queryByRole('button', { name: REMOVE_ME_LABEL })).toBeNull();
  });

  it('explains a declined request with the privacy mailbox and offers it again', async () => {
    mockedAxios.get.mockResolvedValue(eligibility(true, 'declined'));
    mockedAxios.post.mockResolvedValue({
      data: { request: { status: 'pending', createdAt: '2026-11-10T00:00:00Z' } },
    });
    const { container } = render(<DirectoryRemovalRequest />);

    const button = await screen.findByRole('button', { name: REMOVE_ME_LABEL });
    expect(container.textContent).toContain(
      'We could not confirm this request. You can send it again, or email ycs.maintenance.ylabs@gmail.com from the address Yale publishes for you.',
    );
    const link = screen.getByRole('link', { name: PRIVACY_CONTACT_EMAIL });
    expect(link.getAttribute('href')).toBe(PRIVACY_CONTACT_MAILTO);
    expect(link.getAttribute('href')).toBe('mailto:ycs.maintenance.ylabs@gmail.com');
    expect(link.className).toContain('yr-focus-ring');
    await expectNoAxeViolations(container);

    fireEvent.click(button);
    expect((await screen.findByRole('status')).textContent).toBe(REMOVAL_REQUESTED_MESSAGE);
    expect(container.textContent).not.toContain('We could not confirm');
  });

  it('sends nothing and says so when the CSRF token cannot be fetched', async () => {
    mockedAxios.get.mockResolvedValue(eligibility(true));
    csrfMock.sessionCsrfHeaders.mockRejectedValueOnce(new Error('network'));
    render(<DirectoryRemovalRequest />);

    fireEvent.click(await screen.findByRole('button', { name: REMOVE_ME_LABEL }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your request could not be sent. Please try again.',
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('says so when the request cannot be sent and keeps the button', async () => {
    mockedAxios.get.mockResolvedValue(eligibility(true));
    mockedAxios.post.mockRejectedValue(new Error('network'));
    render(<DirectoryRemovalRequest />);

    fireEvent.click(await screen.findByRole('button', { name: REMOVE_ME_LABEL }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your request could not be sent. Please try again.',
    );
    const button = screen.getByRole('button', { name: REMOVE_ME_LABEL });
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
