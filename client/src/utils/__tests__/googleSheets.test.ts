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
      json: async () => ({ spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { exportToGoogleSheets } = await import('../googleSheets');
    const exportPromise = exportToGoogleSheets('Export', ['Name'], [['Ada']]);

    expect(popup.opener).toBeNull();

    const authUrl = new URL(popup.location.href);
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(window.open).toHaveBeenCalledWith(
      'about:blank',
      `google-auth-${state}`,
      'popup,width=500,height=600,noopener,noreferrer',
    );
    expect(authUrl.origin).toBe('https://accounts.google.com');
    expect(MockBroadcastChannel.channels[0].name).toBe(`google-oauth-token:${state}`);

    MockBroadcastChannel.channels[0].postMessage({
      type: 'google-oauth-token',
      token: 'ya29.matching-token-value-1234567890',
      state,
    });

    await expect(exportPromise).resolves.toBe('https://docs.google.com/spreadsheets/d/test/edit');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sheets.googleapis.com/v4/spreadsheets',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ya29.matching-token-value-1234567890',
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
      json: async () => ({ spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit' }),
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
      json: async () => ({ spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { exportToGoogleSheets } = await import('../googleSheets');
    const exportPromise = exportToGoogleSheets('Export', ['Name'], [['Ada']]);

    const authUrl = new URL(popup.location.href);
    const state = authUrl.searchParams.get('state');

    MockBroadcastChannel.channels[0].postMessage({
      type: 'google-oauth-token',
      token: 'ya29.matching-token-value-1234567890',
      state,
    });

    await expect(exportPromise).resolves.toBe('https://docs.google.com/spreadsheets/d/test/edit');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sheets.googleapis.com/v4/spreadsheets',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ya29.matching-token-value-1234567890',
        }),
      }),
    );
  });

  it('rejects malformed matching-state OAuth tokens before calling Sheets', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'google-client-id');
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    const popup: MockPopup = {
      closed: false,
      opener: window,
      location: { href: '' },
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { exportToGoogleSheets } = await import('../googleSheets');
    const exportPromise = exportToGoogleSheets('Export', ['Name'], [['Ada']]);

    const authUrl = new URL(popup.location.href);
    MockBroadcastChannel.channels[0].postMessage({
      type: 'google-oauth-token',
      token: 'bad token\r\nInjected: header',
      state: authUrl.searchParams.get('state'),
    });

    await expect(exportPromise).rejects.toThrow('Google sign-in was cancelled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts hung Sheets requests to bound OAuth token lifetime', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'google-client-id');
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    const popup: MockPopup = {
      closed: false,
      opener: window,
      location: { href: '' },
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { exportToGoogleSheets } = await import('../googleSheets');
    const exportPromise = exportToGoogleSheets('Export', ['Name'], [['Ada']]);

    const authUrl = new URL(popup.location.href);
    MockBroadcastChannel.channels[0].postMessage({
      type: 'google-oauth-token',
      token: 'ya29.matching-token-value-1234567890',
      state: authUrl.searchParams.get('state'),
    });

    await vi.advanceTimersByTimeAsync(15000);

    await expect(exportPromise).rejects.toThrow('Google Sheets request timed out');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sheets.googleapis.com/v4/spreadsheets',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
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
    expect(MockBroadcastChannel.channels[0].name).toBe('google-oauth-token:callback-state');
    expect(fakeWindow.history.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/oauth-callback.html',
    );
    expect(fakeWindow.close).toHaveBeenCalled();
  });

  it('OAuth callback drops malformed or oversized hash values before broadcasting', () => {
    const callbackScript = readFileSync(
      resolve(__dirname, '../../../public/oauth-callback.js'),
      'utf8',
    );
    const fakeWindow = {
      location: {
        hash: `#access_token=${'a'.repeat(4097)}&state=${'b'.repeat(129)}`,
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

    expect(MockBroadcastChannel.channels).toEqual([]);
    expect(fakeWindow.history.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/oauth-callback.html',
    );
    expect(fakeWindow.close).toHaveBeenCalled();
  });


  it('neutralizes formula-like headers and cells before writing to Google Sheets', async () => {
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
      json: async () => ({ spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { exportToGoogleSheets } = await import('../googleSheets');
    const exportPromise = exportToGoogleSheets(
      'Export',
      ['=Header', ' Safe'],
      [['+SUM(1,1)', '@HYPERLINK("https://example.test")']],
    );

    const authUrl = new URL(popup.location.href);
    MockBroadcastChannel.channels[0].postMessage({
      type: 'google-oauth-token',
      token: 'ya29.matching-token-value-1234567890',
      state: authUrl.searchParams.get('state'),
    });

    await expect(exportPromise).resolves.toBe('https://docs.google.com/spreadsheets/d/test/edit');
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const rowData = requestBody.sheets[0].data[0].rowData;
    expect(rowData[0].values[0].userEnteredValue.stringValue).toBe("'=Header");
    expect(rowData[0].values[1].userEnteredValue.stringValue).toBe(' Safe');
    expect(rowData[1].values[0].userEnteredValue.stringValue).toBe("'+SUM(1,1)");
    expect(rowData[1].values[1].userEnteredValue.stringValue).toBe(
      '\'@HYPERLINK("https://example.test")',
    );
  });

  it('bounds Google Sheets export title, columns, rows, and cell text before request construction', async () => {
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
      json: async () => ({ spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { exportToGoogleSheets } = await import('../googleSheets');
    const exportPromise = exportToGoogleSheets(
      'T'.repeat(200),
      Array.from({ length: 80 }, (_, index) => `Header ${index}`),
      Array.from({ length: 1200 }, () => Array.from({ length: 80 }, () => 'c'.repeat(2500))),
    );

    const authUrl = new URL(popup.location.href);
    MockBroadcastChannel.channels[0].postMessage({
      type: 'google-oauth-token',
      token: 'ya29.matching-token-value-1234567890',
      state: authUrl.searchParams.get('state'),
    });

    await expect(exportPromise).resolves.toBe('https://docs.google.com/spreadsheets/d/test/edit');
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.properties.title).toHaveLength(120);
    const rowData = requestBody.sheets[0].data[0].rowData;
    expect(rowData).toHaveLength(1001);
    expect(rowData[0].values).toHaveLength(50);
    expect(rowData[1].values).toHaveLength(50);
    expect(rowData[1].values[0].userEnteredValue.stringValue).toHaveLength(2000);
  });

  it('rejects non-Google-Sheets result URLs from the Sheets API response', async () => {
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
      json: async () => ({ spreadsheetUrl: 'https://evil.example/spreadsheets/d/test/edit' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { exportToGoogleSheets } = await import('../googleSheets');
    const exportPromise = exportToGoogleSheets('Export', ['Name'], [['Ada']]);

    const authUrl = new URL(popup.location.href);
    MockBroadcastChannel.channels[0].postMessage({
      type: 'google-oauth-token',
      token: 'ya29.matching-token-value-1234567890',
      state: authUrl.searchParams.get('state'),
    });

    await expect(exportPromise).rejects.toThrow(
      'Google Sheets API returned an unexpected spreadsheet URL',
    );
  });
});
