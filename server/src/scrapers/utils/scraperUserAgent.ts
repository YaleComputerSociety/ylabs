export const SCRAPER_UA_INFO_URL = 'https://yalelabs.io';
// Only ever a project or role address, never a person's (#6211); unset until the owner names one.
export const SCRAPER_UA_CONTACT: string | undefined = undefined;

export function scraperUserAgentFor(contact: string | undefined): string {
  return `ylabs-scraper/1.0 (+${SCRAPER_UA_INFO_URL}${contact ? `; ${contact}` : ''})`;
}

export const SCRAPER_USER_AGENT = scraperUserAgentFor(SCRAPER_UA_CONTACT);

const isUserAgentHeader = (name: string): boolean => name.toLowerCase() === 'user-agent';

export function withScraperUserAgent(headers: Record<string, string> = {}): Record<string, string> {
  const kept = Object.entries(headers).filter(([name]) => !isUserAgentHeader(name));
  return { ...Object.fromEntries(kept), 'User-Agent': SCRAPER_USER_AGENT };
}
