import axios from 'axios';
import { fetchPageWithPolicy, type HttpRequestFn } from '../../httpFetch';
import { recordHostRefusal } from '../../hostPause';
import { hostPausedUntil } from '../../hostPauseState';

const host = String(process.env.FIXTURE_HOST);

function emit(line: object): void {
  process.stdout.write(`${JSON.stringify({ pid: process.pid, ...line })}\n`);
}

// The stub server listens on loopback, which the SSRF guard refuses at both the URL check and the
// agent, so these two stand in for it. Everything the pause depends on is the real path: the
// pre-send pause read, the machine budget, and the recording of the answer.
const allowLoopback = async (url: string): Promise<URL> => new URL(url);

const sendToLoopback: HttpRequestFn = async (url, config) => {
  const response = await axios.request({
    url,
    method: 'GET',
    headers: config.headers,
    timeout: config.timeoutMs,
    maxRedirects: 0,
    responseType: 'text',
    validateStatus: () => true,
  });
  return { status: response.status, data: String(response.data ?? ''), finalUrl: url };
};

async function recordNotice(): Promise<void> {
  const pause = await recordHostRefusal({
    host,
    status: 403,
    body: String(process.env.FIXTURE_NOTICE),
  });
  emit({ event: 'recorded', pausedUntil: pause?.until.getTime() });
}

async function fetchOnce(): Promise<void> {
  try {
    const page = await fetchPageWithPolicy(String(process.env.FIXTURE_URL), {
      assertUrl: allowLoopback,
      request: sendToLoopback,
      maxRedirects: 0,
    });
    emit({ event: 'fetched', status: page.status });
  } catch (error) {
    emit({
      event: 'refused',
      error: (error as Error).name,
      pausedUntil: (error as { pause?: { until?: Date } }).pause?.until?.getTime(),
      storedPause: hostPausedUntil(host)?.getTime(),
    });
  }
}

async function main(): Promise<void> {
  if (process.env.FIXTURE_MODE === 'record-notice') await recordNotice();
  else await fetchOnce();
  process.exit(0);
}

void main();
