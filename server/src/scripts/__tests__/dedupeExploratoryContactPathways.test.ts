import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertDedupeExploratoryContactPathwaysApplyConfirmed,
  buildDedupeExploratoryContactPathwaysOutput,
  countDedupeExploratoryContactPathwaysPlannedChanges,
  parseDedupeExploratoryContactPathwaysArgs,
  writeDedupeExploratoryContactPathwaysOutput,
} from '../dedupeExploratoryContactPathways';

describe('dedupeExploratoryContactPathways CLI helpers', () => {
  it('parses dry-run limit and output flags', () => {
    expect(
      parseDedupeExploratoryContactPathwaysArgs([
        '--mode=dry-run',
        '--limit=250',
        '--output',
        '/tmp/ylabs-dedupe-exploratory-pathways.json',
      ]),
    ).toEqual({
      apply: false,
      confirmExploratoryDedupeApply: false,
      limit: 250,
      limitProvided: true,
      output: '/tmp/ylabs-dedupe-exploratory-pathways.json',
    });
  });

  it('parses apply bounds for exploratory pathway dedupe', () => {
    expect(
      parseDedupeExploratoryContactPathwaysArgs([
        '--apply',
        '--confirm-exploratory-dedupe-apply',
        '--limit',
        '25',
        '--max-apply=9',
      ]),
    ).toMatchObject({
      apply: true,
      confirmExploratoryDedupeApply: true,
      limit: 25,
      limitProvided: true,
      maxApply: 9,
    });
  });

  it('requires explicit confirmation before exploratory pathway dedupe apply', () => {
    expect(parseDedupeExploratoryContactPathwaysArgs(['--apply'])).toMatchObject({
      apply: true,
      confirmExploratoryDedupeApply: false,
    });

    expect(() =>
      buildDedupeExploratoryContactPathwaysOutput(
        {
          environment: 'beta',
          db: 'Beta',
          options: {
            apply: true,
            confirmExploratoryDedupeApply: false,
            limit: 25,
          },
        },
        {
          mode: 'apply',
          plannedGroups: 1,
          plannedDuplicatePathways: 2,
        },
      ),
    ).toThrow(/--confirm-exploratory-dedupe-apply is required/);

    expect(
      parseDedupeExploratoryContactPathwaysArgs([
        '--apply',
        '--confirm-exploratory-dedupe-apply',
        '--limit=25',
      ]),
    ).toMatchObject({
      apply: true,
      confirmExploratoryDedupeApply: true,
      limit: 25,
    });
  });

  it('rejects malformed exploratory pathway dedupe arguments', () => {
    expect(() => parseDedupeExploratoryContactPathwaysArgs(['--limit=bad'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseDedupeExploratoryContactPathwaysArgs(['--max-apply=bad'])).toThrow(
      /--max-apply must be a positive integer/,
    );
    expect(() => parseDedupeExploratoryContactPathwaysArgs(['--limit=1e3'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseDedupeExploratoryContactPathwaysArgs(['--max-apply=1e3'])).toThrow(
      /--max-apply must be a positive integer/,
    );
    expect(() => parseDedupeExploratoryContactPathwaysArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseDedupeExploratoryContactPathwaysArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
  });

  it('requires explicit apply bounds before exploratory pathway dedupe apply', () => {
    expect(() =>
      assertDedupeExploratoryContactPathwaysApplyConfirmed({
        apply: true,
        confirmExploratoryDedupeApply: true,
        limit: 25,
      }),
    ).toThrow(/--limit is required/);

    expect(() =>
      assertDedupeExploratoryContactPathwaysApplyConfirmed({
        apply: true,
        confirmExploratoryDedupeApply: true,
        limit: 25,
        limitProvided: true,
      }),
    ).toThrow(/--max-apply is required/);
  });

  it('counts and caps planned exploratory pathway dedupe row changes', () => {
    const plans = [
      {
        duplicatePathwayIds: ['pathway-1', 'pathway-2'],
        relinkedAccessSignals: 3,
        relinkedContactRoutes: 4,
      },
      {
        duplicatePathwayIds: ['pathway-3'],
        relinkedAccessSignals: 0,
        relinkedContactRoutes: 1,
      },
    ];

    expect(countDedupeExploratoryContactPathwaysPlannedChanges(plans)).toBe(11);
    expect(() =>
      assertDedupeExploratoryContactPathwaysApplyConfirmed(
        {
          apply: true,
          confirmExploratoryDedupeApply: true,
          limit: 25,
          limitProvided: true,
          maxApply: 10,
        },
        11,
      ),
    ).toThrow(/Apply would modify 11 pathway-related rows, above --max-apply/);
  });

  it('writes the exploratory pathway dedupe artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-pathway-dedupe-'));
    const output = path.join(dir, 'pathway-dedupe.json');
    writeDedupeExploratoryContactPathwaysOutput(
      {
        environment: 'beta',
        db: 'Beta',
        mode: 'dry-run',
        plannedGroups: 1,
        plannedDuplicatePathways: 2,
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      environment: 'beta',
      db: 'Beta',
      mode: 'dry-run',
      plannedGroups: 1,
      plannedDuplicatePathways: 2,
    });
  });

  it('wraps pathway dedupe artifacts with freshness, target, and parsed options metadata', () => {
    expect(
      buildDedupeExploratoryContactPathwaysOutput(
        {
          environment: 'beta',
          db: 'Beta',
          options: {
            apply: false,
            confirmExploratoryDedupeApply: false,
            limit: 25,
            output: '/tmp/ylabs-dedupe-exploratory-pathways.json',
          },
        },
        {
          mode: 'dry-run',
          plannedGroups: 1,
          plannedDuplicatePathways: 2,
        },
        new Date('2026-06-01T00:00:00.000Z'),
      ),
    ).toMatchObject({
      generatedAt: '2026-06-01T00:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        confirmExploratoryDedupeApply: false,
        limit: 25,
        output: '/tmp/ylabs-dedupe-exploratory-pathways.json',
      },
      mode: 'dry-run',
      plannedGroups: 1,
      plannedDuplicatePathways: 2,
    });
  });
});
