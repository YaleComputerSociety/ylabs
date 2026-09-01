export const YALIES_VERIFICATION_URL = 'https://api.yalies.io/v2/people';

const statusResult = (status) => ({ status, ok: status >= 200 && status < 300 });

export async function verifyYaliesCredential(credential, request = fetch) {
  if (!credential || typeof credential !== 'string') {
    throw new Error('credential is required');
  }

  const response = await request(YALIES_VERIFICATION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credential}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page: 1, page_size: 1, filters: {} }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });

  return statusResult(response.status);
}

export function rotationIsVerified(oldResult, newResult) {
  return [401, 403].includes(oldResult.status) && newResult.ok;
}
