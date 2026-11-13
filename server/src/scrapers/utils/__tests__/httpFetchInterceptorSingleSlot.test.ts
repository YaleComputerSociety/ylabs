import fs from 'fs';
import { afterAll, describe, expect, it } from 'vitest';

const directory = fs.mkdtempSync('/tmp/ylmhb-intercept-');
process.env.SCRAPER_MACHINE_HOST_SLOTS = 'on';
process.env.SCRAPER_MACHINE_HOST_SLOT_DIR = directory;
process.env.SCRAPER_HOST_SLOT_ACQUIRE_TIMEOUT_MS = '3000';

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('fetchPageWithPolicy under the scrape CLI interceptor', () => {
  it('takes one machine-wide slot per request, so a host limited to one is not wedged', async () => {
    const { default: axios } = await import('axios');
    const { installScraperHostConcurrencyInterceptor } = await import('../hostConcurrencyLimiter');
    const { machineHostBudgetLimiter } = await import('../scraperHostSlotLimiter');
    const { fetchPageWithPolicy } = await import('../httpFetch');
    const budget = machineHostBudgetLimiter();
    installScraperHostConcurrencyInterceptor(budget, { acquireTimeoutMs: 3_000 });

    const host = 'fixture-single.yale.edu';
    let peakSlots = 0;
    let transportFailures = 0;
    const page = await fetchPageWithPolicy(`https://${host}/page`, {
      assertUrl: async (url) => ({ toString: () => url }),
      maxRetries: 0,
      request: async (url, config) => {
        try {
          const response = await axios.get(url, {
            maxRedirects: config.maxRedirects,
            adapter: async (adapterConfig) => {
              peakSlots = Math.max(peakSlots, budget.readState(host)?.slots.length ?? 0);
              return {
                status: 200,
                statusText: 'OK',
                data: '<html>ok</html>',
                headers: {},
                config: adapterConfig,
              };
            },
          });
          return { status: response.status, data: String(response.data), finalUrl: url };
        } catch (error) {
          transportFailures += 1;
          throw error;
        }
      },
    });

    expect(page.status).toBe(200);
    expect(transportFailures).toBe(0);
    expect(peakSlots).toBe(1);
  }, 30_000);
});
