import { describe, expect, it } from 'vitest';
import { usableOpenAiApiKey } from '../openAiApiKey';

describe('usableOpenAiApiKey', () => {
  it('treats an unset, blank, or template placeholder value as no key', () => {
    expect(usableOpenAiApiKey(undefined)).toBeNull();
    expect(usableOpenAiApiKey('')).toBeNull();
    expect(usableOpenAiApiKey('   ')).toBeNull();
    expect(usableOpenAiApiKey('<your-openai-key>')).toBeNull();
    expect(usableOpenAiApiKey(' <your-openai-key> ')).toBeNull();
  });

  it('returns a real-looking key trimmed', () => {
    expect(usableOpenAiApiKey('sk-test')).toBe('sk-test');
    expect(usableOpenAiApiKey(' sk-test\n')).toBe('sk-test');
  });
});
