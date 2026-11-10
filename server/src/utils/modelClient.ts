import axios, { type AxiosResponse } from 'axios';
import mongoose from 'mongoose';
import { ModelCallUsage } from '../models/modelCallUsage';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export const FROZEN_MODEL_RESPONSE_HEADER = 'x-ylabs-frozen-model-response';

export const MODEL_CALLERS = [
  'card-synthesis',
  'center-affiliation-llm',
  'center-director-llm',
  'coverage-synthesis-llm',
  'description-prompt-ab-harness',
  'description-rewrite-backfill',
  'lab-description-synthesis',
  'lab-microsite-description-llm',
  'lab-microsite-undergrad-llm',
  'lab-site-declared-lead',
  'off-entity-graft-audit',
  'research-search-query-embedding',
  'research-topics-derivation',
  'scraper-llm-model-ab-harness',
] as const;

export type ModelCaller = (typeof MODEL_CALLERS)[number];

export type ModelEndpoint = 'chat/completions' | 'embeddings';

export interface ModelUsageRecord {
  caller: ModelCaller;
  endpoint: ModelEndpoint;
  model: string;
  succeeded: boolean;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  durationMs: number;
  calledAt: Date;
}

export type ModelUsageSink = (record: ModelUsageRecord) => Promise<void>;

export interface ModelRequest {
  caller: ModelCaller;
  apiKey: string;
  body: Record<string, unknown>;
  timeoutMs: number;
}

const storeInDatabaseWhenConnected: ModelUsageSink = async (record) => {
  if (mongoose.connection.readyState !== 1) return;
  await ModelCallUsage.create(record);
};

let usageSink: ModelUsageSink | null = storeInDatabaseWhenConnected;

export function setModelUsageSink(sink: ModelUsageSink | null): void {
  usageSink = sink;
}

export function restoreDefaultModelUsageSink(): void {
  usageSink = storeInDatabaseWhenConnected;
}

export function isModelEndpointUrl(url: unknown): boolean {
  return typeof url === 'string' && url.startsWith(`${OPENAI_BASE_URL}/`);
}

const tokenCount = (value: unknown): number => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
};

const responseWasFrozen = (response: AxiosResponse | undefined): boolean => {
  const headers = response?.headers as Record<string, unknown> | undefined;
  return headers?.[FROZEN_MODEL_RESPONSE_HEADER] === 'true';
};

function usageRecord(
  request: ModelRequest,
  endpoint: ModelEndpoint,
  startedAt: number,
  response: AxiosResponse | undefined,
): ModelUsageRecord {
  const usage = (response?.data as { usage?: Record<string, any> } | undefined)?.usage ?? {};
  return {
    caller: request.caller,
    endpoint,
    model: String(request.body.model ?? ''),
    succeeded: response !== undefined,
    promptTokens: tokenCount(usage.prompt_tokens),
    cachedPromptTokens: tokenCount(usage.prompt_tokens_details?.cached_tokens),
    completionTokens: tokenCount(usage.completion_tokens),
    reasoningTokens: tokenCount(usage.completion_tokens_details?.reasoning_tokens),
    durationMs: Date.now() - startedAt,
    calledAt: new Date(startedAt),
  };
}

const neverLeftTheProcess = (error: unknown): boolean =>
  error instanceof Error && error.name === 'BenchmarkReplayNetworkError';

async function recordUsage(record: ModelUsageRecord): Promise<void> {
  const sink = usageSink;
  if (!sink) return;
  await sink(record).catch(() => undefined);
}

async function postModelRequest(
  endpoint: ModelEndpoint,
  request: ModelRequest,
): Promise<AxiosResponse> {
  const startedAt = Date.now();
  let response: AxiosResponse;
  try {
    response = await axios.post(`${OPENAI_BASE_URL}/${endpoint}`, request.body, {
      headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' },
      timeout: request.timeoutMs,
    });
  } catch (error) {
    if (!neverLeftTheProcess(error)) {
      await recordUsage(usageRecord(request, endpoint, startedAt, undefined));
    }
    throw error;
  }
  if (!responseWasFrozen(response)) {
    await recordUsage(usageRecord(request, endpoint, startedAt, response));
  }
  return response;
}

export function postChatCompletion(request: ModelRequest): Promise<AxiosResponse> {
  return postModelRequest('chat/completions', request);
}

export function postEmbedding(request: ModelRequest): Promise<AxiosResponse> {
  return postModelRequest('embeddings', request);
}
