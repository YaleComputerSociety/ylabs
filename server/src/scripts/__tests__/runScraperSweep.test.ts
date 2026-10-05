import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { parseArgs, parseScraperOptions } from '../../scrapers/cliHelpers';
import { buildOrchestrator } from '../../scrapers/registry';
import { brokerSocketPath } from '../../scrapers/utils/hostSlotBroker';
import { ACTIVE_SOURCE_NAMES } from '../../scrapers/seedSources';
import {
  sourcesThatProducedNothing,
  sweepThrottleRetrySummary,
  DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS,
  FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS,
  FELLOWSHIP_SWEEP_SOURCES,
  MANUAL_ONLY_SWEEP_SOURCES,
  RESEARCH_SWEEP_SOURCES,
  buildDevelopmentPostRunStages,
  sweepSearchIndexOutcome,
  buildFellowshipPostRunStages,
  buildPruneDeadObservationsChildArgs,
  buildScraperSweepChildArgs,
  declareMaterializationReadScopeForChildren,
  fellowshipPostRunArtifactError,
  isDeadObservationPruneSweepMode,
  isSweepPreflightEnabled,
  isSweepPageReuseEnabled,
  formatSweepPageReuseSummary,
  startSweepHostSlotBroker,
  sweepPageReuseSummary,
  orderedScraperSweepPhases,
  parseDevelopmentPostRunStageResult,
  parseEponymousFraMergeResult,
  parseGrantShellPortResult,
  parseInferredPiLeadReclaimResult,
  parseResearcherDedupeResult,
  parseUrlIdentityDedupeResult,
  parseProfileLinkHealthResult,
  parseStaleScrapeRunReapResult,
  partialProfileLinkHealthDelta,
  parseScraperSweepArgs,
  resolveDevelopmentPostRunOptions,
  resolveFellowshipPostRunOptions,
  resolvePhaseConcurrency,
  resolveSweepChildPerHostConcurrency,
  resolveSweepHostSlotBudget,
  runWithBoundedConcurrency,
  scraperSweepArtifactError,
  scraperSweepModes,
  sweepSourcesForMode,
  validateScraperSweepEnvironment,
  validateScraperSweepManifest,
  validateScraperSweepSourceRows,
  assertSweepSourceOrdering,
  runScraperSweep,
  sweepSourceOrderingViolations,
  type ScraperSweepSource,
} from '../runScraperSweep';
import { SOURCE_LINK_HEALTH_REPROBE_HEALTHY_AFTER_DAYS } from '../backfillSourceLinkHealthCore';

