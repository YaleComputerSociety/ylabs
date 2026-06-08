export function isPublicHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function publicHttpUrl(value: unknown): string | undefined {
  if (!isPublicHttpUrl(value)) return undefined;
  return new URL((value as string).trim()).toString();
}
