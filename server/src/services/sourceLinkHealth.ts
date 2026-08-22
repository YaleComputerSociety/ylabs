import axios from 'axios';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../utils/ssrfGuard';
import { sanitizeLogValue } from '../utils/logSanitizer';

export const sourceLinkHealthStatuses = [
  'HEALTHY',
  'REDIRECTED',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;
export type SourceLinkHealthStatus = (typeof sourceLinkHealthStatuses)[number];

export interface SourceLinkHealth {
  healthStatus: SourceLinkHealthStatus;
  httpStatusCode?: number;
}

export interface SourceLinkProbeResult {
  status?: number;
  errorCode?: string;
}

const DEAD_LINK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export function classifySourceLinkHealth(probe: SourceLinkProbeResult): SourceLinkHealth {
  const { status, errorCode } = probe;
  if (typeof status === 'number' && Number.isFinite(status)) {
    if (status >= 200 && status < 300) return { healthStatus: 'HEALTHY', httpStatusCode: status };
    if (status >= 300 && status < 400) {
      return { healthStatus: 'REDIRECTED', httpStatusCode: status };
    }
    if (status >= 400) return { healthStatus: 'UNAVAILABLE', httpStatusCode: status };
    return { healthStatus: 'UNKNOWN', httpStatusCode: status };
  }
  if (errorCode && DEAD_LINK_ERROR_CODES.has(errorCode)) {
    return { healthStatus: 'UNAVAILABLE' };
  }
  return { healthStatus: 'UNKNOWN' };
}

export function isLikelyUnavailableSourceLink(health: SourceLinkHealth | undefined): boolean {
  if (!health) return false;
  return (
    health.healthStatus === 'UNAVAILABLE' ||
    (typeof health.httpStatusCode === 'number' && health.httpStatusCode >= 400)
  );
}

export async function probeSourceLink(url: string): Promise<SourceLinkProbeResult> {
  let safeUrl: URL;
  try {
    safeUrl = await assertPublicHttpUrl(url);
  } catch {
    return { errorCode: 'ERR_SSRF_BLOCKED' };
  }

  const agents = ssrfSafeAgents();
  const request = (method: 'HEAD' | 'GET') =>
    axios.request({
      url: safeUrl.toString(),
      method,
      maxRedirects: 5,
      timeout: 7000,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
      responseType: method === 'GET' ? 'stream' : 'json',
      validateStatus: () => true,
    });

  try {
    let response = await request('HEAD');
    if (response.status >= 400) {
      response = await request('GET');
      if (response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
    }
    return { status: response.status };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    void sanitizeLogValue(error);
    return { errorCode: typeof code === 'string' ? code : 'ERR_REQUEST_FAILED' };
  }
}

export async function checkSourceLinkHealth(url: string): Promise<SourceLinkHealth> {
  return classifySourceLinkHealth(await probeSourceLink(url));
}
