// @ts-ignore - Vitest executes this browser-oriented test in Node.
import { readFileSync } from 'fs';
// @ts-ignore - The client tsconfig does not include Node ambient types.
import { resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

declare const __dirname: string;

type MockPopup = {
  closed: boolean;
  opener: Window | null;
  location: { href: string };
};

class MockBroadcastChannel {
  static channels: MockBroadcastChannel[] = [];
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();
  messages: unknown[] = [];

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.channels.push(this);
  }

  postMessage(data: unknown) {
    this.messages.push(data);
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  static reset() {
    MockBroadcastChannel.channels = [];
  }
}

describe('Google Sheets OAuth popup', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
    MockBroadcastChannel.reset();
  });

  it('opens Google OAuth without exposing the app window as opener', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'google-client-id');
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    const popup: MockPopup = {
      closed: false,
      opener: window,
      location: { href: '' },
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ spreadsheetUrl: 'https://docs.google.test/sheet' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { exportToGoogleSheets } = await import('../googleSheets');
    const exportPromise = exportToGoogleSheets('Export', ['Name'], [['Ada']]);

    expect(window.open).toHaveBeenCalledWith('about:blank', 'google-auth', 'width=500,height=600');
    expect(popup.opener).toBeNull();

    const authUrl = new URL(popup.location.href);
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(authUrl.origin).toBe('https://accounts.google.com');

    MockBroadcastChannel.channels[0].postMessage({
      type: 'google-oauth-token',
      token: 'matching-token',
      state,
    });

    await expect(exportPromise).resolves.toBe('https://docs.google.test/sheet');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sheets.googleapis.com/v4/spreadsheets',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer matching-token',
        }),
      }),
    );
  });

  it('ignores broadcast token messages that do not match the OAuth state', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'google-client-id');
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    const popup: MockPopup = {
      closed: false,
      opener: window,
      location: { href: '' },
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ spreadsheetUrl: 'https://docs.google.test/sheet' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { exportToGoogleSheets } = await import('../googleSheets');
    const exportPromise = exportToGoogleSheets('Export', ['Name'], [['Ada']]);

    MockBroadcastChannel.channels[0].postMessage({
      type: 'google-oauth-token',
      token: 'wrong-state-token',
      state: 'wrong-state',
    });

    const rejection = expect(exportPromise).rejects.toThrow('Google sign-in was cancelled');
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(500);

    await rejection;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a token only from the opened popup when the OAuth state matches', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'google-client-id');
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    const popup: MockPopup = {
      closed: false,
      opener: window,
      location: { href: '' },
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ spreadsheetUrl: 'https://docs.google.test/sheet' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { exportToGoogleSheets } = await import('../googleSheets');
    const exportPromise = exportToGoogleSheets('Export', ['Name'], [['Ada']]);

    const authUrl = new URL(popup.location.href);
    const state = authUrl.searchParams.get('state');

    MockBroadcastChannel.channels[0].postMessage({
      type: 'google-oauth-token',
      token: 'matching-token',
      state,
    });

    await expect(exportPromise).resolves.toBe('https://docs.google.test/sheet');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sheets.googleapis.com/v4/spreadsheets',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer matching-token',
        }),
      }),
    );
  });

  it('OAuth callback broadcasts the token without requiring window.opener', () => {
    const callbackScript = readFileSync(
      resolve(__dirname, '../../../public/oauth-callback.js'),
      'utf8',
    );
    const fakeWindow = {
      location: {
        hash: '#access_token=callback-token&state=callback-state',
        origin: window.location.origin,
        pathname: '/oauth-callback.html',
        search: '',
      },
      history: {
        replaceState: vi.fn(),
      },
      close: vi.fn(),
    };

    const runCallback = new Function('window', 'URLSearchParams', 'BroadcastChannel', callbackScript);
    runCallback(fakeWindow, URLSearchParams, MockBroadcastChannel);

    expect(MockBroadcastChannel.channels[0].messages).toContainEqual({
      type: 'google-oauth-token',
      token: 'callback-token',
      state: 'callback-state',
    });
    expect(fakeWindow.history.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/oauth-callback.html',
    );
    expect(fakeWindow.close).toHaveBeenCalled();
  });
});
