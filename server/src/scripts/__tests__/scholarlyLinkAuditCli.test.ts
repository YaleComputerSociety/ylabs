import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertScholarlyLinkProvenanceAuditApplyAllowed,
  buildScholarlyLinkProvenanceAuditOutput,
  parseScholarlyLinkProvenanceAuditArgs,
  writeScholarlyLinkProvenanceAuditOutput,
} from '../scholarlyLinkProvenanceAudit';
import {
  assertScholarlyLinkSuppressionAuditApplyAllowed,
  buildScholarlyLinkSuppressionAuditOutput,
  buildScholarlyLinkSuppressionAuditSamples,
  parseScholarlyLinkSuppressionAuditArgs,
  writeScholarlyLinkSuppressionAuditOutput,
} from '../scholarlyLinkSuppressionAudit';

describe('scholarly link audit CLI helpers', () => {
  it('parses provenance audit apply, sample-limit, and output flags', () => {
    expect(
      parseScholarlyLinkProvenanceAuditArgs([
        '--apply',
        '--confirm-scholarly-link-apply',
        '--max-apply=7',
        '--sample-limit=0',
        '--output',
        '/tmp/ylabs-scholarly-link-provenance.json',
      ]),
    ).toEqual({
      apply: true,
      confirmScholarlyLinkApply: true,
      maxApply: 7,
      sampleLimit: 0,
      output: '/tmp/ylabs-scholarly-link-provenance.json',
    });
  });

  it('requires explicit confirmation before scholarly-link provenance apply', () => {
    expect(parseScholarlyLinkProvenanceAuditArgs(['--apply'])).toMatchObject({
      apply: true,
      confirmScholarlyLinkApply: false,
    });

    expect(() =>
      assertScholarlyLinkProvenanceAuditApplyAllowed(
        { apply: true, confirmScholarlyLinkApply: false, sampleLimit: 20 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-scholarly-link-apply is required/);

    expect(() =>
      assertScholarlyLinkProvenanceAuditApplyAllowed(
        { apply: true, confirmScholarlyLinkApply: true, sampleLimit: 20 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--max-apply is required/);

    expect(() =>
      assertScholarlyLinkProvenanceAuditApplyAllowed(
        { apply: true, confirmScholarlyLinkApply: true, sampleLimit: 20, maxApply: 2 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
        3,
      ),
    ).toThrow(/above --max-apply/);
  });

  it('rejects malformed scholarly-link provenance audit bounds', () => {
    expect(() => parseScholarlyLinkProvenanceAuditArgs(['--sample-limit=bad'])).toThrow(
      /--sample-limit must be a non-negative integer/,
    );
    expect(() => parseScholarlyLinkProvenanceAuditArgs(['--sample-limit=1e3'])).toThrow(
      /--sample-limit must be a non-negative integer/,
    );
    expect(() => parseScholarlyLinkProvenanceAuditArgs(['--max-apply=1e3'])).toThrow(
      /--max-apply must be a positive integer/,
    );
    expect(() => parseScholarlyLinkProvenanceAuditArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parseScholarlyLinkProvenanceAuditArgs([
        '--output',
        '/var/tmp/scholarly-link-provenance.json',
      ]),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseScholarlyLinkProvenanceAuditArgs([
        '--output',
        '/tmp/scholarly-link-provenance.txt',
      ]),
    ).toThrow(/--output must point to a \.json report file/);
  });

  it('writes the provenance audit artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-scholarly-link-provenance-'));
    const output = path.join(dir, 'scholarly-link-provenance.json');
    writeScholarlyLinkProvenanceAuditOutput(
      {
        mode: 'dry-run',
        applied: { nullTargetSuppressed: 0 },
        after: { pass: true },
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      mode: 'dry-run',
      applied: { nullTargetSuppressed: 0 },
      after: { pass: true },
    });
  });

  it('rejects unsafe provenance audit artifact writes', () => {
    expect(() =>
      writeScholarlyLinkProvenanceAuditOutput(
        { mode: 'dry-run' },
        '/var/tmp/scholarly-link-provenance.json',
      ),
    ).toThrow(/--output must write under/);
  });

  it('wraps provenance audit artifacts with target and parsed options metadata', () => {
    expect(
      buildScholarlyLinkProvenanceAuditOutput(
        {
          environment: 'beta',
          db: 'Beta',
          options: {
            apply: false,
            confirmScholarlyLinkApply: false,
            sampleLimit: 0,
            output: '/tmp/ylabs-scholarly-link-provenance.json',
          },
        },
        {
          mode: 'dry-run',
          applied: { nullTargetSuppressed: 0 },
          after: { pass: true },
        },
        new Date('2026-06-01T00:00:00.000Z'),
      ),
    ).toMatchObject({
      generatedAt: '2026-06-01T00:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        confirmScholarlyLinkApply: false,
        sampleLimit: 0,
        output: '/tmp/ylabs-scholarly-link-provenance.json',
      },
      mode: 'dry-run',
      after: { pass: true },
    });
  });

  it('parses suppression audit apply, sample-limit, and output flags', () => {
    expect(
      parseScholarlyLinkSuppressionAuditArgs([
        '--apply',
        '--confirm-scholarly-link-apply',
        '--max-apply=12',
        '--sample-limit=5',
        '--output=/tmp/ylabs-scholarly-link-suppression.json',
      ]),
    ).toEqual({
      apply: true,
      confirmScholarlyLinkApply: true,
      maxApply: 12,
      sampleLimit: 5,
      output: '/tmp/ylabs-scholarly-link-suppression.json',
    });
  });

  it('requires explicit confirmation before scholarly-link suppression apply', () => {
    expect(parseScholarlyLinkSuppressionAuditArgs(['--apply'])).toMatchObject({
      apply: true,
      confirmScholarlyLinkApply: false,
    });

    expect(() =>
      assertScholarlyLinkSuppressionAuditApplyAllowed(
        { apply: true, confirmScholarlyLinkApply: false, sampleLimit: 20 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-scholarly-link-apply is required/);

    expect(() =>
      assertScholarlyLinkSuppressionAuditApplyAllowed(
        { apply: true, confirmScholarlyLinkApply: true, sampleLimit: 20 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--max-apply is required/);

    expect(() =>
      assertScholarlyLinkSuppressionAuditApplyAllowed(
        { apply: true, confirmScholarlyLinkApply: true, sampleLimit: 20, maxApply: 2 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
        3,
      ),
    ).toThrow(/above --max-apply/);
  });

  it('rejects malformed scholarly-link suppression audit bounds', () => {
    expect(() => parseScholarlyLinkSuppressionAuditArgs(['--sample-limit=bad'])).toThrow(
      /--sample-limit must be a non-negative integer/,
    );
    expect(() => parseScholarlyLinkSuppressionAuditArgs(['--sample-limit=1e3'])).toThrow(
      /--sample-limit must be a non-negative integer/,
    );
    expect(() => parseScholarlyLinkSuppressionAuditArgs(['--max-apply=1e3'])).toThrow(
      /--max-apply must be a positive integer/,
    );
    expect(() => parseScholarlyLinkSuppressionAuditArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parseScholarlyLinkSuppressionAuditArgs([
        '--output',
        '/var/tmp/scholarly-link-suppression.json',
      ]),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseScholarlyLinkSuppressionAuditArgs([
        '--output',
        '/tmp/scholarly-link-suppression.txt',
      ]),
    ).toThrow(/--output must point to a \.json report file/);
  });

  it('writes the suppression audit artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-scholarly-link-suppression-'));
    const output = path.join(dir, 'scholarly-link-suppression.json');
    writeScholarlyLinkSuppressionAuditOutput(
      {
        mode: 'dry-run',
        counts: { datasetSuppressibleBefore: 0, duplicateLinksBefore: 0 },
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      mode: 'dry-run',
      counts: { datasetSuppressibleBefore: 0, duplicateLinksBefore: 0 },
    });
  });

  it('rejects unsafe suppression audit artifact writes', () => {
    expect(() =>
      writeScholarlyLinkSuppressionAuditOutput(
        { mode: 'dry-run' },
        '/var/tmp/scholarly-link-suppression.json',
      ),
    ).toThrow(/--output must write under/);
  });

  it('builds reviewable suppression audit samples for each planned action', () => {
    expect(
      buildScholarlyLinkSuppressionAuditSamples(
        {
          datasetRows: [
            {
              _id: 'dataset-1',
              title: 'Data from Example Study',
              url: 'https://doi.org/10.17632/example',
              venue: 'Mendeley Data',
              displaySource: 'Mendeley Data',
              externalIds: { doi: '10.17632/example' },
            },
          ],
          htmlTitleRows: [
            {
              _id: 'html-1',
              title: '<i>Useful Paper</i> &amp; More',
            },
          ],
          duplicateGroups: [
            {
              ownerId: 'entity-1',
              field: 'url',
              value: 'https://example.test/paper',
              count: 2,
              keptLink: {
                _id: 'duplicate-kept',
                title: 'Example Paper',
                url: 'https://example.test/paper',
                displaySource: 'OpenAlex',
                confidence: 0.9,
              },
              suppressedLinks: [
                {
                  _id: 'duplicate-1',
                  title: 'Example Paper',
                  url: 'https://example.test/paper',
                  displaySource: 'OpenAlex',
                  confidence: 0.7,
                },
                {
                  _id: 'duplicate-2',
                  title: 'Example Paper',
                  url: 'https://example.test/paper',
                  displaySource: 'OpenAlex',
                  confidence: 0.6,
                },
              ],
            },
          ],
          duplicateLoserIds: ['duplicate-1', 'duplicate-2'],
        },
        1,
      ),
    ).toEqual({
      datasetLikeLinks: [
        {
          id: 'dataset-1',
          title: 'Data from Example Study',
          url: 'https://doi.org/10.17632/example',
          venue: 'Mendeley Data',
          displaySource: 'Mendeley Data',
          externalIds: { doi: '10.17632/example' },
        },
      ],
      htmlTitleRows: [
        {
          id: 'html-1',
          title: '<i>Useful Paper</i> &amp; More',
          repairedTitle: 'Useful Paper & More',
        },
      ],
      duplicateLinkIds: ['duplicate-1'],
      duplicateLinkGroups: [
        {
          ownerId: 'entity-1',
          field: 'url',
          value: 'https://example.test/paper',
          count: 2,
          keptLink: {
            id: 'duplicate-kept',
            title: 'Example Paper',
            url: 'https://example.test/paper',
            displaySource: 'OpenAlex',
            confidence: 0.9,
          },
          suppressedLinks: [
            {
              id: 'duplicate-1',
              title: 'Example Paper',
              url: 'https://example.test/paper',
              displaySource: 'OpenAlex',
              confidence: 0.7,
            },
          ],
        },
      ],
    });
  });

  it('wraps suppression audit artifacts with target and parsed options metadata', () => {
    expect(
      buildScholarlyLinkSuppressionAuditOutput(
        {
          environment: 'beta',
          db: 'Beta',
          options: {
            apply: false,
            confirmScholarlyLinkApply: false,
            sampleLimit: 5,
            output: '/tmp/ylabs-scholarly-link-suppression.json',
          },
        },
        {
          mode: 'dry-run',
          counts: { datasetSuppressibleBefore: 0, duplicateLinksBefore: 0 },
        },
        new Date('2026-06-01T00:00:00.000Z'),
      ),
    ).toMatchObject({
      generatedAt: '2026-06-01T00:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        confirmScholarlyLinkApply: false,
        sampleLimit: 5,
        output: '/tmp/ylabs-scholarly-link-suppression.json',
      },
      mode: 'dry-run',
      counts: { datasetSuppressibleBefore: 0, duplicateLinksBefore: 0 },
    });
  });

  it('targets suppression repair commands at Beta when saved artifacts recommend an apply', () => {
    expect(
      buildScholarlyLinkSuppressionAuditOutput(
        {
          environment: 'beta',
          db: 'Beta',
          options: {
            apply: false,
            confirmScholarlyLinkApply: false,
            sampleLimit: 5,
            output: '/tmp/ylabs-scholarly-link-suppression.json',
          },
        },
        {
          mode: 'dry-run',
          counts: { datasetSuppressibleBefore: 1, duplicateLinksBefore: 0 },
          fixCommand:
            'yarn --cwd server scholarly-links:suppression-audit --apply --max-apply=1',
        },
        new Date('2026-06-01T00:00:00.000Z'),
      ),
    ).toMatchObject({
      fixCommand:
        'SCRAPER_ENV=beta yarn --cwd server scholarly-links:suppression-audit --apply --max-apply=1 --confirm-scholarly-link-apply',
    });
  });
});
