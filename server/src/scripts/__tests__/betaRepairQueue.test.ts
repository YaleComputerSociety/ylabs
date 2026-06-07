import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertBetaRepairQueueApplyReviewedArtifact,
  buildBetaRepairQueueOutput,
  buildApplyFromArtifactOptions,
  parseBetaRepairQueueArgs,
  validateBetaRepairQueueApplyArtifact,
  writeBetaRepairQueueOutput,
} from '../betaRepairQueue';

describe('betaRepairQueue CLI helpers', () => {
  it('parses dry-run lane filters and output flags', () => {
    expect(
      parseBetaRepairQueueArgs([
        '--collection=research',
        '--stage=action_evidence',
        '--mode=dry-run',
        '--retry-blocked',
        '--limit=250',
        '--record-id=entity-1',
        '--record-id',
        'entity-2',
        '--record-id=entity-1',
        '--apply-from=/tmp/ylabs-beta-repair-action-dry-run.json',
        '--include-blocked-patches',
        '--output=/tmp/ylabs-beta-repair-action.json',
      ]),
    ).toEqual({
      mode: 'dry-run',
      collection: 'research',
      stage: 'action_evidence',
      retryBlocked: true,
      limit: 250,
      recordIds: ['entity-1', 'entity-2'],
      confirmBetaRepairQueueApply: false,
      applyFrom: '/tmp/ylabs-beta-repair-action-dry-run.json',
      includeBlockedPatches: true,
      output: '/tmp/ylabs-beta-repair-action.json',
    });
  });

  it('rejects malformed beta repair queue arguments', () => {
    expect(() => parseBetaRepairQueueArgs(['--limit=bad'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseBetaRepairQueueArgs(['--limit=1e3'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseBetaRepairQueueArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseBetaRepairQueueArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseBetaRepairQueueArgs(['--apply-from=--output=/tmp/out.json'])).toThrow(
      /--apply-from requires a path/,
    );
    expect(() => parseBetaRepairQueueArgs(['--record-id='])).toThrow(
      /--record-id requires a value/,
    );
    expect(() => parseBetaRepairQueueArgs(['--record-id', '--output=/tmp/out.json'])).toThrow(
      /--record-id requires a value/,
    );
    expect(() => parseBetaRepairQueueArgs(['--confirm-beta-repair-queue-apply=true'])).toThrow(
      /--confirm-beta-repair-queue-apply does not accept a value/,
    );
  });

  it('requires a reviewed dry-run artifact before beta repair queue apply', () => {
    const options = parseBetaRepairQueueArgs([
      '--mode=apply',
      '--collection=all',
      '--stage=source_description',
      '--limit=500',
    ]);

    expect(options).toMatchObject({
      mode: 'apply',
      collection: 'all',
      stage: 'source_description',
      limit: 500,
      confirmBetaRepairQueueApply: false,
    });
    expect(options.applyFrom).toBeUndefined();
    expect(() => assertBetaRepairQueueApplyReviewedArtifact(options)).toThrow(
      /--apply-from is required/,
    );

    expect(() =>
      assertBetaRepairQueueApplyReviewedArtifact(
        parseBetaRepairQueueArgs([
          '--mode=apply',
          '--collection=all',
          '--stage=source_description',
          '--confirm-beta-repair-queue-apply',
          '--apply-from=/tmp/ylabs-beta-repair-source-description.json',
        ]),
      ),
    ).not.toThrow();
  });

  it('requires explicit confirmation before beta repair queue apply can run', () => {
    expect(() =>
      assertBetaRepairQueueApplyReviewedArtifact(
        parseBetaRepairQueueArgs([
          '--mode=apply',
          '--collection=all',
          '--stage=source_description',
          '--apply-from=/tmp/ylabs-beta-repair-source-description.json',
        ]),
      ),
    ).toThrow(/--confirm-beta-repair-queue-apply is required/);
  });

  it('validates apply-from artifacts and returns dry-run-positive record ids', () => {
    const validation = validateBetaRepairQueueApplyArtifact(
      {
        generatedAt: '2026-06-05T00:00:00.000Z',
        environment: 'beta',
        db: 'Beta',
        mode: 'dry-run',
        options: {
          mode: 'dry-run',
          collection: 'research',
          stage: 'source_description',
          limit: 500,
          retryBlocked: true,
        },
        attempts: [
          {
            applied: true,
            status: 'repaired',
            plan: {
              queueItemId: 'queue-1',
              collection: 'research',
              recordId: 'entity-1',
              repairStage: 'source_description',
            },
            patchSummary: ['derived shortDescription from source-backed fullDescription'],
            repairSource: 'https://medicine.yale.edu/lab/example/',
          },
          {
            applied: true,
            status: 'blocked',
            remainingBlockers: ['duplicate_risk'],
            plan: {
              queueItemId: 'queue-3',
              collection: 'research',
              recordId: 'entity-3',
              repairStage: 'source_description',
            },
          },
          {
            applied: false,
            plan: {
              queueItemId: 'queue-2',
              collection: 'research',
              recordId: 'entity-2',
              repairStage: 'source_description',
            },
          },
        ],
      },
      {
        mode: 'apply',
        collection: 'research',
        stage: 'source_description',
        limit: 500,
        retryBlocked: true,
      },
      new Date('2026-06-05T01:00:00.000Z'),
    );

    expect(validation).toEqual({
      recordIds: ['entity-1'],
      queueItemIds: ['queue-1'],
      retryBlocked: true,
    });
  });

  it('can opt into applying dry-run partial patches from reviewed artifacts', () => {
    const validation = validateBetaRepairQueueApplyArtifact(
      {
        generatedAt: '2026-06-05T00:00:00.000Z',
        environment: 'beta',
        db: 'Beta',
        mode: 'dry-run',
        options: {
          mode: 'dry-run',
          collection: 'research',
          stage: 'source_description',
          limit: 500,
          retryBlocked: true,
        },
        attempts: [
          {
            applied: true,
            status: 'repaired',
            plan: {
              queueItemId: 'queue-1',
              collection: 'research',
              recordId: 'entity-1',
              repairStage: 'source_description',
            },
          },
          {
            applied: true,
            status: 'blocked',
            patchSummary: ['attached sourceUrls from field provenance'],
            remainingBlockers: ['missing_description'],
            plan: {
              queueItemId: 'queue-2',
              collection: 'research',
              recordId: 'entity-2',
              repairStage: 'source_description',
            },
          },
          {
            applied: false,
            status: 'blocked',
            plan: {
              queueItemId: 'queue-3',
              collection: 'research',
              recordId: 'entity-3',
              repairStage: 'source_description',
            },
          },
        ],
      },
      {
        mode: 'apply',
        collection: 'research',
        stage: 'source_description',
        limit: 500,
        retryBlocked: true,
        includeBlockedPatches: true,
      },
      new Date('2026-06-05T01:00:00.000Z'),
    );

    expect(validation).toEqual({
      recordIds: ['entity-1', 'entity-2'],
      queueItemIds: ['queue-1', 'queue-2'],
      retryBlocked: true,
    });
  });

  it('does not replay blocked dry-run attempts without patch summaries', () => {
    expect(() =>
      validateBetaRepairQueueApplyArtifact(
        {
          generatedAt: '2026-06-05T00:00:00.000Z',
          environment: 'beta',
          db: 'Beta',
          mode: 'dry-run',
          options: {
            mode: 'dry-run',
            collection: 'research',
            stage: 'source_description',
            limit: 500,
          },
          attempts: [
            {
              applied: true,
              status: 'blocked',
              remainingBlockers: ['missing_description'],
              plan: {
                queueItemId: 'queue-2',
                collection: 'research',
                recordId: 'entity-2',
                repairStage: 'source_description',
              },
            },
          ],
        },
        {
          mode: 'apply',
          collection: 'research',
          stage: 'source_description',
          limit: 500,
          includeBlockedPatches: true,
        },
        new Date('2026-06-05T01:00:00.000Z'),
      ),
    ).toThrow(/no dry-run-positive repair attempts/);
  });

  it('rejects stale or target-mismatched apply-from artifacts', () => {
    expect(() =>
      validateBetaRepairQueueApplyArtifact(
        {
          generatedAt: '2026-06-01T00:00:00.000Z',
          environment: 'beta',
          mode: 'dry-run',
          options: { mode: 'dry-run', collection: 'research', stage: 'source_description' },
          attempts: [],
        },
        { mode: 'apply', collection: 'research', stage: 'source_description' },
        new Date('2026-06-05T00:00:00.000Z'),
      ),
    ).toThrow(/stale/i);
    expect(() =>
      validateBetaRepairQueueApplyArtifact(
        {
          generatedAt: '2026-06-05T00:00:00.000Z',
          environment: 'production',
          mode: 'dry-run',
          options: { mode: 'dry-run', collection: 'research', stage: 'source_description' },
          attempts: [],
        },
        { mode: 'apply', collection: 'research', stage: 'source_description' },
        new Date('2026-06-05T01:00:00.000Z'),
      ),
    ).toThrow(/beta/i);
  });

  it('builds lane options from a valid apply-from artifact', () => {
    expect(
      buildApplyFromArtifactOptions(
        {
          recordIds: ['entity-1'],
          queueItemIds: ['queue-1'],
          retryBlocked: true,
        },
        {
          mode: 'apply',
          collection: 'research',
          stage: 'source_description',
          limit: 500,
        },
      ),
    ).toEqual({
      mode: 'apply',
      collection: 'research',
      stage: 'source_description',
      retryBlocked: true,
      recordIds: ['entity-1'],
      queueItemIds: ['queue-1'],
      limit: 1,
    });
  });

  it('builds beta repair queue artifacts with freshness metadata', () => {
    expect(
      buildBetaRepairQueueOutput(
        {
          environment: 'beta',
          db: 'Beta',
          options: {
            mode: 'dry-run',
            collection: 'all',
            stage: 'source_description',
            retryBlocked: true,
            limit: 500,
            output: '/tmp/ylabs-beta-repair-source-description.json',
          },
        } as any,
        {
          mode: 'dry-run',
          scanned: 2,
          repaired: 0,
          blocked: 2,
          attempts: [
            {
              applied: false,
              remainingBlockers: ['missing_action_evidence', 'missing_lead'],
              plan: { blockerReasons: ['missing_action_evidence'] },
            },
            {
              applied: false,
              remainingBlockers: ['missing_action_evidence'],
              plan: { blockerReasons: ['missing_action_evidence'] },
            },
            {
              applied: true,
              status: 'blocked',
              remainingBlockers: ['missing_card_description'],
              plan: { blockerReasons: ['missing_card_description'] },
            },
          ],
        },
        new Date('2026-05-31T17:15:00.000Z'),
      ),
    ).toMatchObject({
      generatedAt: '2026-05-31T17:15:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: {
        mode: 'dry-run',
        collection: 'all',
        stage: 'source_description',
        retryBlocked: true,
        limit: 500,
        output: '/tmp/ylabs-beta-repair-source-description.json',
      },
      mode: 'dry-run',
      scanned: 2,
      repaired: 0,
      blocked: 2,
      blockedReasonCounts: [
        { reason: 'missing_action_evidence', count: 2 },
        { reason: 'missing_card_description', count: 1 },
        { reason: 'missing_lead', count: 1 },
      ],
    });
  });

  it('writes the beta repair queue artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-beta-repair-'));
    const output = path.join(dir, 'beta-repair.json');
    writeBetaRepairQueueOutput(
      {
        environment: 'beta',
        db: 'Beta',
        mode: 'dry-run',
        scanned: 2,
        repaired: 0,
        blocked: 2,
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      environment: 'beta',
      db: 'Beta',
      mode: 'dry-run',
      scanned: 2,
      repaired: 0,
      blocked: 2,
    });
  });
});
