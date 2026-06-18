const CREDENTIAL_URL_RE = /\b([a-z][a-z0-9+.-]*:\/\/)([^@\s/]+)@/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_TOKEN_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const BASIC_TOKEN_RE = /\b(Basic\s+)[A-Za-z0-9._~+/=-]+/gi;
const OPENAI_KEY_RE = /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g;
const SECRET_FIELD_NAME_PATTERN =
  'api[_-]?key|apiKey|access[_-]?token|accessToken|refresh[_-]?token|refreshToken|id[_-]?token|idToken|csrf[_-]?token|csrfToken|session[_-]?secret|sessionSecret|client[_-]?secret|clientSecret|cas[_-]?ticket|casTicket|ticket|password|secret|authorization|cookie|set-cookie|setCookie|x[_-]?seed[_-]?token|seed[_-]?token';
const SECRET_HEADER_RE = /\b(authorization|cookie|set-cookie|x-seed-token|x-csrf-token)\s*:\s*[^\r\n]+/gi;
const TOKEN_ASSIGNMENT_RE = new RegExp(`\\b(${SECRET_FIELD_NAME_PATTERN})=([^\\s&]+)`, 'gi');
const SECRET_QUOTED_FIELD_RE = new RegExp(
  `(["']?(?:${SECRET_FIELD_NAME_PATTERN})["']?\\s*:\\s*)(["'])(?:\\\\.|(?!\\2).)*\\2`,
  'gi',
);
const SECRET_BARE_FIELD_RE = new RegExp(
  `(["']?(?:${SECRET_FIELD_NAME_PATTERN})["']?\\s*:\\s*)([^"',}\\]\\s]+)`,
  'gi',
);
const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;
const MAX_SANITIZED_LOG_VALUE_LENGTH = 12000;
const TRUNCATED_LOG_SUFFIX = '[log-truncated]';

const truncateSanitizedLogValue = (value: string): string => {
  if (value.length <= MAX_SANITIZED_LOG_VALUE_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_SANITIZED_LOG_VALUE_LENGTH)}${TRUNCATED_LOG_SUFFIX}`;
};

export const sanitizeLogValue = (value: unknown): string => {
  const raw =
    value instanceof Error
      ? `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`
      : typeof value === 'string'
        ? value
        : (() => {
            try {
              return JSON.stringify(value);
            } catch {
	              return String(value);
	            }
	          })();

  const sanitized = raw
    .replace(CREDENTIAL_URL_RE, '$1[credentials-redacted]@')
    .replace(BEARER_TOKEN_RE, '$1[token-redacted]')
    .replace(BASIC_TOKEN_RE, '$1[token-redacted]')
    .replace(OPENAI_KEY_RE, 'sk-[secret-redacted]')
    .replace(SECRET_HEADER_RE, '$1: [secret-redacted]')
    .replace(TOKEN_ASSIGNMENT_RE, '$1=[secret-redacted]')
    .replace(SECRET_QUOTED_FIELD_RE, '$1$2[secret-redacted]$2')
    .replace(SECRET_BARE_FIELD_RE, '$1[secret-redacted]')
    .replace(EMAIL_RE, '[email redacted]')
    .replace(PHONE_RE, '[phone redacted]');

  return truncateSanitizedLogValue(sanitized);
};

export const sanitizeErrorForLog = (error: Error): { message: string; stack?: string } => ({
  message: sanitizeLogValue(error.message),
  stack: error.stack ? sanitizeLogValue(error.stack) : undefined,
});
