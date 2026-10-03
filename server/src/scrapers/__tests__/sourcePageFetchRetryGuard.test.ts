import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCES_DIR = path.resolve(__dirname, '../sources');
const AXIOS_CALL = /\baxios(?:\.(?:get|post|put|head|request))?\(/g;
const RETRY_WRAPPER = /retryOnRetryableStatus\(\s*\(\)\s*=>\s*$/;

const MODEL_ENDPOINT_CALLS: Record<string, number> = {
  'centerAffiliationLLMExtractor.ts': 1,
  'centerDirectorLLMExtractor.ts': 1,
  'labMicrositeDescriptionLLMExtractor.ts': 1,
  'labMicrositeUndergradLLMExtractor.ts': 1,
};

function unwrappedAxiosCalls(source: string): number {
  let count = 0;
  for (const match of source.matchAll(AXIOS_CALL)) {
    const before = source.slice(Math.max(0, match.index - 80), match.index);
    if (!RETRY_WRAPPER.test(before)) count += 1;
  }
  return count;
}

function sourceFiles(): string[] {
  return fs
    .readdirSync(SOURCES_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
}

describe('source lane page fetches retry a throttled refusal', () => {
  it('wraps every axios page fetch under sources/ in retryOnRetryableStatus', () => {
    const offenders: Record<string, number> = {};
    for (const name of sourceFiles()) {
      const unwrapped = unwrappedAxiosCalls(fs.readFileSync(path.join(SOURCES_DIR, name), 'utf8'));
      if (unwrapped > 0) offenders[name] = unwrapped;
    }
    expect(offenders).toEqual(MODEL_ENDPOINT_CALLS);
  });

  it('recognises a wrapped call and flags a bare one', () => {
    expect(
      unwrappedAxiosCalls(
        'const res = await retryOnRetryableStatus(() =>\n  axios.get(url, {}),\n);',
      ),
    ).toBe(0);
    expect(unwrappedAxiosCalls('const res = await axios.get(url, {});')).toBe(1);
    expect(unwrappedAxiosCalls('const res = await axios(url);')).toBe(1);
  });
});
