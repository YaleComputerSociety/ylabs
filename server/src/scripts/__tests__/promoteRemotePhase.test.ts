import { afterEach, describe, expect, it, vi } from 'vitest';
import { runRemotePhase } from '../promoteRemotePhase';
import type { RemotePhaseStep } from '../promoteCore';

const BETA_ENV = {
  SCRAPER_ENV: 'beta',
  MEILISEARCH_INDEX_PREFIX: 'beta',
  MONGODBURL: 'set',
  MEILISEARCH_HOST: 'set',
  MEILISEARCH_WRITE_API_KEY: 'set',
  OPENAI_API_KEY: 'set',
};

afterEach(() => {
  vi.restoreAllMocks();
});

function capture() {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    lines.push(String(line));
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return lines;
}

const resultLine = (lines: string[]) =>
  JSON.parse(lines.find((line) => line.startsWith('PROMOTE_REMOTE_PHASE_RESULT '))!.slice(28));

describe('promote:remote-phase', () => {
  it('runs every Beta step in order and reports success', () => {
    const lines = capture();
    const ran: string[] = [];
    const code = runRemotePhase(
      ['--environment', 'beta', '--confirm-beta-backup'],
      BETA_ENV,
      (step) => {
        ran.push(step.label);
        return 0;
      },
    );
    expect(code).toBe(0);
    expect(ran).toHaveLength(7);
    expect(resultLine(lines)).toMatchObject({ environment: 'beta', status: 'succeeded' });
  });

  it('stops at the first failed gate and never reindexes after it', () => {
    const lines = capture();
    const ran: string[] = [];
    const code = runRemotePhase(['--environment', 'beta'], BETA_ENV, (step: RemotePhaseStep) => {
      ran.push(step.label);
      return step.label === 'data quality' ? 2 : 0;
    });
    expect(code).toBe(1);
    expect(ran).toEqual(['verify database names', 'visibility gate', 'data quality']);
    expect(resultLine(lines)).toMatchObject({ status: 'failed', failedStep: 'data quality' });
  });

  it('refuses on the wrong service before running anything', () => {
    const lines = capture();
    const ran: string[] = [];
    const code = runRemotePhase(['--environment', 'production'], BETA_ENV, (step) => {
      ran.push(step.label);
      return 0;
    });
    expect(code).toBe(1);
    expect(ran).toEqual([]);
    expect(resultLine(lines).status).toBe('refused');
  });
});

describe('promote:remote-phase search reindex result', () => {
  it('attaches the reindex mode and counts to the phase report and clears a stale result first', () => {
    const lines = capture();
    const cleared: string[] = [];
    const files: Record<string, string> = {};
    const code = runRemotePhase(
      ['--environment', 'beta'],
      BETA_ENV,
      (step: RemotePhaseStep) => {
        if (step.resultFile) {
          files[step.resultFile] = JSON.stringify({
            mode: 'incremental',
            addedDocumentCount: 2,
            updatedDocumentCount: 5,
            deletedDocumentCount: 0,
            unchangedDocumentCount: 100,
          });
        }
        return 0;
      },
      Date.now,
      {
        clear: (file) => {
          cleared.push(file);
          delete files[file];
        },
        read: (file) => files[file],
      },
    );
    expect(code).toBe(0);
    expect(cleared).toEqual(['/tmp/ylabs-beta-search-reindex.json']);
    const reindex = resultLine(lines).steps.find((s: any) => s.label === 'search reindex');
    expect(reindex.summary).toEqual({
      mode: 'incremental',
      addedDocumentCount: 2,
      updatedDocumentCount: 5,
      deletedDocumentCount: 0,
      unchangedDocumentCount: 100,
    });
  });

  it('reports a failed reindex as the failed step', () => {
    const lines = capture();
    const code = runRemotePhase(
      ['--environment', 'beta'],
      BETA_ENV,
      (step: RemotePhaseStep) => (step.label === 'search reindex' ? 1 : 0),
      Date.now,
      { clear: () => undefined, read: () => undefined },
    );
    expect(code).toBe(1);
    expect(resultLine(lines)).toMatchObject({ status: 'failed', failedStep: 'search reindex' });
  });
});
