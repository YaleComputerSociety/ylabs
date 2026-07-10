import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertPostedOpportunityBackfillApplyAllowed,
  buildPostedOpportunityBackfillOutput,
  parsePostedOpportunityBackfillArgs,
  writePostedOpportunityBackfillOutput,
} from '../backfillPostedOpportunitiesFromListings';
import {
  assertPostedOpportunityStatusReaperApplyAllowed,
  buildPostedOpportunityStatusReaperOutput,
  parsePostedOpportunityStatusReaperArgs,
  writePostedOpportunityStatusReaperOutput,
} from '../reapPostedOpportunityStatuses';

describe('posted opportunity maintenance CLIs', () => {
  it('parses posted-opportunity backfill dry-run/apply, limit, and output flags', () => {
    expect(
      parsePostedOpportunityBackfillArgs([
        '--apply',
        '--confirm-posted-opportunity-backfill',
        '--limit=75',
        '--output',
        '/tmp/ylabs-posted-opportunity-backfill.json',
      ]),
    ).toEqual({
      dryRun: false,
      limit: 75,
      explicitLimit: true,
      confirmPostedOpportunityBackfill: true,
      output: '/tmp/ylabs-posted-opportunity-backfill.json',
    });
    expect(() => parsePostedOpportunityBackfillArgs(['prod'])).toThrow(
      /Unknown posted-opportunity backfill argument: prod/,
    );
    expect(() => parsePostedOpportunityBackfillArgs(['--limit=bad'])).toThrow(
      /--limit requires a positive integer/,
    );
    expect(() =>
      parsePostedOpportunityBackfillArgs(['--limit=9007199254740992']),
    ).toThrow(/--limit requires a positive integer/);
    expect(() => parsePostedOpportunityBackfillArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parsePostedOpportunityBackfillArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parsePostedOpportunityBackfillArgs(['--output', '/var/tmp/posted-opportunity-backfill.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parsePostedOpportunityBackfillArgs(['--output', '/tmp/posted-opportunity-backfill.txt']),
    ).toThrow(/--output must point to a \.json report file/);
  });

  it('writes the posted-opportunity backfill artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-posted-opportunity-backfill-'));
    const output = path.join(dir, 'posted-opportunity-backfill.json');
    writePostedOpportunityBackfillOutput(
      {
        dryRun: true,
        scanned: 10,
        created: 0,
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      dryRun: true,
      scanned: 10,
      created: 0,
    });
  });

  it('rejects unsafe posted-opportunity backfill artifact writes', () => {
    expect(() =>
      writePostedOpportunityBackfillOutput({ dryRun: true }, '/var/tmp/posted-opportunity.json'),
    ).toThrow(/--output must write under/);
  });

  it('adds target metadata to posted-opportunity backfill artifacts', () => {
    const payload = buildPostedOpportunityBackfillOutput(
      {
        dryRun: true,
        scanned: 10,
        created: 0,
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          dryRun: true,
          limit: 75,
          explicitLimit: true,
          confirmPostedOpportunityBackfill: false,
          output: '/tmp/ylabs-posted-opportunity-backfill.json',
        },
      },
    );

    expect(payload).toMatchObject({
      dryRun: true,
      scanned: 10,
      created: 0,
      environment: 'beta',
      db: 'Beta',
      options: {
        dryRun: true,
        limit: 75,
        explicitLimit: true,
        confirmPostedOpportunityBackfill: false,
        output: '/tmp/ylabs-posted-opportunity-backfill.json',
      },
    });
  });

  it('blocks posted-opportunity backfill apply against production without confirmation', () => {
    expect(() =>
      assertPostedOpportunityBackfillApplyAllowed(
        {
          dryRun: false,
          limit: 10,
          explicitLimit: true,
          confirmPostedOpportunityBackfill: true,
        },
        {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'false',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('requires an explicit limit before posted-opportunity backfill apply', () => {
    expect(parsePostedOpportunityBackfillArgs(['--apply'])).toMatchObject({
      dryRun: false,
      limit: 500,
      explicitLimit: false,
      confirmPostedOpportunityBackfill: false,
    });

    expect(() =>
      assertPostedOpportunityBackfillApplyAllowed(
        {
          dryRun: false,
          limit: 500,
          explicitLimit: false,
          confirmPostedOpportunityBackfill: true,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--limit is required when --apply is set/);
  });

  it('requires explicit confirmation before posted-opportunity backfill apply', () => {
    expect(() =>
      assertPostedOpportunityBackfillApplyAllowed(
        {
          dryRun: false,
          limit: 75,
          explicitLimit: true,
          confirmPostedOpportunityBackfill: false,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-posted-opportunity-backfill is required/);
  });

  it('parses posted-opportunity status reaper dry-run/apply, limit, and output flags', () => {
    expect(
      parsePostedOpportunityStatusReaperArgs([
        '--apply',
        '--confirm-posted-opportunity-status-reaper',
        '--limit=40',
        '--output=/tmp/ylabs-posted-opportunity-reaper.json',
      ]),
    ).toEqual({
      dryRun: false,
      limit: 40,
      explicitLimit: true,
      confirmPostedOpportunityStatusReaper: true,
      output: '/tmp/ylabs-posted-opportunity-reaper.json',
    });
    expect(() => parsePostedOpportunityStatusReaperArgs(['prod'])).toThrow(
      /Unknown posted-opportunity status reaper argument: prod/,
    );
    expect(() => parsePostedOpportunityStatusReaperArgs(['--limit=bad'])).toThrow(
      /--limit requires a positive integer/,
    );
    expect(() =>
      parsePostedOpportunityStatusReaperArgs(['--limit=9007199254740992']),
    ).toThrow(/--limit requires a positive integer/);
    expect(() => parsePostedOpportunityStatusReaperArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parsePostedOpportunityStatusReaperArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parsePostedOpportunityStatusReaperArgs([
        '--output',
        '/var/tmp/posted-opportunity-reaper.json',
      ]),
    ).toThrow(/--output must write under/);
    expect(() =>
      parsePostedOpportunityStatusReaperArgs(['--output', '/tmp/posted-opportunity-reaper.txt']),
    ).toThrow(/--output must point to a \.json report file/);
  });

  it('writes the posted-opportunity status reaper artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-posted-opportunity-reaper-'));
    const output = path.join(dir, 'posted-opportunity-reaper.json');
    writePostedOpportunityStatusReaperOutput(
      {
        dryRun: true,
        scanned: 5,
        expired: 1,
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      dryRun: true,
      scanned: 5,
      expired: 1,
    });
  });

  it('rejects unsafe posted-opportunity status reaper artifact writes', () => {
    expect(() =>
      writePostedOpportunityStatusReaperOutput(
        { dryRun: true },
        '/var/tmp/posted-opportunity-reaper.json',
      ),
    ).toThrow(/--output must write under/);
  });

  it('adds target metadata to posted-opportunity status reaper artifacts', () => {
    const payload = buildPostedOpportunityStatusReaperOutput(
      {
        dryRun: true,
        expiredCandidates: 5,
        closedOpportunities: 1,
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          dryRun: true,
          limit: 40,
          explicitLimit: true,
          confirmPostedOpportunityStatusReaper: false,
          output: '/tmp/ylabs-posted-opportunity-reaper.json',
        },
      },
    );

    expect(payload).toMatchObject({
      dryRun: true,
      expiredCandidates: 5,
      closedOpportunities: 1,
      environment: 'beta',
      db: 'Beta',
      options: {
        dryRun: true,
        limit: 40,
        explicitLimit: true,
        confirmPostedOpportunityStatusReaper: false,
        output: '/tmp/ylabs-posted-opportunity-reaper.json',
      },
    });
  });

  it('blocks posted-opportunity status reaper apply against production without confirmation', () => {
    expect(() =>
      assertPostedOpportunityStatusReaperApplyAllowed(
        {
          dryRun: false,
          limit: 10,
          explicitLimit: true,
          confirmPostedOpportunityStatusReaper: true,
        },
        {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'false',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('requires an explicit limit before posted-opportunity status reaper apply', () => {
    expect(parsePostedOpportunityStatusReaperArgs(['--apply'])).toMatchObject({
      dryRun: false,
      limit: 500,
      explicitLimit: false,
      confirmPostedOpportunityStatusReaper: false,
    });

    expect(() =>
      assertPostedOpportunityStatusReaperApplyAllowed(
        {
          dryRun: false,
          limit: 500,
          explicitLimit: false,
          confirmPostedOpportunityStatusReaper: true,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--limit is required when --apply is set/);
  });

  it('requires explicit confirmation before posted-opportunity status reaper apply', () => {
    expect(() =>
      assertPostedOpportunityStatusReaperApplyAllowed(
        {
          dryRun: false,
          limit: 40,
          explicitLimit: true,
          confirmPostedOpportunityStatusReaper: false,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-posted-opportunity-status-reaper is required/);
  });
});
