export const SCRAPER_UA_INFO_URL = 'https://yalelabs.io';
// The owner supplies a project or role address here, never a person's (#6211).
export const SCRAPER_UA_CONTACT = '<PLACEHOLDER: owner to supply a project or role address>';

export const SCRAPER_USER_AGENT = `ylabs-scraper/1.0 (+${SCRAPER_UA_INFO_URL}; ${SCRAPER_UA_CONTACT})`;

const isUserAgentHeader = (name: string): boolean => name.toLowerCase() === 'user-agent';

export function withScraperUserAgent(headers: Record<string, string> = {}): Record<string, string> {
  const kept = Object.entries(headers).filter(([name]) => !isUserAgentHeader(name));
  return { ...Object.fromEntries(kept), 'User-Agent': SCRAPER_USER_AGENT };
}
