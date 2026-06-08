/**
 * Google Sheets export using OAuth popup + fetch().
 * No external Google scripts needed — works even with ad blockers.
 */

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const OAUTH_CHANNEL_NAME = 'google-oauth-token';

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
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(OAUTH_CHANNEL_NAME) : null;
    if (!channel) {
      reject(new Error('Google sign-in is not supported in this browser'));
      return;
    }

    const popup = window.open('about:blank', 'google-auth', 'width=500,height=600');
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
      const token = message.token;
      if (token) {
        cachedToken = token;
        resolve(token);
      } else {
        reject(new Error('Google sign-in was cancelled'));
      }
    };

    channel.onmessage = (event) => handleMessage(event.data);

    popup.opener = null;
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

  const headerRow = {
    values: headers.map((h) => ({
      userEnteredValue: { stringValue: h },
      userEnteredFormat: { textFormat: { bold: true } },
    })),
  };

  const dataRows = rows.map((row) => ({
    values: row.map((cell) => ({
      userEnteredValue: { stringValue: cell },
    })),
  }));

  const response = await fetch(SHEETS_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
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
      cachedToken = null;
      throw new Error('Token expired — please try again');
    }
    throw new Error(err.error?.message || `Sheets API error: ${response.status}`);
  }

  const result = await response.json();
  return result.spreadsheetUrl;
}
