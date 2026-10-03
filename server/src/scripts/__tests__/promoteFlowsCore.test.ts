import { describe, expect, it } from 'vitest';
import {
  runPromoteBeta,
  runPromoteProduction,
  type PromoteBetaDeps,
  type PromoteProductionDeps,
} from '../promoteFlowsCore';
import type { FetchLike } from '../renderOneOffJob';
import type { StoredWeeklySweepRun } from '../weeklySweepRunsReportCore';

const NOW = Date.parse('2026-10-05T12:00:00Z');

const RENDER_ENV = {
  RENDER_API_KEY: 'rnd_test_key',
  RENDER_BETA_OPERATOR_SERVICE_ID: 'crn-beta1',
  RENDER_PRODUCTION_OPERATOR_SERVICE_ID: 'crn-prod1',
};

const goodRun: StoredWeeklySweepRun = {
  startedAt: new Date('2026-10-04T07:00:00Z'),
  finishedAt: new Date('2026-10-04T16:00:00Z'),
  status: 'succeeded',
  exitCode: 0,
  codeDrift: [],
  refusals: [],
  modes: [
    { mode: 'development-full', exitCode: 0, summaryFound: true },
    { mode: 'fellowship-development-full', exitCode: 0, summaryFound: true },
  ],
};

const mirrorPlan = {
  sourceEnvironment: 'development',
  targetEnvironment: 'beta',
  collections: [{ name: 'research_entities', sourceCopyCount: 100, targetCount: 95 }],
};

const productionPlan = {
  sourceEnvironment: 'beta',
  targetEnvironment: 'production',
  sourceDatabase: 'Beta',
  targetDatabase: 'Prod',
  syntheticReferenceBlockersClear: true,
  applyBlockers: [],
  includesObservations: false,
  includesScrapeRuns: false,
  productionAccountCarry: { inserted: 3 },
  collections: [{ name: 'research_entities', sourceCopyCount: 100, targetCount: 90 }],
};

interface Harness {
  yarnCalls: Array<{ args: string[]; env?: Record<string, string> }>;
  renderCalls: Array<{ method: string; url: string; body?: string }>;
  logs: string[];
  errors: string[];
  prompts: string[];
}

function renderFetch(
  harness: Harness,
  serviceId: string,
  branch: string,
  finalStatus: string,
): FetchLike {
  let polls = 0;
  return async (url, init) => {
    harness.renderCalls.push({ method: init.method, url, body: init.body });
    const json = async (): Promise<unknown> => {
      if (init.method === 'POST') return { id: 'job-9', serviceId, status: 'pending' };
      if (url.endsWith(`/services/${serviceId}`)) {
        return { id: serviceId, name: 'operator', branch, rootDir: '', suspended: 'not_suspended' };
      }
      polls += 1;
      return { id: 'job-9', serviceId, status: polls < 2 ? 'running' : finalStatus };
    };
    return { ok: true, status: 200, json };
  };
}

function baseDeps(
  harness: Harness,
  reports: Record<string, unknown>,
  answer: string | null,
  fetch: FetchLike,
  exitFor: (args: string[]) => number = () => 0,
) {
  return {
    env: { ...RENDER_ENV },
    log: (message: string) => harness.logs.push(message),
    error: (message: string) => harness.errors.push(message),
    runYarn: async (args: string[], env?: Record<string, string>) => {
      harness.yarnCalls.push({ args, env });
      return exitFor(args);
    },
    readJson: (filePath: string) => {
      const key = Object.keys(reports).find((name) => filePath.endsWith(name));
      if (!key) throw new Error('missing report');
      return reports[key];
    },
    workDir: '/tmp/ylabs-promote-test',
    prompt: async (question: string) => {
      harness.prompts.push(question);
      return answer;
    },
    fetch,
    sleep: async () => undefined,
    now: () => NOW,
    pollIntervalMs: 1,
    timeoutMs: 60_000,
  };
}

const newHarness = (): Harness => ({
  yarnCalls: [],
  renderCalls: [],
  logs: [],
  errors: [],
  prompts: [],
});

