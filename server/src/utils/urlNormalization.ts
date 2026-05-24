export type NormalizedHttpUrl = {
  href: string;
  host: string;
  path: string;
  url: URL;
};

export function parseNormalizedHttpUrl(value: unknown): NormalizedHttpUrl | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (/\s/.test(raw)) return undefined;
  if (!/^https?:\/\//i.test(raw)) return undefined;

  try {
    const url = new URL(raw);
    return {
      href: url.toString(),
      host: url.hostname.toLowerCase().replace(/^www\./, ''),
      path: url.pathname.toLowerCase().replace(/\/+$/, ''),
      url,
    };
  } catch {
    return undefined;
  }
}

export function isHttpUrl(value: unknown): value is string {
  return Boolean(parseNormalizedHttpUrl(value));
}

export function normalizedHostMatchesSuffix(host: string, suffix: string): boolean {
  const normalizedHost = host.toLowerCase().replace(/^www\./, '');
  const normalizedSuffix = suffix.toLowerCase().replace(/^www\./, '');
  return normalizedHost === normalizedSuffix || normalizedHost.endsWith(`.${normalizedSuffix}`);
}

export function httpUrlHasHostSuffix(value: unknown, suffix: string): boolean {
  const parsed = parseNormalizedHttpUrl(value);
  return Boolean(parsed && normalizedHostMatchesSuffix(parsed.host, suffix));
}
