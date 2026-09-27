import http from 'http';
import axios from 'axios';
import { installScraperHostConcurrencyInterceptor } from '../../hostConcurrencyLimiter';
import { installScraperHttpValidatorCache } from '../../httpValidatorCache';
import { scraperHostSlotLimiter } from '../../scraperHostSlotLimiter';
import {
  SWEEP_PAGE_REUSE_RESPONSE_HEADER,
  installSweepPageReuse,
  withSweepPageReuseScope,
} from '../../sweepPageReuse';

const port = Number(process.env.FIXTURE_PORT);
const host = String(process.env.FIXTURE_HOST);
const paths = String(process.env.FIXTURE_PATHS).split(',');

const loopbackAgent = new http.Agent({
  lookup: (
    _hostname: string,
    options: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) =>
    options.all
      ? callback(null, [{ address: '127.0.0.1', family: 4 }])
      : callback(null, '127.0.0.1', 4),
} as http.AgentOptions);

async function fetchAll() {
  const results = [];
  for (const pagePath of paths) {
    try {
      const response = await axios.get(`http://${host}:${port}${pagePath}`, {
        httpAgent: loopbackAgent,
        maxRedirects: 5,
      });
      const finalUrl = new URL(String(response.request?.res?.responseUrl ?? ''));
      results.push({
        path: pagePath,
        status: response.status,
        body: String(response.data),
        finalPath: finalUrl.pathname,
        reused: Boolean(response.headers[SWEEP_PAGE_REUSE_RESPONSE_HEADER]),
      });
    } catch (error) {
      results.push({
        path: pagePath,
        status: (error as any)?.response?.status ?? -1,
        ...((error as any)?.response ? {} : { error: String(error) }),
      });
    }
  }
  return results;
}

async function main() {
  installScraperHostConcurrencyInterceptor(scraperHostSlotLimiter());
  installScraperHttpValidatorCache();
  const reuse = installSweepPageReuse();
  const { value, stats } = await withSweepPageReuseScope(fetchAll);
  await reuse?.settled();
  process.stdout.write(`${JSON.stringify({ results: value, stats })}\n`);
}

void main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