function betaDeps(
  harness: Harness,
  overrides: Partial<PromoteBetaDeps> & { answer?: string | null; finalStatus?: string } = {},
): PromoteBetaDeps {
  const { answer = 'yes', finalStatus = 'succeeded', ...rest } = overrides;
  return {
    ...baseDeps(
      harness,
      {
        'development-to-beta-plan.json': mirrorPlan,
        'development-to-beta-result.json': { ...mirrorPlan, status: 'applied' },
      },
      answer,
      renderFetch(harness, 'crn-beta1', 'beta', finalStatus),
    ),
    loadWeeklyRun: async () => goodRun,
    heldSweepLocks: async () => [],
    ...rest,
  };
}

function productionDeps(
  harness: Harness,
  overrides: Partial<PromoteProductionDeps> & { answer?: string | null } = {},
): PromoteProductionDeps {
  const { answer = 'production', ...rest } = overrides;
  return {
    ...baseDeps(
      harness,
      { 'production-promotion-plan.json': productionPlan },
      answer,
      renderFetch(harness, 'crn-prod1', 'main', 'succeeded'),
    ),
    listMainPullRequests: async () => [{ number: 12, isDraft: true, labels: [] }],
    ...rest,
  };
}

const yarnScripts = (harness: Harness) => harness.yarnCalls.map((call) => call.args.join(' '));

