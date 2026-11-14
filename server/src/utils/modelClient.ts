import { AsyncLocalStorage } from 'node:async_hooks';
import axios, { type AxiosResponse } from 'axios';
import mongoose from 'mongoose';
import { ModelCallUsage } from '../models/modelCallUsage';

const MODEL_ENDPOINT_PREFIX = 'https://api.openai.com/v1/';

export const FROZEN_MODEL_RESPONSE_HEADER = 'x-ylabs-frozen-model-response';

export const MODEL_CALLERS = [
  'card-synthesis',
  'center-affiliation-llm',
  'center-director-llm',
  'coverage-synthesis-evaluate',
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
  'search-rerank-live-miss',
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
  usageWrite?: 'awaited' | 'background';
  retryWhenThrottled?: boolean;
}

export const MODEL_THROTTLE_STATUSES: ReadonlySet<number> = new Set([429, 503]);
export const MODEL_THROTTLE_MAX_ATTEMPTS = 3;
export const MODEL_THROTTLE_MAX_TOTAL_WAIT_MS = 30_000;
export const MODEL_THROTTLE_BASE_DELAY_MS = 1_000;
export const MODEL_RETRY_AFTER_JITTER_MS = 250;

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
  return typeof url === 'string' && url.startsWith(MODEL_ENDPOINT_PREFIX);
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

async function recordUsage(request: ModelRequest, record: ModelUsageRecord): Promise<void> {
  const sink = usageSink;
  if (!sink) return;
  const write = sink(record).catch(() => undefined);
  if (request.usageWrite !== 'background') await write;
}

const modelFreeScope = new AsyncLocalStorage<string>();
const reportedRefusals = new Set<string>();

export class ModelCallRefusedError extends Error {
  constructor(scope: string, caller: ModelCaller) {
    super(`${scope} makes no model calls; ${caller} was refused`);
    this.name = 'ModelCallRefusedError';
  }
}

/**
 * Runs `run` with every model call refused, so code that must read cached outputs only
 * (materialization, #5537) cannot pay for a call however a caller wires it.
 */
export function withoutModelCalls<T>(scope: string, run: () => Promise<T>): Promise<T> {
  return modelFreeScope.run(scope, run);
}

export const modelCallsAreRefused = (): boolean => modelFreeScope.getStore() !== undefined;

function refuseInModelFreeScope(request: ModelRequest): void {
  const refusingScope = modelFreeScope.getStore();
  if (refusingScope === undefined) return;
  const key = `${refusingScope}:${request.caller}`;
  if (!reportedRefusals.has(key)) {
    reportedRefusals.add(key);
    console.warn(
      `[model-client] ${refusingScope} refused a ${request.caller} call; nothing new is written`,
    );
  }
  throw new ModelCallRefusedError(refusingScope, request.caller);
}

interface ThrottledResponse {
  status?: unknown;
  headers?: Record<string, unknown>;
}

const throttledResponse = (error: unknown): ThrottledResponse | undefined =>
  (error as { response?: ThrottledResponse } | undefined)?.response;

const isThrottle = (response: ThrottledResponse | undefined): boolean =>
  typeof response?.status === 'number' && MODEL_THROTTLE_STATUSES.has(response.status);

export function retryAfterMs(
  headers: Record<string, unknown> | undefined,
  now: number = Date.now(),
): number | undefined {
  const milliseconds = Number(headers?.['retry-after-ms']);
  if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
  const raw = headers?.['retry-after'];
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(String(raw));
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function throttleDelayMs(
  retryNumber: number,
  serverDelayMs: number | undefined,
  random: () => number = Math.random,
): number {
  if (serverDelayMs !== undefined) {
    return serverDelayMs + Math.floor(random() * MODEL_RETRY_AFTER_JITTER_MS);
  }
  return Math.floor(random() * MODEL_THROTTLE_BASE_DELAY_MS * 2 ** (retryNumber - 1));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function postModelRequest(
  endpoint: ModelEndpoint,
  request: ModelRequest,
): Promise<AxiosResponse> {
  refuseInModelFreeScope(request);
  let waitedMs = 0;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await postModelRequestOnce(endpoint, request);
    } catch (error) {
      const response = throttledResponse(error);
      if (
        request.retryWhenThrottled === false ||
        !isThrottle(response) ||
        attempt >= MODEL_THROTTLE_MAX_ATTEMPTS
      ) {
        throw error;
      }
      const delayMs = throttleDelayMs(attempt, retryAfterMs(response?.headers));
      if (waitedMs + delayMs > MODEL_THROTTLE_MAX_TOTAL_WAIT_MS) throw error;
      waitedMs += delayMs;
      await sleep(delayMs);
    }
  }
}

async function postModelRequestOnce(
  endpoint: ModelEndpoint,
  request: ModelRequest,
): Promise<AxiosResponse> {
  const startedAt = Date.now();
  let response: AxiosResponse;
  try {
    response = await axios.post(`https://api.openai.com/v1/${endpoint}`, request.body, {
      headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' },
      timeout: request.timeoutMs,
    });
  } catch (error) {
    if (!neverLeftTheProcess(error)) {
      await recordUsage(request, usageRecord(request, endpoint, startedAt, undefined));
    }
    throw error;
  }
  if (!responseWasFrozen(response)) {
    await recordUsage(request, usageRecord(request, endpoint, startedAt, response));
  }
  return response;
}

export function postChatCompletion(request: ModelRequest): Promise<AxiosResponse> {
  return postModelRequest('chat/completions', request);
}

export function postEmbedding(request: ModelRequest): Promise<AxiosResponse> {
  return postModelRequest('embeddings', request);
}
