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
const SECRET_FIELD =
  /((?:access[_-]?token|refresh[_-]?token|csrf[_-]?token|csrfmiddlewaretoken|xsrf[_-]?token|session[_-]?id|sessionid|api[_-]?key|auth(?:z|entication|orization)?[_-]?(?:token|key)?|bearer|password|secret|signature|nonce)["'\s:=]{1,6})[^\s"'<>&]{6,}/gi;
const SECRET_FIELD_NAMES =
  'access[_-]?token|refresh[_-]?token|csrf[_-]?token|csrfmiddlewaretoken|xsrf[_-]?token|session[_-]?id|sessionid|api[_-]?key|auth[_-]?token|password|secret|signature|nonce';
const SECRET_INPUT = new RegExp(
  `(name=["']?(?:${SECRET_FIELD_NAMES})["']?[^>]{0,80}?value=["']?)[^"'\\s>]+`,
  'gi',
);
const BEARER = /\b(bearer\s+)[^\s"'<>]+/gi;
const NUMERIC_ENTITY = /&#(x[0-9a-f]{1,6}|[0-9]{1,7});?/gi;
const NAMED_ENTITY = /&(period|colon|commat|percnt|sol|quest|amp|num|lpar|rpar|lsqb|rsqb);/gi;
const NAMED_ENTITY_CHARACTERS: Record<string, string> = {
  period: '.',
  colon: ':',
  commat: '@',
  percnt: '%',
  sol: '/',
  quest: '?',
  amp: '&',
  num: '#',
  lpar: '(',
  rpar: ')',
  lsqb: '[',
  rsqb: ']',
};
const PERCENT_ESCAPE = /%(25)*(2e|3a|40|25|26|3f|23|5b|5d)/gi;
const PERCENT_ESCAPE_CHARACTERS: Record<string, string> = {
  '2e': '.',
  '3a': ':',
  '40': '@',
  '25': '%',
  '26': '&',
  '3f': '?',
  '23': '#',
  '5b': '[',
  '5d': ']',
};
const DECODE_PASSES = 5;
/** The character classes an address, an email or an entity remnant can end in at a cut. */
const TRAILING_PARTIAL_TOKEN = /[0-9A-Fa-f.:%&#;a-z_~+-]*$/;

/**
 * Decodes the escapes a page can wrap an address in before the patterns run, because
 * `192&#46;0&#46;2&#46;1` and `192%2E0%2E2%2E1` name an address as surely as the plain form does.
 * It repeats until the text stops changing, so a double-encoded escape cannot survive by
 * decoding into another escape.
 */
export function decodeForRedaction(text: string): string {
  let current = text;
  for (let pass = 0; pass < DECODE_PASSES; pass += 1) {
    const decoded = current
      .replace(NUMERIC_ENTITY, (whole, code: string) => {
        const point = code.toLowerCase().startsWith('x')
          ? Number.parseInt(code.slice(1), 16)
          : Number.parseInt(code, 10);
        return Number.isFinite(point) && point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : whole;
      })
      .replace(NAMED_ENTITY, (whole, name: string) => {
        return NAMED_ENTITY_CHARACTERS[name.toLowerCase()] ?? whole;
      })
      .replace(PERCENT_ESCAPE, (whole, _repeat: string | undefined, code: string) => {
        return PERCENT_ESCAPE_CHARACTERS[code.toLowerCase()] ?? whole;
      });
    if (decoded === current) return current;
    current = decoded;
  }
  return current;
}

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
  return decodeForRedaction(text)
    .replace(QUERY_STRING, '?[query]')
    .replace(SECRET_INPUT, '$1[redacted]')
    .replace(BEARER, '$1[redacted]')
    .replace(SECRET_FIELD, '$1[redacted]')
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
 * 512-byte cut is replaced whole rather than leaving its first octets behind. The window's own cut
 * can split a token too, and each replacement shortens the text, so the partial token at the
 * window edge is dropped before redacting and the kept prefix is cut from the redacted text.
 */
export function refusedBodyPrefix(data: unknown): string {
  const raw = bodyBytes(data);
  if (!raw) return '';
  const window = withoutControlCharacters(raw.subarray(0, REDACTION_WINDOW_BYTES).toString('utf8'));
  const whole =
    raw.byteLength > REDACTION_WINDOW_BYTES ? window.replace(TRAILING_PARTIAL_TOKEN, '') : window;
  return utf8Prefix(redactDiagnosticText(whole), REFUSED_BODY_PREFIX_BYTES);
}

export function refusedResponseDiagnostics(
  status: number,
  headers: unknown,
  data: unknown,
): RefusedResponseDiagnostics | undefined {
  if (!REFUSED_RESPONSE_STATUSES.has(status)) return undefined;
  return { headers: allowedRefusedHeaders(headers), bodyPrefix: refusedBodyPrefix(data) };
}
