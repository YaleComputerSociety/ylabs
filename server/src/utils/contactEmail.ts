const EMAIL_ADDRESS_PATTERN =
  /^[a-z0-9.!#$&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function publicContactEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const withoutMailto = trimmed.replace(/^mailto:/i, '');
  if (
    /[\s,;<>()[\]"\\]/.test(withoutMailto) ||
    /[?#&]/.test(withoutMailto) ||
    /%0a|%0d/i.test(withoutMailto)
  ) {
    return undefined;
  }
  return EMAIL_ADDRESS_PATTERN.test(withoutMailto) ? withoutMailto.toLowerCase() : undefined;
}
