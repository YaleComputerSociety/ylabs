import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertSafeOptions,
  buildPromotionCutoverMismatches,
  buildRunEvidenceBlockers,
  assertPromotionSummaryCanApply,
  buildPromotionSummary,
  parsePromotionOptions,
  promotionCollectionNamesForOptions,
  writePromotionOutput,
} from '../promoteAcceptedBetaCopy';

const baseEnv = {
  BETA_MONGODBURL: 'mongodb+srv://user:pass@beta.example.test/Beta',
  PRODUCTION_MONGODBURL: 'mongodb+srv://user:pass@prod.example.test/Production',
  PROMOTION_DATASET_VERSION: 'prod-promote-2026-05-29-lane-a-beta-copy',
};

describe('promote accepted Beta copy guards', () => {
  it('allows dry-run planning without restore point or production confirmations', () => {
    const options = parsePromotionOptions([], baseEnv);

    expect(options).toMatchObject({
      mode: 'dry-run',
      datasetVersion: 'prod-promote-2026-05-29-lane-a-beta-copy',
      includeObservations: false,
      confirmLane: false,
      confirmProd: false,
    });
    expect(() => assertSafeOptions(options)).not.toThrow();
  });

  it('blocks apply mode until both production confirmations are present', () => {
    const missingConfirmations = parsePromotionOptions(['--apply'], baseEnv);
    expect(() => assertSafeOptions(missingConfirmations)).toThrow(
      'Apply mode requires CONFIRM_LANE_A_COPY=true and CONFIRM_PROD_SCRAPE=true',
    );

    const allowed = parsePromotionOptions(['--apply'], {
      ...baseEnv,
      CONFIRM_LANE_A_COPY: 'true',
      CONFIRM_PROD_SCRAPE: 'true',
    });
    expect(() => assertSafeOptions(allowed)).not.toThrow();
  });

  /**
   * The restore point was the only rollback story this script had and it was
   * unverifiable - any non-empty string satisfied it. The staged swap replaces it,
   * so apply mode must no longer demand one (#2347).
   */
  it('no longer requires or accepts an operator-supplied restore point', () => {
    const options = parsePromotionOptions(['--apply'], {
      ...baseEnv,
      CONFIRM_LANE_A_COPY: 'true',
      CONFIRM_PROD_SCRAPE: 'true',
      ATLAS_RESTORE_POINT: 'atlas-restore-1',
    });
    expect(options).not.toHaveProperty('restorePoint');
    expect(() => assertSafeOptions(options)).not.toThrow();

    // An operator running the old runbook command gets a clear error rather than
    // silent acceptance of a flag that no longer does anything.
    expect(() => parsePromotionOptions(['--apply', '--restore-point', 'x'], baseEnv)).toThrow(
      'Unknown production:promote-beta-copy argument: --restore-point',
    );
  });

  it('leaves observations out of the copy set unless the operator explicitly opts in', () => {
    expect(parsePromotionOptions([], baseEnv).includeObservations).toBe(false);
    expect(parsePromotionOptions(['--skip-observations'], baseEnv).includeObservations).toBe(false);
    expect(parsePromotionOptions(['--include-observations'], baseEnv).includeObservations).toBe(
      true,
    );
  });

  it('parses output path for review artifacts', () => {
    expect(
      parsePromotionOptions(
        [
          '--dataset-version',
          'prod-promote-2026-05-31-lane-a-beta-copy',
          '--output',
          '/tmp/ylabs-lane-a-promotion-dry-run.json',
        ],
        baseEnv,
      ),
    ).toMatchObject({
      datasetVersion: 'prod-promote-2026-05-31-lane-a-beta-copy',
      output: '/tmp/ylabs-lane-a-promotion-dry-run.json',
    });
  });

  it('rejects flag-looking inline output paths before environment validation', () => {
    expect(() => parsePromotionOptions(['--output=--apply'], baseEnv)).toThrow(
      /--output requires a path/,
    );
  });

  it('rejects promotion artifacts outside safe JSON roots before environment validation', () => {
    expect(() => parsePromotionOptions(['--output=/etc/lane-a.json'], baseEnv)).toThrow(
      /--output must write under/,
    );
    expect(() => parsePromotionOptions(['--output=/tmp/lane-a.txt'], baseEnv)).toThrow(
      /--output must point to a \.json report file/,
    );
  });

  it('rejects ambiguous promotion copy arguments before environment validation', () => {
    expect(() => parsePromotionOptions(['prod'], baseEnv)).toThrow(
      /Unknown production:promote-beta-copy argument: prod/,
    );
  });

  it('keeps launch research activity collections in the Lane A copy allowlist', () => {
    const defaultNames = promotionCollectionNamesForOptions(parsePromotionOptions([], baseEnv));
    const includeObservationNames = promotionCollectionNamesForOptions(
      parsePromotionOptions(['--include-observations'], baseEnv),
    );

    expect(defaultNames).toEqual(
      expect.arrayContaining([
        'research_entities',
        'research_entity_relationships',
        'research_entity_redirects',
        'accounts',
        'researchers',
        'role_assignments',
        'org_units',
        'taxonomy_terms',
      ]),
    );
    expect(defaultNames).not.toContain('observations');
    expect(includeObservationNames).toContain('observations');
    for (const retired of [
      'faculty_members',
      'research_scholarly_links',
      'research_scholarly_attributions',
      'users',
      'listings',
      'papers',
      'paper_authors',
    ]) {
      expect(defaultNames).not.toContain(retired);
    }
  });

  it('builds a reviewable dry-run summary without requiring MongoDB connections', () => {
    const options = parsePromotionOptions(['--skip-observations'], baseEnv);
    const summary = buildPromotionSummary(
      options,
      [
        {
          name: 'research_entities',
          category: 'research-discovery',
          sourceCount: 12,
          sourceCopyCount: 12,
          targetCount: 3,
          excludedCount: 0,
        },
        {
          name: 'scrape_runs',
          category: 'source-audit',
          sourceCount: 4,
          sourceCopyCount: 4,
          targetCount: 1,
          excludedCount: 0,
        },
        {
          name: 'accounts',
          category: 'base-support',
          sourceCount: 10,
          sourceCopyCount: 8,
          targetCount: 5,
          excludedCount: 2,
        },
      ],
      [
        {
          collection: 'listings',
          field: 'createdByUserId',
          count: 1,
        },
      ],
    );

    expect(summary).toMatchObject({
      mode: 'dry-run',
      sourceEnvironment: 'beta',
      targetEnvironment: 'production',
      datasetVersion: 'prod-promote-2026-05-29-lane-a-beta-copy',
      betaTarget: 'beta.example.test/Beta',
      productionTarget: 'prod.example.test/Production',
      includesObservations: false,
      excludedSyntheticUsers: 2,
      applyBlockers: [
        'Copied records reference 1 excluded synthetic-user link across 1 collection field.',
        // This fixture is the #2513 shape: --skip-observations against a populated
        // scrape_runs, so the run-evidence guard fires on the DEFAULT promotion path.
        'scrape_runs is in the promotion manifest but observations is not, which installs a run history with no evidence behind it (#2513). Pass --include-observations, or drop --include-scrape-runs.',
      ],
      syntheticReferenceBlockersClear: false,
      runEvidenceBlockersClear: false,
      blockedSyntheticUserReferences: [
        {
          collection: 'listings',
          field: 'createdByUserId',
          count: 1,
        },
      ],
    });
    expect(summary.collectionCategories).toEqual([
      {
        category: 'research-discovery',
        collectionCount: 1,
        sourceCount: 12,
        sourceCopyCount: 12,
        targetCount: 3,
        excludedCount: 0,
      },
      {
        category: 'source-audit',
        collectionCount: 1,
        sourceCount: 4,
        sourceCopyCount: 4,
        targetCount: 1,
        excludedCount: 0,
      },
      {
        category: 'base-support',
        collectionCount: 1,
        sourceCount: 10,
        sourceCopyCount: 8,
        targetCount: 5,
        excludedCount: 2,
      },
    ]);
  });

  it('marks synthetic reference blockers clear when no synthetic-user references are blocked', () => {
    const options = parsePromotionOptions([], baseEnv);
    const summary = buildPromotionSummary(
      options,
      [
        {
          name: 'accounts',
          category: 'base-support',
          sourceCount: 8,
          sourceCopyCount: 8,
          targetCount: 8,
          excludedCount: 0,
        },
      ],
      [],
    );

    expect(summary.syntheticReferenceBlockersClear).toBe(true);
    expect(summary.applyBlockers).toEqual([]);
    expect(summary.excludedSyntheticUsers).toBe(0);
  });

  it('blocks apply from the same summary blockers shown in dry-run review', () => {
    const options = parsePromotionOptions([], baseEnv);
    const blockedSummary = buildPromotionSummary(
      options,
      [
        {
          name: 'accounts',
          category: 'base-support',
          sourceCount: 10,
          sourceCopyCount: 8,
          targetCount: 5,
          excludedCount: 2,
        },
      ],
      [
        {
          collection: 'research_scholarly_links',
          field: 'userId',
          count: 2,
        },
      ],
    );

    expect(() => assertPromotionSummaryCanApply(blockedSummary)).toThrow(
      'Apply mode blocked: Copied records reference 2 excluded synthetic-user links across 1 collection field.',
    );

    const clearSummary = buildPromotionSummary(
      options,
      [
        {
          name: 'accounts',
          category: 'base-support',
          sourceCount: 8,
          sourceCopyCount: 8,
          targetCount: 5,
          excludedCount: 0,
        },
      ],
      [],
    );
    expect(() => assertPromotionSummaryCanApply(clearSummary)).not.toThrow();
  });

  it('writes a promotion review artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-promotion-copy-'));
    const output = path.join(dir, 'lane-a-dry-run.json');
    const payload = {
      mode: 'dry-run',
      datasetVersion: 'prod-promote-2026-05-31-lane-a-beta-copy',
      syntheticReferenceBlockersClear: true,
      applyBlockers: [],
    };

    writePromotionOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('rejects unsafe promotion artifact writes from programmatic callers', () => {
    expect(() => writePromotionOutput({ mode: 'dry-run' }, '/etc/lane-a.json')).toThrow(
      /--output must write under/,
    );
  });

  it('blocks apply when a collection would copy nothing over existing production documents', () => {
    const options = parsePromotionOptions(['--include-observations'], baseEnv);

    const summary = buildPromotionSummary(
      options,
      [
        {
          name: 'research_entities',
          category: 'research-discovery',
          sourceCount: 6440,
          sourceCopyCount: 6440,
          targetCount: 3331,
          excludedCount: 0,
        },
        {
          name: 'observations',
          category: 'source-audit',
          sourceCount: 0,
          sourceCopyCount: 0,
          targetCount: 653321,
          excludedCount: 0,
        },
      ],
      [],
    );

    expect(summary.emptySourceBlockersClear).toBe(false);
    expect(summary.syntheticReferenceBlockersClear).toBe(true);
    expect(() => assertPromotionSummaryCanApply(summary)).toThrow(
      'Collection observations would copy 0 documents over 653321 existing production documents',
    );
  });

  it('does not block a collection that is absent from production', () => {
    const options = parsePromotionOptions([], baseEnv);

    const summary = buildPromotionSummary(
      options,
      [
        {
          name: 'signals',
          category: 'research-discovery',
          sourceCount: 11164,
          sourceCopyCount: 11164,
          targetCount: 0,
          excludedCount: 0,
        },
        {
          name: 'scrape_runs',
          category: 'source-audit',
          sourceCount: 0,
          sourceCopyCount: 0,
          targetCount: 0,
          excludedCount: 0,
        },
      ],
      [],
    );

    expect(summary.emptySourceBlockersClear).toBe(true);
    expect(() => assertPromotionSummaryCanApply(summary)).not.toThrow();
  });

  it('measures the accounts guard against the copied count, not the raw count', () => {
    const options = parsePromotionOptions([], baseEnv);

    const summary = buildPromotionSummary(
      options,
      [
        {
          name: 'accounts',
          category: 'research-discovery',
          sourceCount: 12,
          sourceCopyCount: 0,
          targetCount: 4179,
          excludedCount: 12,
        },
      ],
      [],
    );

    expect(summary.emptySourceBlockersClear).toBe(false);
    expect(() => assertPromotionSummaryCanApply(summary)).toThrow(
      'Collection accounts would copy 0 documents over 4179 existing production documents',
    );
  });
});

