const TEMPLATE_PLACEHOLDER_PATTERN = /^<[^<>]*>$/;

export function usableOpenAiApiKey(
  raw: string | undefined = process.env.OPENAI_API_KEY,
): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed || TEMPLATE_PLACEHOLDER_PATTERN.test(trimmed)) return null;
  return trimmed;
}
