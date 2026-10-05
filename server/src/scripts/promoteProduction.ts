import { spawnSync } from 'child_process';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';
import type { PullRequestHoldState } from './promoteCore';
import { runPromoteProduction } from './promoteFlowsCore';
import { SERVER_ROOT, baseRuntimeDeps } from './promoteRuntime';

export const PROMOTION_REPOSITORY = 'YaleComputerSociety/ylabs';

export async function listOpenMainPullRequests(): Promise<PullRequestHoldState[]> {
  const result = spawnSync(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      PROMOTION_REPOSITORY,
      '--base',
      'main',
      '--state',
      'open',
      '--json',
      'number,isDraft,labels',
    ],
    { cwd: SERVER_ROOT, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`gh pr list exited ${result.status ?? 'without a status'}`);
  }
  return JSON.parse(result.stdout) as PullRequestHoldState[];
}

if (isDirectScriptInvocation(import.meta.url, 'promoteProduction')) {
  runPromoteProduction(process.argv.slice(2), {
    ...baseRuntimeDeps('production'),
    listMainPullRequests: listOpenMainPullRequests,
  })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[promote:production] failed: ${sanitizeLogValue(error)}`);
      process.exitCode = 1;
    });
}
