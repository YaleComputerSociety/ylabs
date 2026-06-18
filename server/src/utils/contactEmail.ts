const EMAIL_ADDRESS_PATTERN =
  /^[a-z0-9.!#$&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const PUBLIC_CONTACT_EMAIL_DOMAINS = ['yale.edu'];

const isPublicInstitutionalEmailDomain = (email: string): boolean => {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  return PUBLIC_CONTACT_EMAIL_DOMAINS.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  );
};

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
  const email = withoutMailto.toLowerCase();
  return EMAIL_ADDRESS_PATTERN.test(email) && isPublicInstitutionalEmailDomain(email)
    ? email
    : undefined;
}
