/**
 * Google Sheets export using OAuth popup + fetch().
 * No external Google scripts needed — works even with ad blockers.
 */

import { safeSpreadsheetCell } from './spreadsheetSafety';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const OAUTH_CHANNEL_NAME = 'google-oauth-token';
const OAUTH_POPUP_NAME_PREFIX = 'google-auth';
const OAUTH_POPUP_FEATURES = 'popup,width=500,height=600,noopener,noreferrer';
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9._~+\/-]+=*$/;
const MAX_ACCESS_TOKEN_LENGTH = 4096;
const MAX_SHEET_TITLE_LENGTH = 120;
const MAX_SHEET_HEADERS = 50;
const MAX_SHEET_ROWS = 1000;
const MAX_SHEET_CELL_LENGTH = 2000;
const SHEETS_REQUEST_TIMEOUT_MS = 15000;

let cachedToken: string | null = null;

type GoogleOAuthMessage = {
  type?: string;
  token?: string | null;
  state?: string | null;
};

function createOAuthState(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function oauthChannelNameForState(state: string): string {
  return OAUTH_STATE_PATTERN.test(state) ? `${OAUTH_CHANNEL_NAME}:${state}` : OAUTH_CHANNEL_NAME;
}

function oauthPopupNameForState(state: string): string {
  return OAUTH_STATE_PATTERN.test(state) ? `${OAUTH_POPUP_NAME_PREFIX}-${state}` : OAUTH_POPUP_NAME_PREFIX;
}

function openOAuthPopup(state: string): Window | null {
  const popup = window.open('about:blank', oauthPopupNameForState(state), OAUTH_POPUP_FEATURES);
  if (popup) {
    popup.opener = null;
  }
  return popup;
}

export function safeSheetCell(value: string): string {
  return safeSpreadsheetCell(String(value ?? '').slice(0, MAX_SHEET_CELL_LENGTH));
}

function safeSheetTitle(value: unknown): string {
  const title = String(value || 'Yale Research Export').trim().slice(0, MAX_SHEET_TITLE_LENGTH);
  return title || 'Yale Research Export';
}

function normalizeOAuthAccessToken(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  if (!raw || raw !== raw.trim()) return '';
  if (raw.length > MAX_ACCESS_TOKEN_LENGTH) return '';
  return ACCESS_TOKEN_PATTERN.test(raw) ? raw : '';
}

function safeGoogleSpreadsheetUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    if (url.hostname !== 'docs.google.com') return '';
    if (!url.pathname.startsWith('/spreadsheets/')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function getAccessToken(clientId: string): Promise<string> {
  if (cachedToken) return Promise.resolve(cachedToken);

  return new Promise((resolve, reject) => {
    const redirectUri = `${window.location.origin}/oauth-callback.html`;
    const oauthState = createOAuthState();
    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=token` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&state=${encodeURIComponent(oauthState)}`;

    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(oauthChannelNameForState(oauthState))
        : null;
    if (!channel) {
      reject(new Error('Google sign-in is not supported in this browser'));
      return;
    }

    const popup = openOAuthPopup(oauthState);
    if (!popup) {
      channel.close();
      reject(new Error('Popup blocked — please allow popups for this site'));
      return;
    }

    let settled = false;
    let checkClosed: ReturnType<typeof setInterval>;
    const cleanup = () => {
      channel.close();
      clearInterval(checkClosed);
    };

    const handleMessage = (message: GoogleOAuthMessage) => {
      if (message?.type !== OAUTH_CHANNEL_NAME) return;
      if (message?.state !== oauthState) return;
      settled = true;
      cleanup();
      const token = normalizeOAuthAccessToken(message.token);
      if (token) {
        cachedToken = token;
        resolve(token);
      } else {
        reject(new Error('Google sign-in was cancelled'));
      }
    };

    channel.onmessage = (event) => handleMessage(event.data);

    popup.location.href = authUrl;

    checkClosed = setInterval(() => {
      if (popup.closed && !settled) {
        settled = true;
        cleanup();
        reject(new Error('Google sign-in was cancelled'));
      }
    }, 500);
  });
}

export async function exportToGoogleSheets(
  title: string,
  headers: string[],
  rows: string[][],
): Promise<string> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID not configured');

  const token = await getAccessToken(clientId);
  cachedToken = null;

  const safeHeaders = headers.slice(0, MAX_SHEET_HEADERS);
  const safeRows = rows.slice(0, MAX_SHEET_ROWS).map((row) => row.slice(0, MAX_SHEET_HEADERS));
  const abortController = new AbortController();
  const timeoutId = window.setTimeout(() => abortController.abort(), SHEETS_REQUEST_TIMEOUT_MS);

  const headerRow = {
    values: safeHeaders.map((h) => ({
      userEnteredValue: { stringValue: safeSheetCell(h) },
      userEnteredFormat: { textFormat: { bold: true } },
    })),
  };

  const dataRows = safeRows.map((row) => ({
    values: row.map((cell) => ({
      userEnteredValue: { stringValue: safeSheetCell(cell) },
    })),
  }));

  try {
    const response = await fetch(SHEETS_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: abortController.signal,
      body: JSON.stringify({
        properties: { title: safeSheetTitle(title) },
        sheets: [
          {
            data: [
              {
                startRow: 0,
                startColumn: 0,
                rowData: [headerRow, ...dataRows],
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 401) {
        throw new Error('Token expired — please try again');
      }
      throw new Error(err.error?.message || `Sheets API error: ${response.status}`);
    }

    const result = await response.json();
    const spreadsheetUrl = safeGoogleSpreadsheetUrl(result?.spreadsheetUrl);
    if (!spreadsheetUrl) {
      throw new Error('Google Sheets API returned an unexpected spreadsheet URL');
    }
    return spreadsheetUrl;
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error('Google Sheets request timed out');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    cachedToken = null;
  }
}
