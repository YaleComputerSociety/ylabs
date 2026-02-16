/**
 * Google Sheets export using OAuth popup + fetch().
 * No external Google scripts needed — works even with ad blockers.
 */

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

let cachedToken: string | null = null;

function getAccessToken(clientId: string): Promise<string> {
    if (cachedToken) return Promise.resolve(cachedToken);

    return new Promise((resolve, reject) => {
        const redirectUri = `${window.location.origin}/oauth-callback.html`;
        const authUrl =
            `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${encodeURIComponent(clientId)}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&response_type=token` +
            `&scope=${encodeURIComponent(SCOPES)}`;

        const popup = window.open(authUrl, 'google-auth', 'width=500,height=600');
        if (!popup) {
            reject(new Error('Popup blocked — please allow popups for this site'));
            return;
        }

        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type !== 'google-oauth-token') return;
            window.removeEventListener('message', handleMessage);
            const token = event.data.token;
            if (token) {
                cachedToken = token;
                resolve(token);
            } else {
                reject(new Error('Google sign-in was cancelled'));
            }
        };

        window.addEventListener('message', handleMessage);

        const checkClosed = setInterval(() => {
            if (popup.closed) {
                clearInterval(checkClosed);
                window.removeEventListener('message', handleMessage);
                if (!cachedToken) {
                    reject(new Error('Google sign-in was cancelled'));
                }
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
        values: headers.map(h => ({
            userEnteredValue: { stringValue: h },
            userEnteredFormat: { textFormat: { bold: true } },
        })),
    };

    const dataRows = rows.map(row => ({
        values: row.map(cell => ({
            userEnteredValue: { stringValue: cell },
        })),
    }));

    const response = await fetch(SHEETS_API, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            properties: { title },
            sheets: [{
                data: [{
                    startRow: 0,
                    startColumn: 0,
                    rowData: [headerRow, ...dataRows],
                }],
            }],
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
