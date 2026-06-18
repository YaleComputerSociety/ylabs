const MAX_CLIENT_ERROR_MESSAGE_LENGTH = 160;
const PRINTABLE_CLIENT_ERROR_RE = /^[A-Za-z0-9][A-Za-z0-9 .,'":;!?()/_-]{0,159}$/;
const SENSITIVE_CLIENT_ERROR_RE =
  /(?:https?:\/\/|mongodb(?:\+srv)?:\/\/|bearer\s+|token|secret|password|authorization|cookie|set-cookie|[A-Fa-f0-9]{24}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:^|\n)\s*at\s+\S+\s+\()/i;

const safeClientErrorText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CLIENT_ERROR_MESSAGE_LENGTH) return '';
  if (!PRINTABLE_CLIENT_ERROR_RE.test(trimmed)) return '';
  if (SENSITIVE_CLIENT_ERROR_RE.test(trimmed)) return '';
  return trimmed;
};

export const clientErrorMessage = (error: unknown, fallback: string): string => {
  const responseData = (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
  return (
    safeClientErrorText(responseData?.error) ||
    safeClientErrorText(responseData?.message) ||
    fallback
  );
};
