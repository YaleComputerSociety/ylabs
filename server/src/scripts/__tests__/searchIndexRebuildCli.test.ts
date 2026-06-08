import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertRebuildPathwaySearchIndexAllowed,
  buildRebuildPathwaySearchIndexOutput,
  parseRebuildPathwaySearchIndexArgs,
  writeRebuildPathwaySearchIndexOutput,
} from '../rebuildPathwaySearchIndex';
import {
  assertRebuildResearchEntitySearchIndexAllowed,
  buildRebuildResearchEntitySearchIndexOutput,
  parseRebuildResearchEntitySearchIndexArgs,
  writeRebuildResearchEntitySearchIndexOutput,
} from '../rebuildResearchEntitySearchIndex';

describe('search index rebuild CLI helpers', () => {
  it('parses pathway index rebuild clear, page-size, and output flags', () => {
    expect(
      parseRebuildPathwaySearchIndexArgs([
        '--clear',
        '--page-size=50',
        '--confirm-meili-rebuild',
        '--output',
        '/tmp/ylabs-rebuild-pathways.json',
      ]),
    ).toEqual({
      clearExisting: true,
      confirmMeiliRebuild: true,
      pageSize: 50,
      output: '/tmp/ylabs-rebuild-pathways.json',
    });
    expect(() => parseRebuildPathwaySearchIndexArgs(['prod'])).toThrow(
      /Unknown pathway search index rebuild argument: prod/,
    );
    expect(() => parseRebuildPathwaySearchIndexArgs(['--page-size=bad'])).toThrow(
      /--page-size requires a positive integer/,
    );
    expect(() =>
      parseRebuildPathwaySearchIndexArgs(['--page-size=9007199254740992']),
    ).toThrow(/--page-size requires a positive integer/);
    expect(() => parseRebuildPathwaySearchIndexArgs(['--output', '--clear'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseRebuildPathwaySearchIndexArgs(['--output=--clear'])).toThrow(
      /--output requires a path/,
    );
  });

  it('writes the pathway index rebuild artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-rebuild-pathways-'));
    const output = path.join(dir, 'rebuild-pathways.json');
    const payload = { indexed: 12, pages: 2 };

    writeRebuildPathwaySearchIndexOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('wraps pathway index rebuild artifacts with target metadata and parsed options', () => {
    const output = buildRebuildPathwaySearchIndexOutput(
      { indexedDocumentCount: 12, pageCount: 2 },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          clearExisting: true,
          confirmMeiliRebuild: true,
          pageSize: 50,
          output: '/tmp/ylabs-rebuild-pathways.json',
        },
      },
    );

    expect(output).toEqual({
      indexedDocumentCount: 12,
      pageCount: 2,
      environment: 'beta',
      db: 'Beta',
      options: {
        clearExisting: true,
        confirmMeiliRebuild: true,
        pageSize: 50,
        output: '/tmp/ylabs-rebuild-pathways.json',
      },
    });
  });

  it('requires production confirmation before pathway index rebuild writes', () => {
    expect(() =>
      assertRebuildPathwaySearchIndexAllowed({
        env: { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        mongoUrl: 'mongodb://example.test/Beta',
        confirmMeiliRebuild: false,
      }),
    ).toThrow(/--confirm-meili-rebuild is required/);
    expect(() =>
      assertRebuildPathwaySearchIndexAllowed({
        env: { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        mongoUrl: 'mongodb://example.test/Beta',
        confirmMeiliRebuild: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertRebuildPathwaySearchIndexAllowed({
        env: { SCRAPER_ENV: 'production' } as NodeJS.ProcessEnv,
        mongoUrl: 'mongodb://example.test/Production',
        confirmMeiliRebuild: true,
      }),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('parses research entity index rebuild clear, page-size, and output flags', () => {
    expect(
      parseRebuildResearchEntitySearchIndexArgs([
        '--clear',
        '--page-size=75',
        '--confirm-meili-rebuild',
        '--output=/tmp/ylabs-rebuild-research-entities.json',
      ]),
    ).toEqual({
      clearExisting: true,
      confirmMeiliRebuild: true,
      pageSize: 75,
      output: '/tmp/ylabs-rebuild-research-entities.json',
    });
    expect(() => parseRebuildResearchEntitySearchIndexArgs(['prod'])).toThrow(
      /Unknown research entity search index rebuild argument: prod/,
    );
    expect(() => parseRebuildResearchEntitySearchIndexArgs(['--page-size=bad'])).toThrow(
      /--page-size requires a positive integer/,
    );
    expect(() =>
      parseRebuildResearchEntitySearchIndexArgs(['--page-size=9007199254740992']),
    ).toThrow(/--page-size requires a positive integer/);
    expect(() => parseRebuildResearchEntitySearchIndexArgs(['--output', '--clear'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseRebuildResearchEntitySearchIndexArgs(['--output=--clear'])).toThrow(
      /--output requires a path/,
    );
  });

  it('writes the research entity index rebuild artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-rebuild-research-entities-'));
    const output = path.join(dir, 'rebuild-research-entities.json');
    const payload = { indexed: 25, pages: 1 };

    writeRebuildResearchEntitySearchIndexOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('wraps research entity index rebuild artifacts with target metadata and parsed options', () => {
    const output = buildRebuildResearchEntitySearchIndexOutput(
      { indexedDocumentCount: 25, pageCount: 1 },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          clearExisting: true,
          confirmMeiliRebuild: true,
          pageSize: 75,
          output: '/tmp/ylabs-rebuild-research-entities.json',
        },
      },
    );

    expect(output).toEqual({
      indexedDocumentCount: 25,
      pageCount: 1,
      environment: 'beta',
      db: 'Beta',
      options: {
        clearExisting: true,
        confirmMeiliRebuild: true,
        pageSize: 75,
        output: '/tmp/ylabs-rebuild-research-entities.json',
      },
    });
  });

  it('requires production confirmation before research entity index rebuild writes', () => {
    expect(() =>
      assertRebuildResearchEntitySearchIndexAllowed({
        env: { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        mongoUrl: 'mongodb://example.test/Beta',
        confirmMeiliRebuild: false,
      }),
    ).toThrow(/--confirm-meili-rebuild is required/);
    expect(() =>
      assertRebuildResearchEntitySearchIndexAllowed({
        env: { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        mongoUrl: 'mongodb://example.test/Beta',
        confirmMeiliRebuild: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertRebuildResearchEntitySearchIndexAllowed({
        env: { SCRAPER_ENV: 'production' } as NodeJS.ProcessEnv,
        mongoUrl: 'mongodb://example.test/Production',
        confirmMeiliRebuild: true,
      }),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });
});
