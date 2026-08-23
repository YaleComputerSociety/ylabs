const BARE_URL_LABEL = /^https?:\/\/\S*$/i;

export function isBareUrlLinkLabel(label: string): boolean {
  return BARE_URL_LABEL.test(label.trim());
}

function humanLabelFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return undefined;
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return undefined;
  }
}

export function humanizeProgramLinkLabel(
  label: string | undefined,
  url: string,
): string | undefined {
  const trimmed = label?.trim();
  if (!trimmed) return label;
  if (!isBareUrlLinkLabel(trimmed)) return trimmed;
  return humanLabelFromUrl(url) ?? trimmed;
}
