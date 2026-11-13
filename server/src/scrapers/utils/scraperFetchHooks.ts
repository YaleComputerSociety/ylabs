import axios from 'axios';
import {
  installScraperHostConcurrencyInterceptor,
  type HostSlotLimiter,
} from './hostConcurrencyLimiter';
import {
  installScraperHttpValidatorCache,
  type HttpValidatorCacheHandle,
} from './httpValidatorCache';
import { installScraperFetchDeadlines } from './scraperFetchDeadlines';
import { scraperHostSlotLimiter } from './scraperHostSlotLimiter';
import { SCRAPER_USER_AGENT } from './scraperUserAgent';

export interface ScraperFetchHookOptions {
  validatorCache?: boolean;
  hostSlotLimiter?: HostSlotLimiter;
}

let installed = false;
let validatorCacheRefused = false;
let validatorCache: HttpValidatorCacheHandle | null = null;

function installScraperUserAgent(): void {
  axios.interceptors.request.use((config) => {
    config.headers.set('User-Agent', SCRAPER_USER_AGENT);
    return config;
  });
}

// A refusal wins whichever install ran first, because a liveness check that reads a reused body
// reports a page that has since died as alive.
function refuseValidatorCache(): void {
  validatorCacheRefused = true;
  validatorCache?.detach();
  validatorCache = null;
}

export function installScraperFetchHooks(options: ScraperFetchHookOptions = {}): void {
  if (options.validatorCache === false) refuseValidatorCache();
  if (installed) return;
  installed = true;
  // Axios runs request interceptors last-registered first. The User-Agent stamp registers first so
  // it runs just before dispatch, and the validator cache registers after the host budget so a
  // reused body is answered before it takes a slot. A reused body brings its own adapter, so the
  // deadline adapter never logs it as sent.
  installScraperUserAgent();
  installScraperHostConcurrencyInterceptor(options.hostSlotLimiter ?? scraperHostSlotLimiter());
  if (!validatorCacheRefused) validatorCache = installScraperHttpValidatorCache();
  installScraperFetchDeadlines();
}
