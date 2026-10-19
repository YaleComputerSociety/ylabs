export const ECHOED_QUERY_MAX_LENGTH = 60;

export const echoedQuery = (query: string, maxLength = ECHOED_QUERY_MAX_LENGTH): string => {
  const trimmed = query.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
};
