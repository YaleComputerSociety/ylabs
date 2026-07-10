import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertArchivedEntityArtifactRepairApplyAllowed,
  buildRepairArchivedEntityArtifactsOutput,
  normalizeArchivedArtifactObjectId,
  parseRepairArchivedEntityArtifactsArgs,
  writeRepairArchivedEntityArtifactsOutput,
} from '../repairArchivedEntityArtifacts';

describe('repairArchivedEntityArtifacts CLI helpers', () => {
  it('normalizes archived artifact ObjectIds without object-shaped coercion', () => {
    expect(normalizeArchivedArtifactObjectId(' 507f1f77bcf86cd799439011 ')).toBe(
      '507f1f77bcf86cd799439011',
    );
    expect(normalizeArchivedArtifactObjectId('abcdefghijkl')).toBeUndefined();
    expect(
      normalizeArchivedArtifactObjectId({
        toString: () => '507f1f77bcf86cd799439011',
      }),
    ).toBeUndefined();
  });

  it('parses dry-run/apply safety and output flags', () => {
    expect(
      parseRepairArchivedEntityArtifactsArgs([
        '--mode=apply',
        '--confirm-archived-artifact-repair',
        '--limit=50',
        '--max-apply=5',
        '--output',
        '/tmp/ylabs-archived-artifact-repair.json',
      ]),
    ).toEqual({
      apply: true,
      confirmArchivedArtifactRepair: true,
      limit: 50,
      limitProvided: true,
      maxApply: 5,
      output: '/tmp/ylabs-archived-artifact-repair.json',
    });
  });

  it('rejects ambiguous and malformed repair CLI arguments', () => {
    expect(() => parseRepairArchivedEntityArtifactsArgs(['prod'])).toThrow(
      /Unknown research-entity:repair-archived-artifacts argument: prod/,
    );
    expect(() => parseRepairArchivedEntityArtifactsArgs(['--limit'])).toThrow(
      /--limit requires a number/,
    );
    expect(() => parseRepairArchivedEntityArtifactsArgs(['--limit=bad'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseRepairArchivedEntityArtifactsArgs(['--limit=1.5'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseRepairArchivedEntityArtifactsArgs(['--max-apply=1.5'])).toThrow(
      /--max-apply must be a positive integer/,
    );
    expect(() => parseRepairArchivedEntityArtifactsArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parseRepairArchivedEntityArtifactsArgs(['--output', '/var/tmp/archived-artifact-repair.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseRepairArchivedEntityArtifactsArgs(['--output', '/tmp/archived-artifact-repair.txt']),
    ).toThrow(/--output must point to a \.json report file/);
  });

  it('blocks apply when the planned artifact writes exceed max apply', () => {
    expect(() =>
      assertArchivedEntityArtifactRepairApplyAllowed({
        apply: true,
        confirmArchivedArtifactRepair: true,
        maxApply: 2,
        plannedWrites: 3,
      }),
    ).toThrow('Apply would modify 3 artifacts, above --max-apply.');
  });

  it('requires an explicit limit before archived artifact repair apply', () => {
    const options = parseRepairArchivedEntityArtifactsArgs(['--apply']);

    expect(options).toMatchObject({
      apply: true,
      limit: 100,
      limitProvided: false,
    });
    expect(() =>
      assertArchivedEntityArtifactRepairApplyAllowed({
        apply: true,
        confirmArchivedArtifactRepair: true,
        limitProvided: false,
        maxApply: 25,
        plannedWrites: 0,
      }),
    ).toThrow(/--limit is required when --apply is set/);

    expect(
      parseRepairArchivedEntityArtifactsArgs(['--apply', '--limit=10']),
    ).toMatchObject({
      apply: true,
      confirmArchivedArtifactRepair: false,
      limit: 10,
      limitProvided: true,
    });
  });

  it('requires explicit confirmation before archived artifact repair apply', () => {
    expect(() =>
      assertArchivedEntityArtifactRepairApplyAllowed({
        apply: true,
        confirmArchivedArtifactRepair: false,
        limitProvided: true,
        maxApply: 25,
        plannedWrites: 0,
      }),
    ).toThrow(/--confirm-archived-artifact-repair is required/);
  });

  it('allows confirmed bounded archived artifact repair apply', () => {
    expect(() =>
      assertArchivedEntityArtifactRepairApplyAllowed({
        apply: true,
        confirmArchivedArtifactRepair: true,
        limitProvided: true,
        maxApply: 1,
        plannedWrites: 1,
      }),
    ).not.toThrow();
  });

  it('wraps saved artifacts with target and parsed options metadata', () => {
    expect(
      buildRepairArchivedEntityArtifactsOutput(
        {
          environment: 'beta',
          db: 'Beta',
          options: {
            apply: false,
            confirmArchivedArtifactRepair: false,
            limit: 5,
            limitProvided: true,
            maxApply: 2,
            output: '/tmp/ylabs-archived-artifact-repair.json',
          },
        },
        {
          mode: 'dry-run',
          scannedArtifacts: 4,
          plannedWrites: 3,
          planSummary: { relink: 2, mergeAndArchive: 1, archiveWithoutCanonical: 0, skipped: 0 },
        },
        new Date('2026-06-01T00:00:00.000Z'),
      ),
    ).toMatchObject({
      generatedAt: '2026-06-01T00:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        confirmArchivedArtifactRepair: false,
        limit: 5,
        limitProvided: true,
        maxApply: 2,
        output: '/tmp/ylabs-archived-artifact-repair.json',
      },
      mode: 'dry-run',
      scannedArtifacts: 4,
      plannedWrites: 3,
    });
  });

  it('writes repair artifacts when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-archived-artifact-repair-'));
    const output = path.join(dir, 'repair.json');
    writeRepairArchivedEntityArtifactsOutput(
      {
        mode: 'dry-run',
        scannedArtifacts: 4,
        planSummary: { relink: 2, mergeAndArchive: 1, archiveWithoutCanonical: 1, skipped: 0 },
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      mode: 'dry-run',
      scannedArtifacts: 4,
      planSummary: { relink: 2, mergeAndArchive: 1, archiveWithoutCanonical: 1, skipped: 0 },
    });
  });

  it('rejects unsafe archived artifact repair writes', () => {
    expect(() =>
      writeRepairArchivedEntityArtifactsOutput(
        { mode: 'dry-run' },
        '/var/tmp/archived-artifact-repair.json',
      ),
    ).toThrow(/--output must write under/);
  });
});
