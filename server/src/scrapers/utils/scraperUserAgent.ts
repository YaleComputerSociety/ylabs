export const SCRAPER_USER_AGENT =
  'ylabs-scraper/1.0 (+https://yalelabs.io; ycs.maintenance.ylabs@gmail.com)';

const isUserAgentHeader = (name: string): boolean => name.toLowerCase() === 'user-agent';

export function withScraperUserAgent(headers: Record<string, string> = {}): Record<string, string> {
  const kept = Object.entries(headers).filter(([name]) => !isUserAgentHeader(name));
  return { ...Object.fromEntries(kept), 'User-Agent': SCRAPER_USER_AGENT };
}
