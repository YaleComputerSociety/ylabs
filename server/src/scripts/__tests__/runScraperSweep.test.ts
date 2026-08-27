import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildOrchestrator } from '../../scrapers/registry';
import {
  DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS,
  SCRAPER_SWEEP_SOURCES,
  buildDevelopmentPostRunStages,
  buildScraperSweepChildArgs,
  orderedScraperSweepPhases,
  parseDevelopmentPostRunStageResult,
  parseEponymousFraMergeResult,
  parseResearcherDedupeResult,
  parseScraperSweepArgs,
  resolveDevelopmentPostRunOptions,
  resolvePhaseConcurrency,
  runWithBoundedConcurrency,
  scraperSweepArtifactError,
  validateScraperSweepEnvironment,
  validateScraperSweepManifest,
  validateScraperSweepSourceRows,
} from '../runScraperSweep';

describe('runScraperSweep', () => {
  it('includes every registered scraper exactly once', () => {
    const registeredNames = buildOrchestrator()
      .list()
      .map((source) => source.name);
    expect(() => validateScraperSweepManifest(registeredNames)).not.toThrow();
    expect(new Set(SCRAPER_SWEEP_SOURCES.map((source) => source.name)).size).toBe(
      registeredNames.length,
    );
  });

  it('blocks a sweep manifest that omits a registered scraper', () => {
    expect(() => validateScraperSweepManifest(['yale-directory', 'future-source'])).toThrow(
      /missing from sweep|unknown sweep sources/,
    );
  });

  it('fails before the sweep when a registered source metadata row is missing', () => {
    expect(() =>
      validateScraperSweepSourceRows(['yale-directory', 'center-director-llm'], ['yale-directory']),
    ).toThrow(/center-director-llm.*source metadata seed/i);
  });

  it('requires explicit confirmation for full Development and Beta fetch sweeps', () => {
    expect(() => parseScraperSweepArgs(['--mode=development-full'])).toThrow(
      /confirm-development-full-sweep/,
    );
    expect(() => parseScraperSweepArgs(['--mode=beta-fetch'])).toThrow(
      /confirm-beta-release-candidate/,
    );
    expect(
      parseScraperSweepArgs(['--mode=development-full', '--confirm-development-full-sweep']).mode,
    ).toBe('development-full');
    expect(
      parseScraperSweepArgs(['--mode=beta-fetch', '--confirm-beta-release-candidate']).mode,
    ).toBe('beta-fetch');
  });

  it('requires explicit confirmation for the incremental Development sweep', () => {
    expect(() => parseScraperSweepArgs(['--mode=development-incremental'])).toThrow(
      /confirm-development-incremental-sweep/,
    );
    expect(
      parseScraperSweepArgs([
        '--mode=development-incremental',
        '--confirm-development-incremental-sweep',
      ]).mode,
    ).toBe('development-incremental');
  });

  it('parses an optional positive-integer concurrency and rejects invalid values', () => {
    expect(
      parseScraperSweepArgs(['--mode=development-full', '--confirm-development-full-sweep'])
        .concurrency,
    ).toBeUndefined();
    expect(
      parseScraperSweepArgs([
        '--mode=development-full',
        '--confirm-development-full-sweep',
        '--concurrency=6',
      ]).concurrency,
    ).toBe(6);
    expect(
      parseScraperSweepArgs([
        '--mode=development-full',
        '--confirm-development-full-sweep',
        '--concurrency',
        '3',
      ]).concurrency,
    ).toBe(3);
    expect(() =>
      parseScraperSweepArgs([
        '--mode=development-full',
        '--confirm-development-full-sweep',
        '--concurrency=0',
      ]),
    ).toThrow(/positive integer/);
    expect(() =>
      parseScraperSweepArgs([
        '--mode=development-full',
        '--confirm-development-full-sweep',
        '--concurrency=two',
      ]),
    ).toThrow(/positive integer/);
  });

  it('orders phases by first declared appearance', () => {
    expect(orderedScraperSweepPhases()).toEqual([
      'identity',
      'discovery',
      'funding',
      'relationships',
      'content-access',
    ]);
  });

  it('caps LLM phases, honors an override, and never drops below one', () => {
    expect(resolvePhaseConcurrency('development-full', 'discovery')).toBe(4);
    expect(resolvePhaseConcurrency('development-full', 'discovery', 8)).toBe(8);
    expect(resolvePhaseConcurrency('development-full', 'content-access', 8)).toBe(2);
    expect(resolvePhaseConcurrency('development-full', 'relationships', 8)).toBe(2);
    expect(resolvePhaseConcurrency('beta-fetch', 'discovery')).toBe(1);
    expect(resolvePhaseConcurrency('development-full', 'discovery', 1)).toBe(1);
  });

  it('runs every item without exceeding the concurrency limit', async () => {
    const items = Array.from({ length: 20 }, (_, index) => index);
    const completed: number[] = [];
    let inFlight = 0;
    let peak = 0;
    await runWithBoundedConcurrency(items, 4, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      completed.push(item);
    });
    expect(completed.sort((a, b) => a - b)).toEqual(items);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('builds bounded plan arguments and exhaustive full-sweep arguments', () => {
    expect(
      buildScraperSweepChildArgs('development-plan', 'yale-directory', '/tmp/yale-directory.json'),
    ).toEqual([
      '--cwd',
      'server',
      'scrape',
      'run',
      '--source',
      'yale-directory',
      '--limit',
      '100',
      '--use-cache',
      '--dry-run',
      '--output',
      '/tmp/yale-directory.json',
    ]);
    const betaArgs = buildScraperSweepChildArgs(
      'beta-fetch',
      'yale-directory',
      '/tmp/yale-directory.json',
    );
    expect(betaArgs).toContain('--ignore-work-planner');
    expect(betaArgs).toContain('--exhaustive');
    expect(betaArgs).not.toContain('--limit');
    expect(betaArgs).not.toContain('--auto-materialize');
    expect(betaArgs).not.toContain('--use-cache');

    const developmentArgs = buildScraperSweepChildArgs(
      'development-full',
      'yale-directory',
      '/tmp/yale-directory.json',
    );
    expect(developmentArgs).toContain('--exhaustive');
    expect(developmentArgs).not.toContain('--limit');
    expect(developmentArgs).toContain('--auto-materialize');
    expect(developmentArgs).toContain('--use-cache');
    expect(developmentArgs).toContain('--ignore-work-planner');

    const incrementalArgs = buildScraperSweepChildArgs(
      'development-incremental',
      'yale-directory',
      '/tmp/yale-directory.json',
    );
    expect(incrementalArgs).toContain('--exhaustive');
    expect(incrementalArgs).toContain('--use-cache');
    expect(incrementalArgs).toContain('--auto-materialize');
    expect(incrementalArgs).not.toContain('--ignore-work-planner');
    expect(incrementalArgs).not.toContain('--limit');
  });

  it('rejects incomplete runs and Development materialization errors', () => {
    expect(
      scraperSweepArtifactError('development-full', {
        runId: 'run-1',
        runStatus: 'success',
        materializationErrors: 1,
      }),
    ).toMatch(/materialization reported 1 errors/);
    expect(
      scraperSweepArtifactError('development-incremental', {
        runId: 'run-incremental',
        runStatus: 'success',
        materializationErrors: 2,
      }),
    ).toMatch(/materialization reported 2 errors/);
    expect(
      scraperSweepArtifactError('beta-fetch', {
        runId: 'run-2',
        runStatus: 'success',
        materializationErrors: 3,
      }),
    ).toBeUndefined();
    expect(
      scraperSweepArtifactError('beta-fetch', {
        runId: 'run-2',
        runStatus: 'success',
      }),
    ).toBeUndefined();
    expect(
      scraperSweepArtifactError('beta-fetch', {
        runStatus: 'success',
      }),
    ).toMatch(/missing run.id/);
  });

  it('builds the complete Development post-run quality pipeline', () => {
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep');
    expect(stages.map((stage) => stage.name)).toEqual([
      'faculty-projection',
      'visibility-gate',
      'search-rebuild',
      'coverage-audit',
      'data-quality',
      'integrity-gate',
      'trust-contract',
      'archived-cleanup',
    ]);
    expect(stages.find((stage) => stage.name === 'visibility-gate')?.args).toEqual(
      expect.arrayContaining([
        'student-visibility:gate',
        '--collection=all',
        '--apply',
        '--confirm-student-visibility-apply',
        '--max-apply=100000',
      ]),
    );
    expect(stages.every((stage) => stage.artifactPath.startsWith('/tmp/development-sweep/'))).toBe(
      true,
    );
    expect(stages.find((stage) => stage.name === 'archived-cleanup')?.args).toEqual(
      expect.arrayContaining(['research-entity:cleanup-archived', '--merge-residue-only']),
    );
    expect(stages.find((stage) => stage.name === 'archived-cleanup')?.args).not.toContain(
      '--apply',
    );
    expect(stages.find((stage) => stage.name === 'faculty-projection')?.args).toEqual(
      expect.arrayContaining(['--apply', '--confirm-faculty-projection', '--concurrency', '12']),
    );
    expect(stages.find((stage) => stage.name === 'data-quality')?.args).toEqual(
      expect.arrayContaining(['--strict', '--include-samples', '--progress']),
    );
    expect(stages.find((stage) => stage.name === 'trust-contract')?.args).toEqual(
      expect.arrayContaining([
        '--collection=all',
        '--mode=student-ready-only',
        '--include-research-activity',
        '--include-paper-quality',
        '--strict',
      ]),
    );
  });

  it('keeps the archived-cleanup stage report-only unless merge-residue deletion is enabled', () => {
    const reportOnly = buildDevelopmentPostRunStages('/tmp/development-sweep');
    const reportOnlyArgs = reportOnly.find((stage) => stage.name === 'archived-cleanup')?.args;
    expect(reportOnlyArgs).toEqual(
      expect.arrayContaining(['research-entity:cleanup-archived', '--merge-residue-only']),
    );
    expect(reportOnlyArgs).not.toContain('--apply');
    expect(reportOnlyArgs).not.toContain('--confirm-archived-entity-cleanup');

    const deleting = buildDevelopmentPostRunStages('/tmp/development-sweep', {
      deleteMergeResidue: true,
    });
    const deletingArgs = deleting.find((stage) => stage.name === 'archived-cleanup')?.args;
    expect(deletingArgs).toEqual(
      expect.arrayContaining([
        'research-entity:cleanup-archived',
        '--merge-residue-only',
        '--apply',
        '--confirm-archived-entity-cleanup',
        '--max-apply=5000',
      ]),
    );
    expect(deleting.map((stage) => stage.name).at(-1)).toBe('archived-cleanup');
  });

  it('omits the eponymous FRA merge stage by default (flag off)', () => {
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep');
    expect(stages.map((stage) => stage.name)).not.toContain('eponymous-fra-merge');
  });

  it('inserts the eponymous FRA merge stage after materialization and before search-rebuild when enabled', () => {
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep', {
      autoMergeEponymousFra: true,
      sinceIso: '2026-08-26T00:00:00.000Z',
      maxMerges: 20,
    });
    const names = stages.map((stage) => stage.name);
    expect(names).toEqual([
      'faculty-projection',
      'eponymous-fra-merge',
      'visibility-gate',
      'search-rebuild',
      'coverage-audit',
      'data-quality',
      'integrity-gate',
      'trust-contract',
      'archived-cleanup',
    ]);
    expect(stages.find((stage) => stage.name === 'eponymous-fra-merge')?.args).toEqual(
      expect.arrayContaining([
        'research-entity:merge-eponymous-fra',
        '--apply',
        '--confirm-auto-merge-eponymous-fra',
        '--since',
        '2026-08-26T00:00:00.000Z',
        '--max-merges',
        '20',
      ]),
    );
  });

  it('omits the eponymous FRA merge stage when enabled without a since window', () => {
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep', {
      autoMergeEponymousFra: true,
    });
    expect(stages.map((stage) => stage.name)).not.toContain('eponymous-fra-merge');
  });

  it('omits the researcher dedupe stage by default (flag off)', () => {
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep');
    expect(stages.map((stage) => stage.name)).not.toContain('researcher-dedupe');
  });

  it('inserts the researcher dedupe stage before the eponymous FRA merge when enabled', () => {
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep', {
      dedupeResearchers: true,
      autoMergeEponymousFra: true,
      sinceIso: '2026-08-26T00:00:00.000Z',
      maxMerges: 20,
    });
    const names = stages.map((stage) => stage.name);
    expect(names).toEqual([
      'faculty-projection',
      'researcher-dedupe',
      'eponymous-fra-merge',
      'visibility-gate',
      'search-rebuild',
      'coverage-audit',
      'data-quality',
      'integrity-gate',
      'trust-contract',
      'archived-cleanup',
    ]);
    expect(names.indexOf('researcher-dedupe')).toBeLessThan(names.indexOf('eponymous-fra-merge'));
    expect(stages.find((stage) => stage.name === 'researcher-dedupe')?.args).toEqual(
      expect.arrayContaining([
        'researchers:dedupe-accountless-shells',
        '--apply',
        '--confirm-dedupe-accountless-researcher-shells',
      ]),
    );
  });

  it('runs the researcher dedupe stage even when the eponymous merge is off', () => {
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep', {
      dedupeResearchers: true,
    });
    const names = stages.map((stage) => stage.name);
    expect(names).toContain('researcher-dedupe');
    expect(names).not.toContain('eponymous-fra-merge');
    expect(names.indexOf('researcher-dedupe')).toBe(1);
  });

  const sinceIso = '2026-08-26T00:00:00.000Z';

  it.each(['development-full', 'development-incremental'] as const)(
    'defaults every dedup stage on for the %s sweep with no env set',
    (mode) => {
      const options = resolveDevelopmentPostRunOptions(mode, {}, sinceIso);
      expect(options).toMatchObject({
        autoMergeEponymousFra: true,
        dedupeResearchers: true,
        deleteMergeResidue: true,
        sinceIso,
      });
      const stages = buildDevelopmentPostRunStages('/tmp/development-sweep', options);
      const names = stages.map((stage) => stage.name);
      expect(names).toContain('researcher-dedupe');
      expect(names).toContain('eponymous-fra-merge');
      expect(names.indexOf('researcher-dedupe')).toBeLessThan(
        names.indexOf('eponymous-fra-merge'),
      );
      expect(stages.find((stage) => stage.name === 'archived-cleanup')?.args).toEqual(
        expect.arrayContaining([
          'research-entity:cleanup-archived',
          '--merge-residue-only',
          '--apply',
          '--confirm-archived-entity-cleanup',
          '--max-apply=5000',
        ]),
      );
    },
  );

  it('disables only the researcher dedupe stage when its env var is explicitly false', () => {
    const options = resolveDevelopmentPostRunOptions(
      'development-full',
      { SCRAPER_SWEEP_DEDUPE_RESEARCHERS: '0' },
      sinceIso,
    );
    expect(options).toMatchObject({
      autoMergeEponymousFra: true,
      dedupeResearchers: false,
      deleteMergeResidue: true,
    });
    const names = buildDevelopmentPostRunStages('/tmp/development-sweep', options).map(
      (stage) => stage.name,
    );
    expect(names).not.toContain('researcher-dedupe');
    expect(names).toContain('eponymous-fra-merge');
  });

  it('disables only the eponymous FRA merge stage when its env var is explicitly false', () => {
    const options = resolveDevelopmentPostRunOptions(
      'development-incremental',
      { SCRAPER_SWEEP_AUTO_MERGE_FRA: 'false' },
      sinceIso,
    );
    expect(options).toMatchObject({
      autoMergeEponymousFra: false,
      dedupeResearchers: true,
      deleteMergeResidue: true,
    });
    const names = buildDevelopmentPostRunStages('/tmp/development-sweep', options).map(
      (stage) => stage.name,
    );
    expect(names).not.toContain('eponymous-fra-merge');
    expect(names).toContain('researcher-dedupe');
  });

  it('keeps the archived-cleanup stage report-only when merge-residue deletion is disabled', () => {
    const options = resolveDevelopmentPostRunOptions(
      'development-full',
      { SCRAPER_SWEEP_DELETE_MERGE_RESIDUE: '0' },
      sinceIso,
    );
    expect(options?.deleteMergeResidue).toBe(false);
    const cleanupArgs = buildDevelopmentPostRunStages('/tmp/development-sweep', options).find(
      (stage) => stage.name === 'archived-cleanup',
    )?.args;
    expect(cleanupArgs).not.toContain('--apply');
    expect(cleanupArgs).not.toContain('--confirm-archived-entity-cleanup');
  });

  it.each(['off', 'no', 'disabled'] as const)(
    'keeps the archived-cleanup stage report-only when merge-residue deletion is %s',
    (disableValue) => {
      const options = resolveDevelopmentPostRunOptions(
        'development-full',
        { SCRAPER_SWEEP_DELETE_MERGE_RESIDUE: disableValue },
        sinceIso,
      );
      expect(options?.deleteMergeResidue).toBe(false);
      const cleanupArgs = buildDevelopmentPostRunStages('/tmp/development-sweep', options).find(
        (stage) => stage.name === 'archived-cleanup',
      )?.args;
      expect(cleanupArgs).not.toContain('--apply');
      expect(cleanupArgs).not.toContain('--confirm-archived-entity-cleanup');
    },
  );

  it.each(['beta-plan', 'beta-fetch', 'development-plan', 'development-sample'] as const)(
    'produces no post-run stage options for the %s mode',
    (mode) => {
      expect(resolveDevelopmentPostRunOptions(mode, {}, sinceIso)).toBeUndefined();
    },
  );

  it('requires an exact Development database and local unprefixed Meilisearch for writes', () => {
    expect(() =>
      validateScraperSweepEnvironment('development-full', {
        SCRAPER_ENV: 'development',
        MONGODBURL: 'mongodb+srv://example.invalid/Development',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
        MEILISEARCH_HOST: 'http://127.0.0.1:7700',
      }),
    ).not.toThrow();
    expect(() =>
      validateScraperSweepEnvironment('development-full', {
        SCRAPER_ENV: 'development',
        MONGODBURL: 'mongodb+srv://example.invalid/Beta',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
        MEILISEARCH_HOST: 'http://127.0.0.1:7700',
      }),
    ).toThrow(/Development/);
    expect(() =>
      validateScraperSweepEnvironment('development-full', {
        SCRAPER_ENV: 'development',
        MONGODBURL: 'mongodb+srv://example.invalid/Development',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
        MEILISEARCH_HOST: 'https://search.example.test',
      }),
    ).toThrow(/non-local/);
  });

  it('requires Beta writes and never accepts a Production target', () => {
    expect(() =>
      validateScraperSweepEnvironment('beta-fetch', {
        SCRAPER_ENV: 'beta',
        MONGODBURL: 'mongodb+srv://example.invalid/Beta',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
      }),
    ).not.toThrow();
    expect(() =>
      validateScraperSweepEnvironment('beta-fetch', {
        SCRAPER_ENV: 'production',
        MONGODBURL: 'mongodb+srv://example.invalid/Production',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
      }),
    ).toThrow(/SCRAPER_ENV=beta/);
  });

  it('derives the post-run plan from the stage registry in a single source of truth', () => {
    const registryNames = DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS.map(
      (definition) => definition.name,
    );
    const alwaysOnNames = DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS.filter((definition) =>
      definition.isEnabled({}),
    ).map((definition) => definition.name);
    expect(
      buildDevelopmentPostRunStages('/tmp/development-sweep').map((stage) => stage.name),
    ).toEqual(alwaysOnNames);
    expect(registryNames).toContain('visibility-gate');
    expect(new Set(DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS.map((d) => d.artifactName)).size).toBe(
      registryNames.length,
    );
    const withOptional = buildDevelopmentPostRunStages('/tmp/development-sweep', {
      dedupeResearchers: true,
      autoMergeEponymousFra: true,
      sinceIso: '2026-08-26T00:00:00.000Z',
    }).map((stage) => stage.name);
    expect(withOptional).toEqual(registryNames);
  });

  it('extracts the eponymous merge delta and fails loud when it is absent', () => {
    expect(parseEponymousFraMergeResult({ mergeDelta: { merged: 3 } })).toEqual({
      mergeDelta: { merged: 3 },
    });
    expect(() => parseEponymousFraMergeResult({})).toThrow(/missing a mergeDelta/);
    expect(() => parseEponymousFraMergeResult(null)).toThrow(/missing a mergeDelta/);
  });

  it('extracts the researcher dedupe delta and fails loud when byReason is absent', () => {
    const delta = parseResearcherDedupeResult({
      byReason: { same_name_account: 2 },
      shellsMerged: 2,
      roleAssignmentsRepointed: 4,
      roleAssignmentsArchivedRedundant: 1,
      attributeUnion: { profileLinksAppended: 5 },
    });
    expect(delta.researcherDedupeDelta).toMatchObject({
      shellsMerged: 2,
      roleAssignmentsRepointed: 4,
      roleAssignmentsArchivedRedundant: 1,
      profileLinksAppended: 5,
    });
    expect(() => parseResearcherDedupeResult({})).toThrow(/missing byReason/);
  });

  it('reads a stage result artifact and fails loud on a missing or invalid file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-sweep-result-'));
    const goodPath = path.join(directory, 'good.json');
    fs.writeFileSync(goodPath, JSON.stringify({ mergeDelta: { merged: 1 } }));
    expect(parseDevelopmentPostRunStageResult(goodPath, parseEponymousFraMergeResult)).toEqual({
      mergeDelta: { merged: 1 },
    });
    expect(() =>
      parseDevelopmentPostRunStageResult(
        path.join(directory, 'missing.json'),
        parseEponymousFraMergeResult,
      ),
    ).toThrow(/was not written/);
    const badPath = path.join(directory, 'bad.json');
    fs.writeFileSync(badPath, 'not json');
    expect(() => parseDevelopmentPostRunStageResult(badPath, parseEponymousFraMergeResult)).toThrow(
      /not valid JSON/,
    );
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
