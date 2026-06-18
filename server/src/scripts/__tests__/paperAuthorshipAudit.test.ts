import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertPaperAuthorshipAuditApplyAllowed,
  buildPaperAuthorshipAuditOutput,
  countPaperAuthorshipAuditPlannedChanges,
  normalizePaperAuthorshipAuditObjectId,
  paperAuthorshipAuditFixCommand,
  parsePaperAuthorshipAuditArgs,
  writePaperAuthorshipAuditOutput,
} from '../paperAuthorshipAudit';

describe('paperAuthorshipAudit CLI helpers', () => {
  it('rejects object-shaped ids without coercion', () => {
    const objectShapedId = {
      toString: () => '507f1f77bcf86cd799439011',
    };

    expect(normalizePaperAuthorshipAuditObjectId(objectShapedId)).toBeUndefined();
    expect(
      normalizePaperAuthorshipAuditObjectId(' 507f1f77bcf86cd799439011 ')?.toHexString(),
    ).toBe('507f1f77bcf86cd799439011');
  });

  it('parses apply, backfill, sample-limit, and output flags', () => {
    expect(
      parsePaperAuthorshipAuditArgs([
        '--apply',
        '--confirm-paper-authorship-apply',
        '--max-apply=12',
        '--no-backfill-openalex',
        '--sample-limit=10',
        '--output',
        '/tmp/ylabs-paper-authorship-audit.json',
      ]),
    ).toEqual({
      apply: true,
      confirmPaperAuthorshipApply: true,
      maxApply: 12,
      backfillOpenAlex: false,
      sampleLimit: 10,
      output: '/tmp/ylabs-paper-authorship-audit.json',
    });
  });

  it('requires explicit confirmation before paper authorship audit apply', () => {
    expect(parsePaperAuthorshipAuditArgs(['--apply'])).toMatchObject({
      apply: true,
      confirmPaperAuthorshipApply: false,
    });

    expect(() =>
      assertPaperAuthorshipAuditApplyAllowed(
        {
          apply: true,
          confirmPaperAuthorshipApply: false,
          backfillOpenAlex: true,
          sampleLimit: 20,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-paper-authorship-apply is required/);

    expect(() =>
      assertPaperAuthorshipAuditApplyAllowed(
        {
          apply: true,
          confirmPaperAuthorshipApply: true,
          backfillOpenAlex: true,
          sampleLimit: 20,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--max-apply is required/);

    expect(() =>
      assertPaperAuthorshipAuditApplyAllowed(
        {
          apply: true,
          confirmPaperAuthorshipApply: true,
          maxApply: 2,
          backfillOpenAlex: true,
          sampleLimit: 20,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
        3,
      ),
    ).toThrow(/above --max-apply/);
  });

  it('rejects ambiguous and malformed paper authorship audit arguments', () => {
    expect(() => parsePaperAuthorshipAuditArgs(['prod'])).toThrow(
      /Unknown papers:authorship-audit argument: prod/,
    );
    expect(() => parsePaperAuthorshipAuditArgs(['--sample-limit=bad'])).toThrow(
      /--sample-limit must be a non-negative integer/,
    );
    expect(() => parsePaperAuthorshipAuditArgs(['--sample-limit=1e3'])).toThrow(
      /--sample-limit must be a non-negative integer/,
    );
    expect(() => parsePaperAuthorshipAuditArgs(['--max-apply=1e3'])).toThrow(
      /--max-apply must be a positive integer/,
    );
    expect(() => parsePaperAuthorshipAuditArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parsePaperAuthorshipAuditArgs(['--output', '/var/tmp/paper-authorship-audit.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parsePaperAuthorshipAuditArgs(['--output', '/tmp/paper-authorship-audit.txt']),
    ).toThrow(/--output must point to a \.json report file/);
  });

  it('writes the paper authorship audit artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-paper-authorship-audit-'));
    const output = path.join(dir, 'paper-authorship-audit.json');
    const payload = {
      mode: 'dry-run',
      before: { total: 4 },
    };

    writePaperAuthorshipAuditOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('rejects unsafe paper authorship audit artifact writes', () => {
    expect(() =>
      writePaperAuthorshipAuditOutput({ mode: 'dry-run' }, '/var/tmp/paper-authorship-audit.json'),
    ).toThrow(/--output must write under/);
  });

  it('counts planned paper authorship apply mutations from the dry-run plan', () => {
    expect(
      countPaperAuthorshipAuditPlannedChanges(
        {
          counts: {
            activeArxivAuthorObservations: 2,
            unsupportedLegacyOrNameOnlyLinks: 3,
            invalidPaperAuthorRows: 4,
            orphanPaperAuthorRows: 5,
            duplicatePaperAuthorRows: 6,
            activeDirectAuthorFieldObservations: 7,
            unidentifiedUnlinkedPapers: 8,
            denormalizedAuthorMismatchPapers: 9,
          },
        },
        { candidates: 10, upserts: 0 },
      ),
    ).toBe(54);

    expect(
      countPaperAuthorshipAuditPlannedChanges(
        {
          counts: {
            activeArxivAuthorObservations: 2,
            unsupportedLegacyOrNameOnlyLinks: 3,
            invalidPaperAuthorRows: 4,
            orphanPaperAuthorRows: 5,
            duplicatePaperAuthorRows: 6,
            activeDirectAuthorFieldObservations: 7,
            unidentifiedUnlinkedPapers: 8,
            denormalizedAuthorMismatchPapers: 9,
          },
        },
        { candidates: 10, upserts: 0 },
        { includeBackfillOpenAlex: false },
      ),
    ).toBe(44);
  });

  it('includes the explicit confirmation flag in paper authorship fix guidance', () => {
    expect(paperAuthorshipAuditFixCommand(7)).toBe(
      'SCRAPER_ENV=beta yarn --cwd server papers:authorship-audit --apply --max-apply=7 --confirm-paper-authorship-apply',
    );
  });

  it('adds target metadata to paper authorship audit artifacts', () => {
    const payload = buildPaperAuthorshipAuditOutput(
      {
        mode: 'dry-run',
        before: { total: 4 },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          apply: false,
          confirmPaperAuthorshipApply: false,
          backfillOpenAlex: true,
          sampleLimit: 20,
          output: '/tmp/ylabs-paper-authorship-audit.json',
        },
      },
    );

    expect(payload).toMatchObject({
      mode: 'dry-run',
      before: { total: 4 },
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        confirmPaperAuthorshipApply: false,
        backfillOpenAlex: true,
        sampleLimit: 20,
        output: '/tmp/ylabs-paper-authorship-audit.json',
      },
    });
  });

  it('blocks paper authorship audit apply against production without confirmation', () => {
    expect(() =>
      assertPaperAuthorshipAuditApplyAllowed(
        {
          apply: true,
          confirmPaperAuthorshipApply: true,
          maxApply: 1,
          backfillOpenAlex: true,
          sampleLimit: 20,
        },
        {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'false',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });
});
