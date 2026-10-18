export const RENDER_API_BASE = 'https://api.render.com/v1';

export const RENDER_JOB_TERMINAL_STATUSES = ['succeeded', 'failed', 'canceled'] as const;

export type RenderJobStatus = 'pending' | 'running' | (typeof RENDER_JOB_TERMINAL_STATUSES)[number];

export interface RenderJob {
  id: string;
  serviceId: string;
  status?: RenderJobStatus;
  createdAt?: string;
  startCommand?: string;
  startedAt?: string;
  finishedAt?: string;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface RenderClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function request(
  options: RenderClientOptions,
  method: string,
  pathName: string,
  body?: unknown,
): Promise<unknown> {
  const fetchFn = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const response = await fetchFn(`${options.baseUrl ?? RENDER_API_BASE}${pathName}`, {
    method,
    headers: headers(options.apiKey),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`Render API ${method} ${pathName} answered HTTP ${response.status}`);
  }
  return response.json();
}

function asJob(value: unknown): RenderJob {
  const job = value as Partial<RenderJob> | null;
  if (!job || typeof job.id !== 'string' || typeof job.serviceId !== 'string') {
    throw new Error('Render API returned a job without an id');
  }
  return job as RenderJob;
}

export interface RenderServiceDescription {
  id: string;
  name?: string;
  type?: string;
  suspended?: string;
  branch?: string;
  rootDir?: string;
  dashboardUrl?: string;
}

export async function describeRenderService(
  options: RenderClientOptions,
  serviceId: string,
): Promise<RenderServiceDescription> {
  const service = (await request(
    options,
    'GET',
    `/services/${encodeURIComponent(serviceId)}`,
  )) as Partial<RenderServiceDescription> | null;
  if (service?.id !== serviceId) throw new Error(`Render service ${serviceId} was not found`);
  return {
    id: service.id,
    name: service.name,
    type: service.type,
    suspended: service.suspended,
    branch: service.branch,
    rootDir: service.rootDir,
    dashboardUrl: service.dashboardUrl,
  };
}

export async function createRenderJob(
  options: RenderClientOptions,
  serviceId: string,
  startCommand: string,
): Promise<RenderJob> {
  return asJob(
    await request(options, 'POST', `/services/${encodeURIComponent(serviceId)}/jobs`, {
      startCommand,
    }),
  );
}

export async function retrieveRenderJob(
  options: RenderClientOptions,
  serviceId: string,
  jobId: string,
): Promise<RenderJob> {
  return asJob(
    await request(
      options,
      'GET',
      `/services/${encodeURIComponent(serviceId)}/jobs/${encodeURIComponent(jobId)}`,
    ),
  );
}

export function isTerminalRenderJobStatus(status: RenderJobStatus | undefined): boolean {
  return (RENDER_JOB_TERMINAL_STATUSES as readonly string[]).includes(status ?? '');
}

export interface WaitForRenderJobOptions {
  intervalMs: number;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onStatus?: (job: RenderJob) => void;
}

export async function waitForRenderJob(
  options: RenderClientOptions,
  serviceId: string,
  jobId: string,
  wait: WaitForRenderJobOptions,
): Promise<RenderJob> {
  const sleep = wait.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = wait.now ?? Date.now;
  const deadline = now() + wait.timeoutMs;
  let lastStatus: RenderJobStatus | undefined;
  for (;;) {
    const job = await retrieveRenderJob(options, serviceId, jobId);
    if (job.status !== lastStatus) {
      lastStatus = job.status;
      wait.onStatus?.(job);
    }
    if (isTerminalRenderJobStatus(job.status)) return job;
    if (now() >= deadline) {
      throw new Error(
        `Render job ${jobId} was still ${job.status ?? 'unknown'} after ${Math.round(wait.timeoutMs / 60_000)} minutes; it keeps running on Render`,
      );
    }
    await sleep(wait.intervalMs);
  }
}

export interface RenderDeploy {
  id: string;
  status?: string;
  commitId?: string;
  createdAt?: string;
  finishedAt?: string;
}

const unwrapListItem = (item: unknown, key: string): Record<string, unknown> | null => {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const inner = record[key];
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : record;
};

export async function listRenderDeploys(
  options: RenderClientOptions,
  serviceId: string,
  limit = 20,
): Promise<RenderDeploy[]> {
  const listed = await request(
    options,
    'GET',
    `/services/${encodeURIComponent(serviceId)}/deploys?limit=${limit}`,
  );
  if (!Array.isArray(listed)) throw new Error('Render API returned no deploy list');
  return listed.flatMap((item) => {
    const deploy = unwrapListItem(item, 'deploy');
    if (!deploy || typeof deploy.id !== 'string') return [];
    const commit = deploy.commit as { id?: unknown } | undefined;
    return [
      {
        id: deploy.id,
        status: typeof deploy.status === 'string' ? deploy.status : undefined,
        commitId: typeof commit?.id === 'string' ? commit.id : undefined,
        createdAt: typeof deploy.createdAt === 'string' ? deploy.createdAt : undefined,
        finishedAt: typeof deploy.finishedAt === 'string' ? deploy.finishedAt : undefined,
      },
    ];
  });
}

export async function listRenderJobs(
  options: RenderClientOptions,
  serviceId: string,
  limit = 20,
): Promise<RenderJob[]> {
  const listed = await request(
    options,
    'GET',
    `/services/${encodeURIComponent(serviceId)}/jobs?limit=${limit}`,
  );
  if (!Array.isArray(listed)) throw new Error('Render API returned no job list');
  return listed.flatMap((item) => {
    const job = unwrapListItem(item, 'job');
    return job && typeof job.id === 'string' && typeof job.serviceId === 'string'
      ? [job as unknown as RenderJob]
      : [];
  });
}
