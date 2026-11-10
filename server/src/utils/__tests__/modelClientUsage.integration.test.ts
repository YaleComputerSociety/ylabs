import axios from 'axios';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelCallUsage } from '../../models/modelCallUsage';
import { readModelUsageReport } from '../../scripts/modelUsageReportCore';
import { postChatCompletion } from '../modelClient';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

let memoryServer: MongoMemoryServer | undefined;

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri('model_client_usage_test'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await memoryServer?.stop();
});

beforeEach(async () => {
  await ModelCallUsage.collection.deleteMany({});
  vi.mocked(axios.post).mockResolvedValue({
    data: {
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 2000, completion_tokens: 100 },
    },
    headers: {},
  });
});

describe('model call usage on a connected database', () => {
  it('stores every call and the report reads it back per caller', async () => {
    for (const caller of ['card-synthesis', 'card-synthesis', 'coverage-synthesis-llm'] as const) {
      await postChatCompletion({
        caller,
        apiKey: 'sk-test',
        timeoutMs: 1,
        body: { model: 'gpt-5-mini' },
      });
    }

    expect(await ModelCallUsage.countDocuments()).toBe(3);
    const report = await readModelUsageReport(new Date(Date.now() - 60_000));
    expect(report.rows.map((row) => [row.caller, row.calls, row.promptTokens])).toEqual([
      ['card-synthesis', 2, 4000],
      ['coverage-synthesis-llm', 1, 2000],
    ]);
  });
});