const runRow = (sourceCopyCount: number) => ({
  name: 'scrape_runs',
  category: 'source-audit' as const,
  sourceCount: sourceCopyCount,
  sourceCopyCount,
  targetCount: 0,
  excludedCount: 0,
});
const observationRow = (sourceCopyCount: number) => ({
  name: 'observations',
  category: 'source-audit' as const,
  sourceCount: sourceCopyCount,
  sourceCopyCount,
  targetCount: 0,
  excludedCount: 0,
});

describe('run history may not be promoted without its evidence (#2513 via #2347)', () => {
  it('blocks a populated scrape_runs when observations is absent from the manifest', () => {
    const blockers = buildRunEvidenceBlockers([runRow(1869)]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('#2513');
  });

  it('blocks when both are in the manifest but Beta offers no observations', () => {
    const blockers = buildRunEvidenceBlockers([runRow(1869), observationRow(0)]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('1869 scrape runs and 0 observations');
  });

  it('allows the pair when both carry rows', () => {
    expect(buildRunEvidenceBlockers([runRow(1869), observationRow(420906)])).toEqual([]);
  });

  /**
   * Promoting no run history installs no unverifiable history, so an empty
   * scrape_runs must not be blocked - an existing test covering a collection
   * absent from production depends on this.
   */
  it('allows an empty scrape_runs with no observations row', () => {
    expect(buildRunEvidenceBlockers([runRow(0)])).toEqual([]);
  });

  it('is silent when scrape_runs is not being promoted at all', () => {
    expect(buildRunEvidenceBlockers([observationRow(10)])).toEqual([]);
  });
});

describe('promotion cutover verification (#2347)', () => {
  it('reports a short copy per collection', () => {
    const mismatches = buildPromotionCutoverMismatches(
      [runRow(1869), observationRow(420906)],
      new Map([
        ['scrape_runs', 1869],
        ['observations', 12],
      ]),
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toContain('observations promoted 12 rows against 420906');
  });

  it('treats a missing collection as zero rather than passing it', () => {
    expect(buildPromotionCutoverMismatches([runRow(5)], new Map())).toHaveLength(1);
  });

  it('passes when every collection matches what Beta offered', () => {
    expect(buildPromotionCutoverMismatches([runRow(5)], new Map([['scrape_runs', 5]]))).toEqual([]);
  });
});

describe('scrape_runs is opt-in, and off by default (#2589)', () => {
  /**
   * #2585's guard told operators to "exclude scrape_runs as well" while no flag
   * could do it, which left Beta to Production unrunnable by any flag combination.
   */
  it('leaves scrape_runs out of the manifest unless the operator opts in', () => {
    expect(promotionCollectionNamesForOptions(parsePromotionOptions([], baseEnv))).not.toContain(
      'scrape_runs',
    );
    expect(
      promotionCollectionNamesForOptions(parsePromotionOptions(['--skip-scrape-runs'], baseEnv)),
    ).not.toContain('scrape_runs');
    expect(
      promotionCollectionNamesForOptions(parsePromotionOptions(['--include-scrape-runs'], baseEnv)),
    ).toContain('scrape_runs');
  });

  it('reports which of the two source-audit collections the run carries', () => {
    expect(parsePromotionOptions([], baseEnv)).toMatchObject({
      includeObservations: false,
      includeScrapeRuns: false,
    });
  });

  /**
   * The whole point: the default promotion must now clear the guard, so the
   * department-facet fix can reach Production.
   */
  it('clears the run-evidence guard on the default path', () => {
    const options = parsePromotionOptions([], baseEnv);
    const plan = promotionCollectionNamesForOptions(options).map((name) => ({
      name,
      category: 'research-discovery' as const,
      sourceCount: 10,
      sourceCopyCount: 10,
      targetCount: 0,
      excludedCount: 0,
    }));
    expect(buildRunEvidenceBlockers(plan)).toEqual([]);
  });

  it('still blocks when the operator opts scrape_runs in without observations', () => {
    const options = parsePromotionOptions(['--include-scrape-runs'], baseEnv);
    expect(promotionCollectionNamesForOptions(options)).toContain('scrape_runs');
    expect(promotionCollectionNamesForOptions(options)).not.toContain('observations');
    expect(buildRunEvidenceBlockers([runRow(1897)])).toHaveLength(1);
  });

  /**
   * Beta holds 0 observations, so opting BOTH in is still refused - the remedy the
   * guard names is real, but it does not make a fabricated trail promotable.
   */
  it('still blocks both-opted-in when Beta offers no observations', () => {
    const blockers = buildRunEvidenceBlockers([runRow(1897), observationRow(0)]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('1897 scrape runs and 0 observations');
  });
});