describe('runScraperSweep', () => {
  it('gives the sweep one per-host budget that an operator override can only tighten', () => {
    expect(resolveSweepHostSlotBudget({})).toBe(4);
    expect(resolveSweepHostSlotBudget({ SCRAPER_PER_HOST_CONCURRENCY: '2' })).toBe(2);
    expect(resolveSweepHostSlotBudget({ SCRAPER_PER_HOST_CONCURRENCY: '16' })).toBe(4);
    expect(resolveSweepHostSlotBudget({ SCRAPER_PER_HOST_CONCURRENCY: 'zero' })).toBe(4);
  });

  it('partitions every registered scraper across the two engines minus the manual-only source', () => {
    const registeredNames = buildOrchestrator()
      .list()
      .map((source) => source.name);
    expect(() => validateScraperSweepManifest(registeredNames)).not.toThrow();
    const researchNames = RESEARCH_SWEEP_SOURCES.map((source) => source.name);
    const fellowshipNames = FELLOWSHIP_SWEEP_SOURCES.map((source) => source.name);
    const union = new Set([...researchNames, ...fellowshipNames]);
    expect(union.size).toBe(researchNames.length + fellowshipNames.length);
    const expected = registeredNames.filter((name) => !MANUAL_ONLY_SWEEP_SOURCES.includes(name));
    expect([...union].sort()).toEqual([...expected].sort());
    expect(MANUAL_ONLY_SWEEP_SOURCES).toContain('undergrad-fellowships-recipients');
    expect(union.has('undergrad-fellowships-recipients')).toBe(false);
  });

  it('keeps every manual-only lane registered and seeded', () => {
    const registeredNames = buildOrchestrator()
      .list()
      .map((source) => source.name);
    for (const name of MANUAL_ONLY_SWEEP_SOURCES) {
      expect(registeredNames).toContain(name);
      expect(ACTIVE_SOURCE_NAMES).toContain(name);
    }
  });

  it('keeps the undergrad posting lane registered and seeded but out of the sweep', () => {
    const registeredNames = buildOrchestrator()
      .list()
      .map((source) => source.name);
    expect(MANUAL_ONLY_SWEEP_SOURCES).toContain('undergrad-research-posting');
    expect(RESEARCH_SWEEP_SOURCES.map((source) => source.name)).not.toContain(
      'undergrad-research-posting',
    );
    expect(registeredNames).toContain('undergrad-research-posting');
    expect(ACTIVE_SOURCE_NAMES).toContain('undergrad-research-posting');
  });

  it('refuses the undergrad posting lane put back into the sweep manifest', () => {
    const registeredNames = buildOrchestrator()
      .list()
      .map((source) => source.name);
    RESEARCH_SWEEP_SOURCES.push({ name: 'undergrad-research-posting', phase: 'content-access' });
    try {
      expect(() => validateScraperSweepManifest(registeredNames)).toThrow(
        /manual-only sources must stay out of the sweep manifest: undergrad-research-posting/,
      );
    } finally {
      RESEARCH_SWEEP_SOURCES.pop();
    }
  });

  it('keeps the undergrad microsite LLM lane registered and seeded but out of the sweep', () => {
    const registeredNames = buildOrchestrator()
      .list()
      .map((source) => source.name);
    expect(MANUAL_ONLY_SWEEP_SOURCES).toContain('lab-microsite-undergrad-llm');
    expect(RESEARCH_SWEEP_SOURCES.map((source) => source.name)).not.toContain(
      'lab-microsite-undergrad-llm',
    );
    expect(registeredNames).toContain('lab-microsite-undergrad-llm');
    expect(ACTIVE_SOURCE_NAMES).toContain('lab-microsite-undergrad-llm');
  });

  it('refuses the undergrad microsite LLM lane put back into the sweep manifest', () => {
    const registeredNames = buildOrchestrator()
      .list()
      .map((source) => source.name);
    RESEARCH_SWEEP_SOURCES.push({ name: 'lab-microsite-undergrad-llm', phase: 'content-access' });
    try {
      expect(() => validateScraperSweepManifest(registeredNames)).toThrow(
        /manual-only sources must stay out of the sweep manifest: lab-microsite-undergrad-llm/,
      );
    } finally {
      RESEARCH_SWEEP_SOURCES.pop();
    }
  });

  it('never hands a manual-only source to the development-full preflight canary', () => {
    const preflightCandidates = sweepSourcesForMode('development-full').map(
      (source) => source.name,
    );
    for (const name of MANUAL_ONLY_SWEEP_SOURCES) {
      expect(preflightCandidates).not.toContain(name);
    }
  });

  it('refuses a manual-only source that is no longer registered', () => {
    const registeredNames = buildOrchestrator()
      .list()
      .map((source) => source.name)
      .filter((name) => name !== 'undergrad-research-posting');
    expect(() => validateScraperSweepManifest(registeredNames)).toThrow(
      /manual-only sources that are not registered: undergrad-research-posting/,
    );
  });

  it('refuses a manual-only source that is put back into the sweep manifest', () => {
    const registeredNames = buildOrchestrator()
      .list()
      .map((source) => source.name);
    RESEARCH_SWEEP_SOURCES.push({ name: 'undergrad-research-posting', phase: 'content-access' });
    try {
      expect(() => validateScraperSweepManifest(registeredNames)).toThrow(
        /manual-only sources must stay out of the sweep manifest: undergrad-research-posting/,
      );
    } finally {
      RESEARCH_SWEEP_SOURCES.pop();
    }
  });

  it('keeps the fellowship catalog sources in the fellowship engine', () => {
    expect(FELLOWSHIP_SWEEP_SOURCES.map((source) => source.name).sort()).toEqual(
      [
        'program-official-page',
        'student-grants-database',
        'yale-college-fellowships-office',
        'yale-health-sciences-summer-programs',
        'yale-reu-programs',
      ].sort(),
    );
  });

  it('keeps the dual-writing department-undergrad-research source in the research engine', () => {
    expect(RESEARCH_SWEEP_SOURCES.map((source) => source.name)).toContain(
      'department-undergrad-research',
    );
    expect(FELLOWSHIP_SWEEP_SOURCES.map((source) => source.name)).not.toContain(
      'department-undergrad-research',
    );
  });

  it('selects the engine sources by mode', () => {
    expect(sweepSourcesForMode('development-full')).toBe(RESEARCH_SWEEP_SOURCES);
    expect(sweepSourcesForMode('development-incremental')).toBe(RESEARCH_SWEEP_SOURCES);
    expect(sweepSourcesForMode('fellowship-development-full')).toBe(FELLOWSHIP_SWEEP_SOURCES);
  });

  it('blocks a sweep manifest that omits a registered scraper', () => {
    expect(() => validateScraperSweepManifest(['yale-directory', 'future-source'])).toThrow(
      /missing from both sweep engines|unknown sweep sources/,
    );
  });

  it('fails before the sweep when a registered source metadata row is missing', () => {
    expect(() =>
      validateScraperSweepSourceRows(['yale-directory', 'center-director-llm'], ['yale-directory']),
    ).toThrow(/center-director-llm.*source metadata seed/i);
  });

  it('runs the preflight by default only on development-full, with an opt-out flag', () => {
    const full = parseScraperSweepArgs([
      '--mode=development-full',
      '--confirm-development-full-sweep',
    ]);
    expect(isSweepPreflightEnabled(full)).toBe(true);
    const skipped = parseScraperSweepArgs([
      '--mode=development-full',
      '--confirm-development-full-sweep',
      '--skip-preflight',
    ]);
    expect(skipped.skipPreflight).toBe(true);
    expect(isSweepPreflightEnabled(skipped)).toBe(false);
    expect(
      isSweepPreflightEnabled(
        parseScraperSweepArgs([
          '--mode=development-incremental',
          '--confirm-development-incremental-sweep',
        ]),
      ),
    ).toBe(false);
    expect(isSweepPreflightEnabled(parseScraperSweepArgs(['--mode=development-plan']))).toBe(false);
  });

  it('reuses pages within a sweep by default only in the exhaustive Development write modes', () => {
    const enabled = (argv: string[]) => isSweepPageReuseEnabled(parseScraperSweepArgs(argv));
    expect(enabled(['--mode=development-full', '--confirm-development-full-sweep'])).toBe(true);
    expect(
      enabled(['--mode=development-incremental', '--confirm-development-incremental-sweep']),
    ).toBe(true);
    expect(enabled(['--mode=fellowship-development-full', '--confirm-fellowship-sweep'])).toBe(
      true,
    );
    expect(enabled(['--mode=development-plan'])).toBe(false);
    expect(enabled(['--mode=development-sample'])).toBe(false);
    const disabled = parseScraperSweepArgs([
      '--mode=development-full',
      '--confirm-development-full-sweep',
      '--no-page-reuse',
    ]);
    expect(disabled.noPageReuse).toBe(true);
    expect(isSweepPageReuseEnabled(disabled)).toBe(false);
  });

  it('holds the page store in the broker only when the sweep enables reuse', async () => {
    const socketPath = (label: string) =>
      brokerSocketPath(`ylabs-sweep-reuse-${label}-${process.pid}.sock`);
    const withPages = await startSweepHostSlotBroker(
      { SCRAPER_SWEEP_PAGE_REUSE_MAX_MB: '16' },
      socketPath('on'),
      { pageReuse: true },
    );
    const withoutPages = await startSweepHostSlotBroker({}, socketPath('off'));
    try {
      const summary = sweepPageReuseSummary(withPages);
      expect(summary).toMatchObject({
        hosts: ['medicine.yale.edu', 'ysph.yale.edu'],
        maxBytes: 16 * 1024 * 1024,
        heldBytes: 0,
      });
      expect(formatSweepPageReuseSummary(summary)).toBe(
        'Page reuse within this sweep: 0 of 0 lookups served from a page fetched earlier in the sweep; 0 stored, 0 evicted, peak 0 MiB of 16 MiB',
      );
      expect(sweepPageReuseSummary(withoutPages)).toBeUndefined();
      expect(formatSweepPageReuseSummary(undefined)).toBe('Page reuse within this sweep: off');
    } finally {
      await withPages.close();
      await withoutPages.close();
    }
  });

  it('requires explicit confirmation for the full Development sweep', () => {
    expect(() => parseScraperSweepArgs(['--mode=development-full'])).toThrow(
      /confirm-development-full-sweep/,
    );
    expect(
      parseScraperSweepArgs(['--mode=development-full', '--confirm-development-full-sweep']).mode,
    ).toBe('development-full');
  });

  it('offers only Development sweep modes, because Beta and Production are filled by promotion', () => {
    expect(scraperSweepModes().sort()).toEqual([
      'development-full',
      'development-incremental',
      'development-plan',
      'development-sample',
      'fellowship-development-full',
    ]);
    for (const retired of ['beta-plan', 'beta-fetch']) {
      expect(() => parseScraperSweepArgs([`--mode=${retired}`])).toThrow(
        `Unknown scraper sweep mode: ${retired}`,
      );
    }
    expect(() =>
      parseScraperSweepArgs(['--mode=development-plan', '--confirm-beta-release-candidate']),
    ).toThrow('Unknown scraper sweep argument: --confirm-beta-release-candidate');
  });

  it('requires explicit confirmation for the fellowship Development sweep', () => {
    expect(() => parseScraperSweepArgs(['--mode=fellowship-development-full'])).toThrow(
      /confirm-fellowship-sweep/,
    );
    expect(
      parseScraperSweepArgs(['--mode=fellowship-development-full', '--confirm-fellowship-sweep'])
        .mode,
    ).toBe('fellowship-development-full');
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
      'discovery-readers',
      'funding',
      'relationships',
      'content-access',
    ]);
  });

  it.each([
    ['bbs-research-track', 'ysm-faculty-directory'],
    ['department-research-areas', 'dept-faculty-roster'],
    ['directory-alias-resolution', 'dept-faculty-roster'],
  ])('starts %s only after the phase that runs %s has finished', (reader, producer) => {
    const phases = orderedScraperSweepPhases(RESEARCH_SWEEP_SOURCES);
    const phaseOf = (name: string) => {
      const source = RESEARCH_SWEEP_SOURCES.find((candidate) => candidate.name === name);
      expect(source).toBeDefined();
      return phases.indexOf(source!.phase);
    };
    expect(phaseOf(reader)).toBeGreaterThan(phaseOf(producer));
    expect(
      RESEARCH_SWEEP_SOURCES.find((source) => source.name === reader)?.readsRowsWrittenBy,
    ).toContain(producer);
  });

  it('declares no reader that could start before its producer is terminal', () => {
    expect(sweepSourceOrderingViolations(RESEARCH_SWEEP_SOURCES)).toEqual([]);
    expect(sweepSourceOrderingViolations(FELLOWSHIP_SWEEP_SOURCES)).toEqual([]);
  });

  it('flags a reader that shares a phase with its producer or names a producer the sweep lacks', () => {
    const sources: ScraperSweepSource[] = [
      { name: 'producer', phase: 'discovery' },
      { name: 'same-phase-reader', phase: 'discovery', readsRowsWrittenBy: ['producer'] },
      { name: 'later-reader', phase: 'funding', readsRowsWrittenBy: ['producer'] },
      { name: 'orphan-reader', phase: 'funding', readsRowsWrittenBy: ['absent-producer'] },
    ];
    expect(sweepSourceOrderingViolations(sources)).toEqual([
      {
        reader: 'same-phase-reader',
        producer: 'producer',
        reason: 'producer-not-in-an-earlier-phase',
      },
      { reader: 'orphan-reader', producer: 'absent-producer', reason: 'producer-not-in-sweep' },
    ]);
    expect(() => assertSweepSourceOrdering(sources)).toThrow(/same-phase-reader reads producer/);
  });

  it('refuses to start a sweep whose manifest lets a reader run beside its producer', async () => {
    const childRunner = vi.fn();
    await expect(
      runScraperSweep(
        { mode: 'development-plan', confirmations: new Set() },
        {
          childRunner,
          sweepSources: [
            { name: 'producer', phase: 'discovery' },
            { name: 'reader', phase: 'discovery', readsRowsWrittenBy: ['producer'] },
          ],
        },
      ),
    ).rejects.toThrow(/reader reads producer/);
    expect(childRunner).not.toHaveBeenCalled();
  });

  it('caps LLM phases, honors an override, and never drops below one', () => {
    expect(resolvePhaseConcurrency('development-full', 'discovery')).toBe(8);
    expect(resolvePhaseConcurrency('development-full', 'discovery', 12)).toBe(12);
    expect(resolvePhaseConcurrency('development-full', 'content-access', 8)).toBe(2);
    expect(resolvePhaseConcurrency('development-full', 'relationships', 8)).toBe(2);
    expect(resolvePhaseConcurrency('development-full', 'discovery', 1)).toBe(1);
  });

  it('shrinks the child per-host cap as cross-source concurrency rises so shared hosts stay bounded', () => {
    expect(resolveSweepChildPerHostConcurrency(1, {})).toBe(4);
    expect(resolveSweepChildPerHostConcurrency(2, {})).toBe(2);
    expect(resolveSweepChildPerHostConcurrency(4, {})).toBe(1);
    expect(resolveSweepChildPerHostConcurrency(8, {})).toBe(1);
    for (const concurrency of [1, 2, 4, 8, 12]) {
      const cap = resolveSweepChildPerHostConcurrency(concurrency, {});
      expect(cap * concurrency).toBeLessThanOrEqual(Math.max(4, concurrency));
      expect(cap).toBeGreaterThanOrEqual(1);
    }
  });

  it('never lets an operator override loosen the per-host bound', () => {
    expect(resolveSweepChildPerHostConcurrency(1, { SCRAPER_PER_HOST_CONCURRENCY: '2' })).toBe(2);
    expect(resolveSweepChildPerHostConcurrency(8, { SCRAPER_PER_HOST_CONCURRENCY: '16' })).toBe(1);
    expect(resolveSweepChildPerHostConcurrency(2, { SCRAPER_PER_HOST_CONCURRENCY: 'x' })).toBe(2);
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
    const developmentArgs = buildScraperSweepChildArgs(
      'development-full',
      'yale-directory',
      '/tmp/yale-directory.json',
    );
    expect(developmentArgs).toContain('--exhaustive');
    expect(developmentArgs).not.toContain('--limit');
    expect(developmentArgs).toContain('--auto-materialize');
    expect(developmentArgs).not.toContain('--use-cache');
    expect(developmentArgs).toContain('--ignore-work-planner');

    const incrementalArgs = buildScraperSweepChildArgs(
      'development-incremental',
      'yale-directory',
      '/tmp/yale-directory.json',
    );
    expect(incrementalArgs).toContain('--exhaustive');
    expect(incrementalArgs).not.toContain('--use-cache');
    expect(incrementalArgs).toContain('--auto-materialize');
    expect(incrementalArgs).not.toContain('--ignore-work-planner');
    expect(incrementalArgs).not.toContain('--limit');
  });

  it('never lets an exhaustive mode write the fetch cache, and caches only bounded modes', () => {
    const argsByMode = scraperSweepModes().map((mode) => ({
      mode,
      args: buildScraperSweepChildArgs(mode, 'yale-directory', '/tmp/yale-directory.json'),
    }));
    const exhaustiveModes = argsByMode.filter(({ args }) => args.includes('--exhaustive'));
    const cachingModes = argsByMode.filter(({ args }) => args.includes('--use-cache'));

    expect(exhaustiveModes.map(({ mode }) => mode).sort()).toEqual([
      'development-full',
      'development-incremental',
      'fellowship-development-full',
    ]);
    for (const { mode, args } of exhaustiveModes) {
      expect({ mode, usesCache: args.includes('--use-cache') }).toEqual({
        mode,
        usesCache: false,
      });
    }
    for (const { mode, args } of cachingModes) {
      expect({ mode, bounded: args.includes('--limit') }).toEqual({ mode, bounded: true });
    }
    expect(cachingModes.map(({ mode }) => mode).sort()).toEqual([
      'development-plan',
      'development-sample',
    ]);
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
      scraperSweepArtifactError('development-plan', {
        runId: 'run-2',
        runStatus: 'success',
        materializationErrors: 3,
      }),
    ).toBeUndefined();
    expect(
      scraperSweepArtifactError('development-full', {
        runStatus: 'success',
      }),
    ).toMatch(/missing run.id/);
  });

  it('declares only post-run stage commands that exist as server npm scripts', () => {
    const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
    const declaredScripts = new Set(
      Object.keys(
        (
          JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
            scripts?: Record<string, string>;
          }
        ).scripts ?? {},
      ),
    );
    const stageCommands = [
      ...DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS,
      ...FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS,
    ].map((definition) => ({ name: definition.name, command: definition.command }));

    expect(stageCommands.length).toBeGreaterThan(0);
    expect(stageCommands.filter((stage) => !declaredScripts.has(stage.command))).toEqual([]);
  });

  it('builds the complete Development post-run quality pipeline', () => {
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep');
    expect(stages.map((stage) => stage.name)).toEqual([
      'source-link-health',
      'profile-link-health',
      'dead-research-website-clear',
      'organization-identity-website-retire',
      'shared-roster-website-retire',
      'refusal-lane-attribution',
      'pi-attributed-researcher-mint',
      'inferred-pi-lead-reclaim',
      'profile-honors',
      'visibility-gate',
      'search-rebuild',
      'search-index-check',
      'lane-scorecard',
      'engine-benchmark',
      'coverage-audit',
      'data-quality',
      'integrity-gate',
      'trust-contract',
      'archived-cleanup',
    ]);
    // The gate reads sourceLinkHealth to decide whether a cited link still counts
    // as a way in, so probing after it would leave every decision a cycle stale.
    expect(stages.findIndex((stage) => stage.name === 'source-link-health')).toBeLessThan(
      stages.findIndex((stage) => stage.name === 'visibility-gate'),
    );
    expect(stages.find((stage) => stage.name === 'source-link-health')?.args).toEqual(
      expect.arrayContaining([
        'research-homes:backfill-source-link-health',
        '--apply',
        '--confirm-source-link-health',
        '--limit=10000',
      ]),
    );
    // The sibling lane, for the other half of the served surface: a lead's
    // YALE_OFFICIAL profile link has its own health record, and nothing re-probed
    // it, so 3 served rows linked students to a profile that 404s (#3222). The
    // limit must exceed the whole population rather than sample it, since a
    // truncating limit leaves the same links unverified every run.
    expect(stages.find((stage) => stage.name === 'profile-link-health')?.args).toEqual(
      expect.arrayContaining([
        'researchers:verify-official-profile-links',
        '--apply',
        '--confirm-profile-link-verification',
        '--limit=10000',
        // Without a staleness window the candidate list is the head of a stable read
        // order, so a run that dies partway re-probes the same links next sweep and
        // never reaches the tail (#3222).
        '--stale-after-days=30',
      ]),
    );
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
    expect(stages.find((stage) => stage.name === 'data-quality')?.args).toEqual(
      expect.arrayContaining(['--strict', '--include-samples', '--progress']),
    );
    expect(stages.find((stage) => stage.name === 'trust-contract')?.args).toEqual(
      expect.arrayContaining(['--collection=all', '--mode=student-ready-only', '--strict']),
    );
  });

  it('re-probes only due link-health verdicts unless a full re-probe is asked for', () => {
    const argsOf = (stages: ReturnType<typeof buildDevelopmentPostRunStages>) =>
      stages.find((stage) => stage.name === 'source-link-health')?.args ?? [];

    expect(argsOf(buildDevelopmentPostRunStages('/tmp/development-sweep'))).toContain(
      `--reprobe-healthy-after-days=${SOURCE_LINK_HEALTH_REPROBE_HEALTHY_AFTER_DAYS}`,
    );
    const full = argsOf(
      buildDevelopmentPostRunStages('/tmp/development-sweep', { fullLinkHealthReprobe: true }),
    );
    expect(full.some((arg) => arg.startsWith('--reprobe-healthy-after-days'))).toBe(false);
    expect(full).toEqual(expect.arrayContaining(['--apply', '--limit=10000']));

    const parsed = parseScraperSweepArgs([
      '--mode=development-full',
      '--confirm-development-full-sweep',
      '--full-link-health-reprobe',
    ]);
    expect(parsed.fullLinkHealthReprobe).toBe(true);
    expect(
      parseScraperSweepArgs(['--mode=development-full', '--confirm-development-full-sweep'])
        .fullLinkHealthReprobe,
    ).toBeUndefined();
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

  it('ports grant shells before the eponymous FRA merge, so a ported faculty row can still fold into a lab', () => {
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep', {
      portGrantShells: true,
      autoMergeEponymousFra: true,
      sinceIso: '2026-08-26T00:00:00.000Z',
    });
    const names = stages.map((stage) => stage.name);
    expect(names.indexOf('grant-shell-faculty-port')).toBeLessThan(
      names.indexOf('eponymous-fra-merge'),
    );
    expect(stages.find((stage) => stage.name === 'grant-shell-faculty-port')?.args).toEqual(
      expect.arrayContaining([
        'research-entity:port-grant-shells-to-faculty-profiles',
        '--apply',
        '--confirm-port-grant-shells-to-faculty-profiles',
      ]),
    );
    expect(
      buildDevelopmentPostRunStages('/tmp/development-sweep').map((s) => s.name),
    ).not.toContain('grant-shell-faculty-port');
  });

  it('holds the grant shell port to an apply-mode report', () => {
    expect(parseGrantShellPortResult({ mode: 'apply', portDelta: { appliedPorts: 3 } })).toEqual({
      grantShellPortDelta: { appliedPorts: 3 },
    });
    expect(() => parseGrantShellPortResult({ mode: 'dry-run', portDelta: {} })).toThrow();
    expect(() => parseGrantShellPortResult({ mode: 'apply' })).toThrow();
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
      'stale-scrape-run-reap',
      'eponymous-fra-merge',
      'source-link-health',
      'profile-link-health',
      'dead-research-website-clear',
      'organization-identity-website-retire',
      'shared-roster-website-retire',
      'refusal-lane-attribution',
      'pi-attributed-researcher-mint',
      'inferred-pi-lead-reclaim',
      'profile-honors',
      'visibility-gate',
      'search-rebuild',
      'search-index-check',
      'lane-scorecard',
      'engine-benchmark',
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
      'stale-scrape-run-reap',
      'researcher-dedupe',
      'eponymous-fra-merge',
      'source-link-health',
      'profile-link-health',
      'dead-research-website-clear',
      'organization-identity-website-retire',
      'shared-roster-website-retire',
      'refusal-lane-attribution',
      'pi-attributed-researcher-mint',
      'inferred-pi-lead-reclaim',
      'profile-honors',
      'visibility-gate',
      'search-rebuild',
      'search-index-check',
      'lane-scorecard',
      'engine-benchmark',
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
    expect(names.indexOf('researcher-dedupe')).toBeLessThan(names.indexOf('visibility-gate'));
  });

  const sinceIso = '2026-08-26T00:00:00.000Z';

  it.each(['development-full', 'development-incremental'] as const)(
    'defaults every dedup stage on for the %s sweep with no env set',
    (mode) => {
      const options = resolveDevelopmentPostRunOptions(mode, {}, sinceIso);
      expect(options).toMatchObject({
        autoMergeEponymousFra: true,
        dedupeResearchers: true,
        portGrantShells: true,
        mergeUrlIdentityDuplicates: true,
        deleteMergeResidue: true,
        sinceIso,
      });
      const stages = buildDevelopmentPostRunStages('/tmp/development-sweep', options);
      const names = stages.map((stage) => stage.name);
      expect(names).toContain('researcher-dedupe');
      expect(names).toContain('eponymous-fra-merge');
      expect(names).toContain('url-identity-dedupe');
      expect(names.indexOf('researcher-dedupe')).toBeLessThan(names.indexOf('eponymous-fra-merge'));
      expect(names.indexOf('eponymous-fra-merge')).toBeLessThan(
        names.indexOf('url-identity-dedupe'),
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

  it('disables only the grant shell port stage when its env var is explicitly false', () => {
    const options = resolveDevelopmentPostRunOptions(
      'development-full',
      { SCRAPER_SWEEP_PORT_GRANT_SHELLS: 'off' },
      sinceIso,
    );
    expect(options).toMatchObject({ portGrantShells: false, autoMergeEponymousFra: true });
    const names = buildDevelopmentPostRunStages('/tmp/development-sweep', options).map(
      (stage) => stage.name,
    );
    expect(names).not.toContain('grant-shell-faculty-port');
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

  it.each(['0', 'false', 'off'] as const)(
    'disables only the url-identity dedupe stage when its env var is %s',
    (disableValue) => {
      const options = resolveDevelopmentPostRunOptions(
        'development-full',
        { SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES: disableValue },
        sinceIso,
      );
      expect(options).toMatchObject({
        autoMergeEponymousFra: true,
        dedupeResearchers: true,
        mergeUrlIdentityDuplicates: false,
      });
      const names = buildDevelopmentPostRunStages('/tmp/development-sweep', options).map(
        (stage) => stage.name,
      );
      expect(names).not.toContain('url-identity-dedupe');
      expect(names).toContain('eponymous-fra-merge');
    },
  );

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

  it.each(['development-plan', 'development-sample', 'fellowship-development-full'] as const)(
    'produces no development post-run stage options for the %s mode',
    (mode) => {
      expect(resolveDevelopmentPostRunOptions(mode, {}, sinceIso)).toBeUndefined();
    },
  );

  it.each([
    'development-plan',
    'development-sample',
    'development-full',
    'development-incremental',
  ] as const)('produces no fellowship post-run stage options for the %s mode', (mode) => {
    expect(resolveFellowshipPostRunOptions(mode)).toBeUndefined();
  });

  it('builds the fellowship post-run pipeline wiring the existing programs scripts in order', () => {
    const stages = buildFellowshipPostRunStages('/tmp/fellowship-sweep');
    expect(stages.map((stage) => stage.name)).toEqual([
      'program-visibility-gate',
      'global-regions-backfill',
      'link-labels-backfill',
      'accepting-applications-invariant',
      'source-link-health',
      'research-relevance-audit',
      'freshness-audit',
    ]);
    expect(stages.every((stage) => stage.artifactPath?.startsWith('/tmp/fellowship-sweep/'))).toBe(
      true,
    );
    expect(stages.find((stage) => stage.name === 'program-visibility-gate')?.args).toEqual([
      '--cwd',
      'server',
      'student-visibility:gate',
      '--collection=programs',
      '--apply',
      '--confirm-student-visibility-apply',
      '--max-apply=10000',
      '--output=/tmp/fellowship-sweep/fellowship-program-visibility-gate.json',
    ]);
    expect(stages.find((stage) => stage.name === 'link-labels-backfill')?.args).toEqual([
      '--cwd',
      'server',
      'programs:backfill-link-labels',
      '--apply',
      '--confirm-program-link-label-backfill',
      '--output=/tmp/fellowship-sweep/fellowship-link-labels-backfill.json',
    ]);
    expect(stages.find((stage) => stage.name === 'research-relevance-audit')?.args).toEqual([
      '--cwd',
      'server',
      'programs:audit-research-relevance',
      '--output=/tmp/fellowship-sweep/fellowship-research-relevance-audit.json',
    ]);
  });

  it('runs no curated official-source replay, because a lane observes official pages instead', () => {
    expect(
      buildFellowshipPostRunStages(
        '/tmp/fellowship-sweep',
        resolveFellowshipPostRunOptions('fellowship-development-full'),
      ).map((stage) => stage.args.join(' ')),
    ).not.toEqual(expect.arrayContaining([expect.stringContaining('backfill-official-sources')]));
  });

  it('fails a fellowship stage whose declared report artifact is missing or malformed', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fellowship-report-contract-'));
    const missing = path.join(directory, 'missing.json');
    expect(fellowshipPostRunArtifactError(missing)).toMatch(/was not written/);
    const malformed = path.join(directory, 'malformed.json');
    fs.writeFileSync(malformed, 'not json');
    expect(fellowshipPostRunArtifactError(malformed)).toMatch(/not valid JSON/);
    const valid = path.join(directory, 'valid.json');
    fs.writeFileSync(valid, JSON.stringify({ scanned: 1 }));
    expect(fellowshipPostRunArtifactError(valid)).toBeUndefined();
  });

  it('derives the fellowship post-run plan from a single registry with unique artifacts', () => {
    const registryNames = FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS.map(
      (definition) => definition.name,
    );
    const alwaysOnNames = FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS.filter((definition) =>
      definition.isEnabled({}),
    ).map((definition) => definition.name);
    expect(
      buildFellowshipPostRunStages('/tmp/fellowship-sweep').map((stage) => stage.name),
    ).toEqual(alwaysOnNames);
    expect(new Set(FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS.map((d) => d.artifactName)).size).toBe(
      registryNames.length,
    );
    for (const definition of FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS) {
      expect(definition.buildArgs({}).some((arg) => arg.startsWith('--output'))).toBe(false);
    }
  });

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

  it('runs a sweep that defers its search index writes without any Meilisearch target', () => {
    const deferredEnv = {
      SCRAPER_ENV: 'development',
      MONGODBURL: 'mongodb+srv://example.invalid/Development',
      ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
      SEARCH_INDEX_WRITES: 'deferred',
    };
    expect(() => validateScraperSweepEnvironment('development-full', deferredEnv)).not.toThrow();
    expect(() =>
      validateScraperSweepEnvironment('development-full', {
        ...deferredEnv,
        SEARCH_INDEX_WRITES: undefined,
      }),
    ).toThrow(/local MEILISEARCH_HOST/);
    expect(sweepSearchIndexOutcome(deferredEnv)).toEqual({
      status: 'resync-required',
      remedy: 'yarn development:search:rebuild',
    });
    expect(sweepSearchIndexOutcome({})).toEqual({ status: 'written' });
  });

  it('checks the rebuilt index against Mongo, and skips both stages when writes are deferred', () => {
    const names = (stages: Array<{ name: string }>) => stages.map((stage) => stage.name);
    const writing = buildDevelopmentPostRunStages('/tmp/development-sweep');
    const rebuildAt = names(writing).indexOf('search-rebuild');
    expect(names(writing)[rebuildAt + 1]).toBe('search-index-check');
    expect(writing.find((stage) => stage.name === 'search-index-check')?.args).toEqual([
      '--cwd',
      'server',
      'journey:eval',
      '--case=sorted-browse-keeps-order,title-sorted-browse-follows-card-title',
      '--fail-on-inconclusive',
      '--output',
      '/tmp/development-sweep/development-search-index-check.json',
    ]);

    vi.stubEnv('SEARCH_INDEX_WRITES', 'deferred');
    try {
      const deferred = names(buildDevelopmentPostRunStages('/tmp/development-sweep'));
      expect(deferred).not.toContain('search-rebuild');
      expect(deferred).not.toContain('search-index-check');
      expect(deferred).toContain('visibility-gate');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('holds the fellowship sweep to the same Development guards as the research sweep', () => {
    expect(() =>
      validateScraperSweepEnvironment('fellowship-development-full', {
        SCRAPER_ENV: 'development',
        MONGODBURL: 'mongodb+srv://example.invalid/Development',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
        MEILISEARCH_HOST: 'http://127.0.0.1:7700',
      }),
    ).not.toThrow();
    expect(() =>
      validateScraperSweepEnvironment('fellowship-development-full', {
        SCRAPER_ENV: 'development',
        MONGODBURL: 'mongodb+srv://example.invalid/Development',
        MEILISEARCH_HOST: 'http://127.0.0.1:7700',
      }),
    ).toThrow(/ALLOW_NON_PROD_SCRAPER_WRITES/);
  });

  it.each([
    ['beta', 'Beta'],
    ['production', 'Production'],
  ])('refuses to sweep a %s target in every mode', (environment, database) => {
    for (const mode of scraperSweepModes()) {
      expect(() =>
        validateScraperSweepEnvironment(mode, {
          SCRAPER_ENV: environment,
          MONGODBURL: `mongodb+srv://example.invalid/${database}`,
          ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
          MEILISEARCH_HOST: 'http://127.0.0.1:7700',
        }),
      ).toThrow(/requires SCRAPER_ENV=development/);
    }
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
      portGrantShells: true,
      autoMergeEponymousFra: true,
      mergeUrlIdentityDuplicates: true,
      pruneDeadObservations: true,
      sinceIso: '2026-08-26T00:00:00.000Z',
    }).map((stage) => stage.name);
    expect(withOptional).toEqual(registryNames);
  });

  it('gates the url-identity dedupe stage behind its flag and runs it before search-rebuild', () => {
    expect(
      buildDevelopmentPostRunStages('/tmp/development-sweep').map((stage) => stage.name),
    ).not.toContain('url-identity-dedupe');
    const names = buildDevelopmentPostRunStages('/tmp/development-sweep', {
      mergeUrlIdentityDuplicates: true,
      maxUrlIdentityMerges: 300,
    }).map((stage) => stage.name);
    expect(names.indexOf('url-identity-dedupe')).toBeLessThan(names.indexOf('visibility-gate'));
    expect(names.indexOf('url-identity-dedupe')).toBeLessThan(names.indexOf('search-rebuild'));
    const stage = buildDevelopmentPostRunStages('/tmp/development-sweep', {
      mergeUrlIdentityDuplicates: true,
      maxUrlIdentityMerges: 300,
    }).find((entry) => entry.name === 'url-identity-dedupe');
    expect(stage?.args).toEqual(
      expect.arrayContaining([
        'research-entity:dedupe-by-pi',
        '--profile-lab-url-only',
        '--apply',
        '--confirm-research-entity-pi-dedupe',
        '--max-apply=300',
      ]),
    );
  });

  it('runs the website-url identity lane alongside the path-keyed one under the same flag', () => {
    expect(
      buildDevelopmentPostRunStages('/tmp/development-sweep').map((stage) => stage.name),
    ).not.toContain('website-url-identity-dedupe');
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep', {
      mergeUrlIdentityDuplicates: true,
      maxUrlIdentityMerges: 300,
    });
    const names = stages.map((stage) => stage.name);
    expect(names.indexOf('url-identity-dedupe')).toBeLessThan(
      names.indexOf('website-url-identity-dedupe'),
    );
    expect(names.indexOf('website-url-identity-dedupe')).toBeLessThan(
      names.indexOf('visibility-gate'),
    );
    expect(names.indexOf('website-url-identity-dedupe')).toBeLessThan(
      names.indexOf('search-rebuild'),
    );
    const stage = stages.find((entry) => entry.name === 'website-url-identity-dedupe');
    expect(stage?.args).toEqual(
      expect.arrayContaining([
        'research-entity:dedupe-by-pi',
        '--website-url-only',
        '--apply',
        '--confirm-research-entity-pi-dedupe',
        '--max-apply=300',
      ]),
    );
    expect(stage?.args).not.toContain('--profile-lab-url-only');
  });

  it('merges same-lead rows that agree on name and type under the URL-identity flag', () => {
    expect(
      buildDevelopmentPostRunStages('/tmp/development-sweep').map((stage) => stage.name),
    ).not.toContain('shared-person-name-agreed-dedupe');
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep', {
      mergeUrlIdentityDuplicates: true,
      maxUrlIdentityMerges: 300,
    });
    const names = stages.map((stage) => stage.name);
    expect(names.indexOf('website-url-identity-dedupe')).toBeLessThan(
      names.indexOf('shared-person-name-agreed-dedupe'),
    );
    expect(names.indexOf('shared-person-name-agreed-dedupe')).toBeLessThan(
      names.indexOf('visibility-gate'),
    );
    const stage = stages.find((entry) => entry.name === 'shared-person-name-agreed-dedupe');
    expect(stage?.args).toEqual(
      expect.arrayContaining([
        'research-entity:dedupe-by-pi',
        '--shared-person-id',
        '--require-name-agreement',
        '--apply',
        '--confirm-research-entity-pi-dedupe',
        '--max-apply=300',
      ]),
    );
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

  describe('stale-scrape-run-reap stage (#3595)', () => {
    const SWEEP_STARTED_AT = '2026-09-28T01:00:00.000Z';
    const reapReport = (overrides: Record<string, unknown> = {}) => ({
      mode: 'apply',
      heartbeatStaleOnly: true,
      startedBefore: SWEEP_STARTED_AT,
      running: 6,
      planned: 2,
      plannedByReason: { heartbeat_stale: 2 },
      keptByReason: { legacy_operator_only: 3, started_at_or_after_cutoff: 1 },
      closed: 2,
      changedSinceRead: 0,
      ...overrides,
    });

    it('runs first, scoped to heartbeat-stale runs that started before this sweep', () => {
      const stages = buildDevelopmentPostRunStages('/tmp/development-sweep', {
        sinceIso: SWEEP_STARTED_AT,
      });
      expect(stages[0]?.name).toBe('stale-scrape-run-reap');
      expect(stages[0]?.args).toEqual([
        '--cwd',
        'server',
        'scrape-runs:reconcile-stale',
        '--apply',
        '--confirm-reconcile-stale-scrape-runs',
        '--heartbeat-stale-only',
        '--started-before',
        SWEEP_STARTED_AT,
        '--output',
        '/tmp/development-sweep/development-stale-scrape-run-reap.json',
      ]);
    });

    it('is enabled only when the sweep knows when it started', () => {
      const definition = DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS.find(
        (entry) => entry.name === 'stale-scrape-run-reap',
      );
      expect(definition?.isEnabled({})).toBe(false);
      expect(definition?.isEnabled({ sinceIso: SWEEP_STARTED_AT })).toBe(true);
      expect(definition?.parseResult).toBe(parseStaleScrapeRunReapResult);
      expect(
        resolveDevelopmentPostRunOptions('development-incremental', {}, SWEEP_STARTED_AT)?.sinceIso,
      ).toBe(SWEEP_STARTED_AT);
    });

    it('reports its counts in the sweep summary', () => {
      expect(parseStaleScrapeRunReapResult(reapReport()).staleScrapeRunReapDelta).toEqual({
        running: 6,
        planned: 2,
        closed: 2,
        changedSinceRead: 0,
        keptByReason: { legacy_operator_only: 3, started_at_or_after_cutoff: 1 },
      });
    });

    it('fails its contract on a missing, dry-run, unscoped or legacy-reaping report', () => {
      expect(() => parseStaleScrapeRunReapResult(null)).toThrow(/not an apply report/);
      expect(() => parseStaleScrapeRunReapResult(reapReport({ mode: 'dry-run' }))).toThrow(
        /not an apply report/,
      );
      expect(() =>
        parseStaleScrapeRunReapResult(reapReport({ heartbeatStaleOnly: false })),
      ).toThrow(/not scoped/);
      expect(() => parseStaleScrapeRunReapResult(reapReport({ startedBefore: null }))).toThrow(
        /not scoped/,
      );
      expect(() =>
        parseStaleScrapeRunReapResult(
          reapReport({ plannedByReason: { heartbeat_stale: 1, legacy_abandoned: 1 } }),
        ),
      ).toThrow(/legacy_abandoned, which only an operator may close/);
      expect(() => parseStaleScrapeRunReapResult(reapReport({ closed: null }))).toThrow(
        /missing a numeric closed/,
      );
    });
  });

  it('makes every merge-applying development stage declare a result contract', () => {
    const mergeApplying = DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS.filter((definition) =>
      /dedupe|merge/.test(definition.command),
    );
    expect(mergeApplying.map((definition) => definition.name)).toEqual([
      'researcher-dedupe',
      'eponymous-fra-merge',
      'url-identity-dedupe',
      'website-url-identity-dedupe',
      'shared-person-name-agreed-dedupe',
    ]);
    expect(
      mergeApplying
        .filter((definition) => !definition.parseResult)
        .map((definition) => definition.name),
    ).toEqual([]);
  });

  it('reads the url-identity dedupe delta and fails loud when the stage reports nothing', () => {
    expect(
      parseUrlIdentityDedupeResult({
        urlIdentityDedupeDelta: {
          plannedGroups: 70,
          appliedGroups: 68,
          archivedEntities: 74,
          deferredByCapGroups: 0,
        },
      }).urlIdentityDedupeDelta,
    ).toMatchObject({ plannedGroups: 70, appliedGroups: 68, archivedEntities: 74 });
    expect(() => parseUrlIdentityDedupeResult({})).toThrow(/missing a urlIdentityDedupeDelta/);
    expect(() => parseUrlIdentityDedupeResult(null)).toThrow(/missing a urlIdentityDedupeDelta/);
    expect(() =>
      parseUrlIdentityDedupeResult({
        urlIdentityDedupeDelta: { plannedGroups: 70, appliedGroups: 68 },
      }),
    ).toThrow(/missing a numeric archivedEntities/);
  });

  it('parses the resume, force-llm, and between-phases prune flags off by default', () => {
    const base = parseScraperSweepArgs([
      '--mode=development-full',
      '--confirm-development-full-sweep',
    ]);
    expect(base.restart).toBeUndefined();
    expect(base.forceLlm).toBeUndefined();
    expect(base.pruneBetweenPhases).toBeUndefined();
    const withFlags = parseScraperSweepArgs([
      '--mode=development-full',
      '--confirm-development-full-sweep',
      '--restart',
      '--force-llm',
      '--prune-between-phases',
    ]);
    expect(withFlags.restart).toBe(true);
    expect(withFlags.forceLlm).toBe(true);
    expect(withFlags.pruneBetweenPhases).toBe(true);
  });

  it('threads --force-llm into the per-source child args only when set', () => {
    expect(
      buildScraperSweepChildArgs('development-full', 'yale-directory', '/tmp/yale-directory.json'),
    ).not.toContain('--force-llm');
    const forced = buildScraperSweepChildArgs(
      'development-full',
      'yale-directory',
      '/tmp/yale-directory.json',
      { forceLlm: true },
    );
    expect(forced).toContain('--force-llm');
    expect(forced.indexOf('--force-llm')).toBeLessThan(forced.indexOf('--output'));
  });

  it('hands the scraper CLI a child arg vector it accepts, with force-llm reaching its options', () => {
    const scraperProcessArgv = (options: { forceLlm?: boolean }): string[] => {
      const childArgs = buildScraperSweepChildArgs(
        'development-full',
        'yale-directory',
        path.join(os.tmpdir(), 'yale-directory.json'),
        options,
      );
      return ['node', 'cli.ts', ...childArgs.slice(childArgs.indexOf('scrape') + 1)];
    };

    const forced = parseArgs(scraperProcessArgv({ forceLlm: true }));
    expect(forced.command).toBe('run');
    expect(parseScraperOptions(forced.flags).forceLlm).toBe(true);

    const plain = parseArgs(scraperProcessArgv({}));
    expect(parseScraperOptions(plain.flags).forceLlm).toBe(false);
    expect(parseScraperOptions(plain.flags).exhaustive).toBe(true);
  });

  it('builds the gated dead-observation prune child command', () => {
    expect(buildPruneDeadObservationsChildArgs('/tmp/development-sweep/prune.json')).toEqual([
      '--cwd',
      'server',
      'observations:prune-dead',
      '--apply',
      '--confirm-prune-dead-observations',
      '--output',
      '/tmp/development-sweep/prune.json',
    ]);
  });

  it('declares the read scope the prune children inherit, so an unset flag is not a green no-op', () => {
    const unset: NodeJS.ProcessEnv = {};
    declareMaterializationReadScopeForChildren(unset);
    expect(unset.C4_LOSSLESS_INGEST).toBe('false');

    const lossless: NodeJS.ProcessEnv = { C4_LOSSLESS_INGEST: 'true' };
    declareMaterializationReadScopeForChildren(lossless);
    expect(lossless.C4_LOSSLESS_INGEST).toBe('true');

    const garbled: NodeJS.ProcessEnv = { C4_LOSSLESS_INGEST: 'yes' };
    declareMaterializationReadScopeForChildren(garbled);
    expect(garbled.C4_LOSSLESS_INGEST).toBe('false');
  });

  it('omits the dead-data-prune post-run stage by default and appends it last when enabled', () => {
    expect(
      buildDevelopmentPostRunStages('/tmp/development-sweep').map((stage) => stage.name),
    ).not.toContain('dead-data-prune');
    const enabled = buildDevelopmentPostRunStages('/tmp/development-sweep', {
      pruneDeadObservations: true,
    });
    expect(enabled.map((stage) => stage.name).at(-1)).toBe('dead-data-prune');
    expect(enabled.find((stage) => stage.name === 'dead-data-prune')?.args).toEqual(
      expect.arrayContaining([
        'observations:prune-dead',
        '--apply',
        '--confirm-prune-dead-observations',
      ]),
    );
  });

  it('only allows the dead-observation prune on Development-database sweep modes', () => {
    expect(isDeadObservationPruneSweepMode('development-full')).toBe(true);
    expect(isDeadObservationPruneSweepMode('development-incremental')).toBe(true);
    expect(isDeadObservationPruneSweepMode('fellowship-development-full')).toBe(true);
    expect(isDeadObservationPruneSweepMode('development-plan')).toBe(false);
    expect(isDeadObservationPruneSweepMode('development-sample')).toBe(false);
  });

  it('omits the fellowship dead-data-prune stage by default and appends it last when enabled', () => {
    expect(
      buildFellowshipPostRunStages('/tmp/fellowship-sweep').map((stage) => stage.name),
    ).not.toContain('dead-data-prune');
    const enabled = buildFellowshipPostRunStages('/tmp/fellowship-sweep', {
      pruneDeadObservations: true,
    });
    expect(enabled.map((stage) => stage.name).at(-1)).toBe('dead-data-prune');
    const prune = enabled.find((stage) => stage.name === 'dead-data-prune');
    expect(prune?.args).toEqual(
      expect.arrayContaining([
        'observations:prune-dead',
        '--apply',
        '--confirm-prune-dead-observations',
        '--output=/tmp/fellowship-sweep/fellowship-dead-data-prune.json',
      ]),
    );
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

describe('sourcesThatProducedNothing (#2607)', () => {
  const row = (
    sourceName: string,
    status: 'succeeded' | 'failed' | 'not-run',
    observationCount: number | undefined,
  ) => ({ sourceName, status, observationCount }) as never;

  it('names a source that succeeded while writing no observation', () => {
    expect(
      sourcesThatProducedNothing([
        row('doe-osti', 'succeeded', 0),
        row('nih-reporter', 'succeeded', 287),
      ]),
    ).toEqual(['doe-osti']);
  });

  it('reproduces the five silent sources from the 2026-09-13 sweep', () => {
    const observed = sourcesThatProducedNothing([
      row('yale-directory', 'succeeded', 733),
      row('bbs-research-track', 'succeeded', 0),
      row('department-research-areas', 'succeeded', 0),
      row('department-undergrad-research', 'succeeded', 510),
      row('neh-funded-projects', 'succeeded', 0),
      row('federal-award-usaspending', 'succeeded', 0),
      row('doe-osti', 'succeeded', 0),
      row('undergrad-research-posting', 'failed', undefined),
    ]);
    expect(observed).toEqual([
      'bbs-research-track',
      'department-research-areas',
      'neh-funded-projects',
      'federal-award-usaspending',
      'doe-osti',
    ]);
    expect(observed).toHaveLength(5);
  });

  it('does not count a failed or not-run source, which are already reported separately', () => {
    expect(
      sourcesThatProducedNothing([
        row('undergrad-research-posting', 'failed', undefined),
        row('openalex', 'not-run', undefined),
      ]),
    ).toEqual([]);
  });

  it('fails the sweep step for a run the barren-streak guard marked failure', () => {
    expect(
      scraperSweepArtifactError('development-full', {
        runId: 'run-barren',
        runStatus: 'failure',
        observationCount: 0,
      }),
    ).toMatch(/ScrapeRun status is failure, expected success/);
  });
});

const profileLinkArtifact = (
  coverage: Record<string, unknown>,
  result: Record<string, unknown> = {},
) => ({
  result: {
    decisiveVerdicts: 12,
    statusesWritten: 9,
    ...result,
    coverage: {
      linksDue: 100,
      attempted: 100,
      probed: 100,
      hostsPlanned: 2,
      hostsCompleted: 2,
      linksUnreached: 0,
      linksStillDue: 0,
      complete: true,
      ...coverage,
    },
  },
});

describe('parseProfileLinkHealthResult', () => {
  it('reads coverage off a completed run', () => {
    expect(parseProfileLinkHealthResult(profileLinkArtifact({}))).toEqual({
      profileLinkHealthDelta: {
        linksDue: 100,
        attempted: 100,
        probed: 100,
        decisiveVerdicts: 12,
        statusesWritten: 9,
        hostsCompleted: 2,
        hostsPlanned: 2,
        linksStillDue: 0,
        complete: true,
      },
    });
  });

  /**
   * The point of the contract. A run that stopped partway must not be marked done by
   * the sweep's resume, because the links after the stopping point are never reached
   * otherwise (#3303).
   */
  it('refuses an incomplete run rather than recording it as a finished stage', () => {
    expect(() =>
      parseProfileLinkHealthResult(
        profileLinkArtifact({
          probed: 2800,
          hostsCompleted: 3,
          hostsPlanned: 4,
          linksStillDue: 300,
          complete: false,
        }),
      ),
    ).toThrow(/stopped after 3 of 4 hosts with 300 links still due/);
  });

  it('refuses an artifact with no coverage object at all, which is the old shape', () => {
    expect(() => parseProfileLinkHealthResult({ result: { probed: 10 } })).toThrow(
      /missing a coverage object/,
    );
    expect(() => parseProfileLinkHealthResult(null)).toThrow(/missing a coverage object/);
  });

  it('refuses coverage whose counts are not numbers', () => {
    expect(() => parseProfileLinkHealthResult(profileLinkArtifact({ probed: 'lots' }))).toThrow(
      /missing a numeric probed/,
    );
  });
});

describe('partialProfileLinkHealthDelta', () => {
  it('reports how far a died-partway run got, without the completeness contract', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-link-partial-'));
    const artifactPath = path.join(directory, 'development-profile-link-health.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify(
        profileLinkArtifact({
          probed: 2800,
          hostsCompleted: 3,
          hostsPlanned: 4,
          linksStillDue: 300,
          complete: false,
        }),
      ),
    );
    expect(partialProfileLinkHealthDelta(artifactPath)).toMatchObject({
      probed: 2800,
      hostsCompleted: 3,
      hostsPlanned: 4,
      linksStillDue: 300,
      complete: false,
    });
  });

  it('returns undefined when nothing was written, which is the failure it replaces', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-link-missing-'));
    expect(partialProfileLinkHealthDelta(path.join(directory, 'absent.json'))).toBeUndefined();
  });
});

describe('the profile-link-health stage carries a result contract', () => {
  it('parses its artifact, so a partial run cannot read as a finished stage', () => {
    const stage = DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS.find(
      (definition) => definition.name === 'profile-link-health',
    );
    expect(stage?.parseResult).toBe(parseProfileLinkHealthResult);
  });
});

describe('inferred-PI lead reclaim post-run stage', () => {
  const reclaimReport = (overrides: Record<string, unknown> = {}) => ({
    mode: 'apply',
    scope: 'all',
    scanned: 40,
    lagging: 7,
    rows: [],
    tally: {
      'materialized-lead': 3,
      'already-linked': 0,
      'still-unresolved': 4,
      'resolvable-pi': 0,
      'unresolvable-pi': 0,
    },
    ...overrides,
  });

  it('mints the researchers stored PI attributions name before the reclaim links them', () => {
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep');
    const names = stages.map((stage) => stage.name);
    expect(names.indexOf('pi-attributed-researcher-mint')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('pi-attributed-researcher-mint')).toBeLessThan(
      names.indexOf('inferred-pi-lead-reclaim'),
    );
    expect(stages.find((stage) => stage.name === 'pi-attributed-researcher-mint')?.args).toEqual([
      '--cwd',
      'server',
      'observations:materialize-pi-attributed-users',
      '--apply',
      '--confirm-materialize-pi-attributed-users',
      '--mint-only',
      '--output',
      '/tmp/development-sweep/development-pi-attributed-researcher-mint.json',
    ]);
  });

  it('runs on every Development sweep, over every entity, before the visibility gate', () => {
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep');
    const names = stages.map((stage) => stage.name);
    expect(names).toContain('inferred-pi-lead-reclaim');
    expect(names.indexOf('inferred-pi-lead-reclaim')).toBeLessThan(
      names.indexOf('visibility-gate'),
    );
    expect(stages.find((stage) => stage.name === 'inferred-pi-lead-reclaim')?.args).toEqual([
      '--cwd',
      'server',
      'data:materialize-inferred-pi-leads',
      '--all',
      '--apply',
      '--output',
      '/tmp/development-sweep/development-inferred-pi-lead-reclaim.json',
    ]);
  });

  it('reports the leads it linked and the rows it could not in the sweep summary', () => {
    expect(parseInferredPiLeadReclaimResult(reclaimReport()).inferredPiLeadReclaimDelta).toEqual({
      scanned: 40,
      lagging: 7,
      materializedLead: 3,
      stillUnresolved: 4,
    });
  });

  it('fails its contract on a dry-run, grant-shell-only or countless report', () => {
    expect(() => parseInferredPiLeadReclaimResult(null)).toThrow(/not an apply report/);
    expect(() => parseInferredPiLeadReclaimResult(reclaimReport({ mode: 'dry-run' }))).toThrow(
      /not an apply report/,
    );
    expect(() =>
      parseInferredPiLeadReclaimResult(reclaimReport({ scope: 'grant-shells' })),
    ).toThrow(/not an apply report/);
    expect(() => parseInferredPiLeadReclaimResult(reclaimReport({ tally: {} }))).toThrow(
      /missing a numeric materialized-lead/,
    );
  });
});

describe('sweepThrottleRetrySummary', () => {
  it('totals recovered and lost throttled requests and names the sources that lost pages', () => {
    const rows = [
      { sourceName: 'ysm-faculty-directory', throttleRecovered: 12, throttleExhausted: 2 },
      { sourceName: 'nih-reporter', throttleRecovered: 1, throttleExhausted: 0 },
      { sourceName: 'yse-centers-index' },
    ] as never;
    expect(sweepThrottleRetrySummary(rows)).toEqual({
      recovered: 13,
      exhausted: 2,
      exhaustedSources: ['ysm-faculty-directory'],
    });
  });
});
