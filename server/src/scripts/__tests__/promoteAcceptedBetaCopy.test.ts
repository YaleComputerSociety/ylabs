import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertSafeOptions,
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
      restorePoint: '',
      includeObservations: false,
      confirmLane: false,
      confirmProd: false,
    });
    expect(() => assertSafeOptions(options)).not.toThrow();
  });

  it('blocks apply mode until restore point and both production confirmations are present', () => {
    const options = parsePromotionOptions(['--apply'], baseEnv);

    expect(() => assertSafeOptions(options)).toThrow(
      'Apply mode requires --restore-point or ATLAS_RESTORE_POINT',
    );

    const missingConfirmations = parsePromotionOptions(
      ['--apply', '--restore-point', 'atlas-restore-1'],
      baseEnv,
    );
    expect(() => assertSafeOptions(missingConfirmations)).toThrow(
      'Apply mode requires CONFIRM_LANE_A_COPY=true and CONFIRM_PROD_SCRAPE=true',
    );

    const allowed = parsePromotionOptions(['--apply', '--restore-point', 'atlas-restore-1'], {
      ...baseEnv,
      CONFIRM_LANE_A_COPY: 'true',
      CONFIRM_PROD_SCRAPE: 'true',
    });
    expect(() => assertSafeOptions(allowed)).not.toThrow();
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
      restorePoint: null,
      betaTarget: 'beta.example.test/Beta',
      productionTarget: 'prod.example.test/Production',
      includesObservations: false,
      excludedSyntheticUsers: 2,
      applyBlockers: [
        'Copied records reference 1 excluded synthetic-user link across 1 collection field.',
      ],
      syntheticReferenceBlockersClear: false,
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