describe('promote:beta', () => {
  it('plans without writing on --dry-run', async () => {
    const harness = newHarness();
    const code = await runPromoteBeta(['--dry-run'], betaDeps(harness));
    expect(code).toBe(0);
    expect(yarnScripts(harness)).toEqual([
      'beta:refresh-from-development --output /tmp/ylabs-promote-test/development-to-beta-plan.json',
    ]);
    expect(harness.renderCalls.map((call) => call.method)).toEqual(['GET']);
    expect(harness.prompts).toEqual([]);
  });

  it('mirrors, then gates and reindexes on Render', async () => {
    const harness = newHarness();
    const code = await runPromoteBeta(['--backup-ref', 'atlas-snap-1'], betaDeps(harness));
    expect(code).toBe(0);
    expect(yarnScripts(harness)).toEqual([
      'beta:refresh-from-development --output /tmp/ylabs-promote-test/development-to-beta-plan.json',
      'beta:refresh-from-development --apply --confirm-development-to-beta --output /tmp/ylabs-promote-test/development-to-beta-result.json',
    ]);
    const created = harness.renderCalls.find((call) => call.method === 'POST')!;
    expect(created.url).toBe('https://api.render.com/v1/services/crn-beta1/jobs');
    expect(JSON.parse(created.body!)).toEqual({
      startCommand:
        'yarn --cwd server promote:remote-phase --environment beta --confirm-beta-backup',
    });
    expect(harness.logs.join('\n')).not.toContain('rnd_test_key');
  });

  it('writes nothing when the confirmation does not match', async () => {
    const harness = newHarness();
    const code = await runPromoteBeta(
      ['--backup-ref', 'atlas-snap-1'],
      betaDeps(harness, { answer: 'y' }),
    );
    expect(code).toBe(1);
    expect(yarnScripts(harness)).toHaveLength(1);
    expect(harness.renderCalls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('refuses without an interactive terminal unless --yes is passed', async () => {
    const refused = newHarness();
    expect(
      await runPromoteBeta(['--backup-ref', 'snap'], betaDeps(refused, { answer: null })),
    ).toBe(1);
    expect(refused.errors).toContain('refused: no interactive terminal to confirm on');

    const scripted = newHarness();
    expect(
      await runPromoteBeta(['--backup-ref', 'snap', '--yes'], betaDeps(scripted, { answer: null })),
    ).toBe(0);
    expect(scripted.prompts).toEqual([]);
  });

  it('refuses before any write when the weekly run failed or a writer holds a lock', async () => {
    const harness = newHarness();
    const code = await runPromoteBeta(
      ['--backup-ref', 'snap'],
      betaDeps(harness, {
        loadWeeklyRun: async () => ({ ...goodRun, status: 'failed', exitCode: 1 }),
        heldSweepLocks: async () => ['ysm-atoz-index'],
      }),
    );
    expect(code).toBe(1);
    expect(harness.errors).toEqual([
      'refused: latest weekly run status is failed',
      'refused: latest weekly run exit code is 1',
      'refused: a Development writer holds a live scrape job lock on ysm-atoz-index',
    ]);
    expect(yarnScripts(harness)).toHaveLength(1);
  });

  it('requires a backup reference before applying', async () => {
    const harness = newHarness();
    expect(await runPromoteBeta([], betaDeps(harness))).toBe(1);
    expect(harness.errors[0]).toContain('--backup-ref is required');
    expect(harness.prompts).toEqual([]);
  });

  it('fails when the Render gate job fails', async () => {
    const harness = newHarness();
    const code = await runPromoteBeta(
      ['--backup-ref', 'snap', '--yes'],
      betaDeps(harness, { finalStatus: 'failed' }),
    );
    expect(code).toBe(1);
    expect(harness.errors.join('\n')).toContain('Fix it in Development and run promote:beta again');
  });

  it('refuses when the Render setup is missing', async () => {
    const harness = newHarness();
    const deps = betaDeps(harness);
    deps.env = {};
    expect(await runPromoteBeta(['--backup-ref', 'snap', '--yes'], deps)).toBe(1);
    expect(harness.errors).toEqual([
      'refused: RENDER_API_KEY is not set',
      'refused: RENDER_BETA_OPERATOR_SERVICE_ID is not set',
    ]);
  });
});

describe('promote:production', () => {
  it('plans without writing on --dry-run', async () => {
    const harness = newHarness();
    expect(await runPromoteProduction(['--dry-run'], productionDeps(harness))).toBe(0);
    expect(yarnScripts(harness)).toEqual([
      'database:verify-names --pair beta-to-production',
      'production:promote-beta-copy --dataset-version prod-promote-2026-10-05-lane-a-beta-copy --output /tmp/ylabs-promote-test/production-promotion-plan.json',
    ]);
    expect(harness.prompts).toEqual([]);
  });

  it('applies with both confirmations only after the typed target name', async () => {
    const harness = newHarness();
    expect(await runPromoteProduction([], productionDeps(harness))).toBe(0);
    const apply = harness.yarnCalls.at(-1)!;
    expect(apply.args.slice(0, 2)).toEqual(['production:promote-beta-copy', '--apply']);
    expect(apply.env).toEqual({ CONFIRM_LANE_A_COPY: 'true', CONFIRM_PROD_SCRAPE: 'true' });
    const created = harness.renderCalls.find((call) => call.method === 'POST')!;
    expect(JSON.parse(created.body!)).toEqual({
      startCommand: 'yarn --cwd server promote:remote-phase --environment production',
    });
    expect(harness.logs.join('\n')).toContain('merge it (docs/release-process.md step 6)');
  });

  it('writes nothing on a yes instead of the target name', async () => {
    const harness = newHarness();
    expect(await runPromoteProduction([], productionDeps(harness, { answer: 'yes' }))).toBe(1);
    expect(harness.yarnCalls.some((call) => call.args.includes('--apply'))).toBe(false);
  });

  it('holds on a hold label and on an unreadable hold state', async () => {
    const held = newHarness();
    expect(
      await runPromoteProduction(
        [],
        productionDeps(held, {
          listMainPullRequests: async () => [
            { number: 12, isDraft: false, labels: [{ name: 'hold' }] },
          ],
        }),
      ),
    ).toBe(1);
    expect(held.errors).toEqual([
      'refused: promotion pull request #12 to main carries the hold label',
    ]);

    const unreadable = newHarness();
    expect(
      await runPromoteProduction(
        [],
        productionDeps(unreadable, {
          listMainPullRequests: async () => {
            throw new Error('gh pr list exited 1');
          },
        }),
      ),
    ).toBe(1);
    expect(unreadable.errors[0]).toContain('could not read the release hold from GitHub');
    expect(unreadable.yarnCalls.some((call) => call.args.includes('--apply'))).toBe(false);
  });

  it('refuses a plan with apply blockers', async () => {
    const harness = newHarness();
    const deps = productionDeps(harness);
    deps.readJson = () => ({ ...productionPlan, applyBlockers: ['empty source accounts'] });
    expect(await runPromoteProduction([], deps)).toBe(1);
    expect(harness.errors).toEqual(['refused: apply blockers: empty source accounts']);
    expect(harness.prompts).toEqual([]);
  });
});
