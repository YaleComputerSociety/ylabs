export const RETIRED_PAPER_PIPELINE_ROLLBACK_ENV = 'RETIRED_PAPER_PIPELINE_ROLLBACK' as const;

export const RETIRED_BIBLIOGRAPHIC_SOURCE_NAMES = [
  'arxiv',
  'crossref',
  'europe-pmc',
  'nber',
  'openalex',
  'orcid',
  'pubmed',
  'semantic-scholar',
  'ssrn',
] as const;

export function isRetiredPaperPipelineRollbackEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[RETIRED_PAPER_PIPELINE_ROLLBACK_ENV] === 'true';
}

export function assertRetiredPaperPipelineRollbackEnabled(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isRetiredPaperPipelineRollbackEnabled(env)) {
    throw new Error(
      'Paper pipeline operations are quarantined with the retired bibliographic pipeline. Set RETIRED_PAPER_PIPELINE_ROLLBACK=true only as part of an approved rollback plan.',
    );
  }
}
