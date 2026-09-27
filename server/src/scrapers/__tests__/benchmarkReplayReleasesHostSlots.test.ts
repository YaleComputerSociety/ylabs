import axios from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BenchmarkReplayNetworkError,
  beginBenchmarkReplay,
  finishBenchmarkReplay,
} from '../snapshotBenchmarkMode';
import {
  HostConcurrencyLimiter,
  installScraperHostConcurrencyInterceptor,
} from '../utils/hostConcurrencyLimiter';

describe('a refused replay request returns its host slot', () => {
  afterEach(() => {
    try {
      finishBenchmarkReplay();
    } catch {
      /* not replaying */
    }
  });

  it('keeps refusing promptly after more refusals than the host allows at once', async () => {
    beginBenchmarkReplay([]);
    installScraperHostConcurrencyInterceptor(new HostConcurrencyLimiter(1));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const refused = axios.post('https://api.openai.com/v1/chat/completions', { attempt });
      const outcome = await Promise.race([
        refused.then(
          () => 'resolved',
          (error) => (error instanceof BenchmarkReplayNetworkError ? 'refused' : 'other'),
        ),
        new Promise((resolve) => setTimeout(() => resolve('hung'), 1000)),
      ]);
      expect(outcome).toBe('refused');
    }
  });
});
