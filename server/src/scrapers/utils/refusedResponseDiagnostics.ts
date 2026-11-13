export const REFUSED_RESPONSE_STATUSES: ReadonlySet<number> = new Set([403, 429]);
export const REFUSED_BODY_PREFIX_BYTES = 512;
const REFUSED_HEADER_VALUE_CHARS = 256;
const REDACTION_WINDOW_BYTES = 4096;

const ALLOWED_HEADERS = new Set([
  'retry-after',
  'content-type',
  'server',
  'date',
  'cf-ray',
  'cf-mitigated',
  'x-request-id',
  'x-correlation-id',
  'x-amz-cf-id',
  'x-amzn-requestid',
]);
const ALLOWED_HEADER_PREFIXES = ['x-ratelimit-', 'ratelimit-'];

export interface RefusedResponseDiagnostics {
  headers: Record<string, string>;
  bodyPrefix: string;
}

const IPV6_CANDIDATE =
  /\[?(?:[0-9a-f]{0,4}:){2,7}(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f]{1,4})?(?:%[0-9a-z._~-]+)?\]?/gi;
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d])/g;
const EMAIL = /[a-z0-9._%+-]+(?:@|%40)[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const QUERY_STRING = /\?[^\s"'<>#]*=[^\s"'<>#]*/g;

function withoutControlCharacters(text: string): string {
  let kept = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    kept += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? ' ' : character;
  }
  return kept;
}

const looksLikeIpv6 = (candidate: string): boolean =>
  candidate.includes('::') || (candidate.match(/:/g)?.length ?? 0) >= 4;

export function redactDiagnosticText(text: string): string {
  return text
    .replace(QUERY_STRING, '?[query]')
    .replace(EMAIL, '[email]')
    .replace(IPV6_CANDIDATE, (candidate) => (looksLikeIpv6(candidate) ? '[ip]' : candidate))
    .replace(IPV4, '[ip]');
}

function headerAllowed(name: string): boolean {
  return (
    ALLOWED_HEADERS.has(name) || ALLOWED_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

function headerEntries(headers: unknown): Array<[string, unknown]> {
  if (!headers || typeof headers !== 'object') return [];
  const plain =
    typeof (headers as { toJSON?: unknown }).toJSON === 'function'
      ? (headers as { toJSON: () => unknown }).toJSON()
      : headers;
  return Object.entries(plain as Record<string, unknown>);
}

export function allowedRefusedHeaders(headers: unknown): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [rawName, rawValue] of headerEntries(headers)) {
    const name = rawName.toLowerCase();
    if (!headerAllowed(name)) continue;
    const value = Array.isArray(rawValue) ? rawValue.join(', ') : String(rawValue ?? '');
    kept[name] = redactDiagnosticText(withoutControlCharacters(value)).slice(
      0,
      REFUSED_HEADER_VALUE_CHARS,
    );
  }
  return kept;
}

function bodyBytes(data: unknown): Buffer | undefined {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data && typeof data === 'object' && typeof (data as { pipe?: unknown }).pipe !== 'function') {
    try {
      return Buffer.from(JSON.stringify(data), 'utf8');
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function utf8Prefix(text: string, bytes: number): string {
  return Buffer.from(text, 'utf8')
    .subarray(0, bytes)
    .toString('utf8')
    .replace(/\uFFFD$/, '');
}

/**
 * Redaction runs over a window wider than the kept prefix, so an address that straddles the
 * 512-byte cut is replaced whole rather than leaving its first octets behind.
 */
export function refusedBodyPrefix(data: unknown): string {
  const raw = bodyBytes(data);
  if (!raw) return '';
  const window = raw.subarray(0, REDACTION_WINDOW_BYTES).toString('utf8');
  const redacted = redactDiagnosticText(withoutControlCharacters(window));
  return utf8Prefix(redacted, REFUSED_BODY_PREFIX_BYTES);
}

export function refusedResponseDiagnostics(
  status: number,
  headers: unknown,
  data: unknown,
): RefusedResponseDiagnostics | undefined {
  if (!REFUSED_RESPONSE_STATUSES.has(status)) return undefined;
  return { headers: allowedRefusedHeaders(headers), bodyPrefix: refusedBodyPrefix(data) };
}
