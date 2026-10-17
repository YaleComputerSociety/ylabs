import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCoverageSynthesisLLM } from '../coverageSynthesis';
import { COVERAGE_SYNTHESIS_PROMPT } from '../prompts';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { default: { ...actual.default, post: vi.fn() } };
});

const post = vi.mocked(axios.post);

const sentUserMessage = (): string => {
  const body = post.mock.calls[0][1] as { messages: { role: string; content: string }[] };
  return body.messages.find((message) => message.role === 'user')?.content ?? '';
};

describe('the writer measures recent work from the day it runs', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({
      data: {
        choices: [{ message: { content: '{"fullDescription":"","usedSnippetIndexes":[]}' } }],
      },
    });
  });

  it('sends TODAY ahead of the evidence', async () => {
    const callLLM = defaultCoverageSynthesisLLM(
      'test-key',
      'gpt-5-mini',
      () => new Date('2026-10-16T12:00:00Z'),
    );
    await callLLM({
      entityName: 'Synthetic Lab',
      snippets: [
        {
          text: 'The lab studies coral reef ecology.',
          sourceUrl: 'https://example.edu',
          sourceName: 'lab-page',
        },
      ],
    } as never);
    const message = sentUserMessage();
    expect(message.startsWith('TODAY: 2026-10-16')).toBe(true);
    expect(message.indexOf('TODAY:')).toBeLessThan(message.indexOf('EVIDENCE SNIPPETS:'));
  });

  it('carries the recent-work rule in the prompt the date is read against', () => {
    expect(COVERAGE_SYNTHESIS_PROMPT).toContain('TODAY date in the message');
    expect(COVERAGE_SYNTHESIS_PROMPT).toContain('within about the last 5 years');
    expect(COVERAGE_SYNTHESIS_PROMPT).toContain('Never describe finished work as ongoing');
    expect(COVERAGE_SYNTHESIS_PROMPT).toContain('emeritus or retired');
    expect(COVERAGE_SYNTHESIS_PROMPT).not.toContain('a book title or subtitle');
  });
});
