import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertAcceptedInputsApplyAllowed,
  buildAcceptedInputsOutput,
  parseAcceptedInputsArgs,
  writeAcceptedInputsOutput,
} from '../acceptedInputs';
import {
  resolveSafeAcceptedInputPath,
  resolveSafeAcceptedInputRoot,
} from '../../acceptedInputs/fellowshipInputs';

describe('acceptedInputs CLI helpers', () => {
  it('parses status command, root, limit, and output flags', () => {
    expect(
      parseAcceptedInputsArgs([
        'status',
        '--root',
        '/tmp/accepted',
        '--output',
        '/tmp/accepted-status.json',
        '--limit=25',
      ]),
    ).toEqual({
      command: 'status',
      root: '/tmp/accepted',
      dryRun: true,
      apply: false,
      confirmAcceptedInputsApply: false,
      limit: 25,
      output: '/tmp/accepted-status.json',
    });
  });

  it('rejects malformed accepted-inputs arguments', () => {
    expect(() => parseAcceptedInputsArgs(['status', '--limit=bad'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseAcceptedInputsArgs(['status', '--limit=1e3'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseAcceptedInputsArgs(['status', 'prod'])).toThrow(
      /Unknown argument: prod/,
    );
    expect(() => parseAcceptedInputsArgs(['status', '--output', '--apply'])).toThrow(
      /--output requires a value/,
    );
    expect(() => parseAcceptedInputsArgs(['status', '--output=--apply'])).toThrow(
      /--output requires a value/,
    );
    expect(() => parseAcceptedInputsArgs(['status', '--root=--apply'])).toThrow(
      /--root requires a value/,
    );
    expect(() => parseAcceptedInputsArgs(['import-programs', '--input=--apply'])).toThrow(
      /--input requires a value/,
    );
    expect(() => parseAcceptedInputsArgs(['status', '--program=--apply'])).toThrow(
      /--program requires a value/,
    );
  });

  it('writes the accepted-inputs artifact when output is provided', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-accepted-inputs-'));
    const output = path.join(dir, 'accepted-inputs.json');

    await writeAcceptedInputsOutput({ status: 'ok', entries: 2 }, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual({ status: 'ok', entries: 2 });
  });

  it('rejects unsafe accepted-inputs JSON artifact writes from programmatic callers', async () => {
    await expect(writeAcceptedInputsOutput({ status: 'ok' }, '/etc/accepted-inputs.json')).rejects.toThrow(
      /--output must write under/,
    );
  });

  it('rejects accepted-input CSV and TXT paths outside safe artifact roots', () => {
    expect(resolveSafeAcceptedInputRoot('/tmp/ylabs-accepted')).toBe('/tmp/ylabs-accepted');
    expect(resolveSafeAcceptedInputPath('/tmp/ylabs-accepted/input.csv', '--input')).toBe(
      '/tmp/ylabs-accepted/input.csv',
    );
    expect(() => resolveSafeAcceptedInputRoot('/etc/ylabs-accepted')).toThrow(
      /--root must stay under/,
    );
    expect(() => resolveSafeAcceptedInputPath('/etc/ylabs-accepted/input.csv', '--input')).toThrow(
      /--input must stay under/,
    );
    expect(() => resolveSafeAcceptedInputPath('/tmp/ylabs-accepted/report.json', '--input')).toThrow(
      /must point to a \.csv or \.txt/,
    );
  });

  it('adds target metadata to accepted-inputs JSON artifacts', () => {
    const payload = buildAcceptedInputsOutput(
      { status: 'ok', entries: 2 },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          command: 'status',
          root: '/tmp/accepted',
          dryRun: true,
          apply: false,
          confirmAcceptedInputsApply: false,
          limit: 25,
          output: '/tmp/accepted-status.json',
        },
      },
    );

    expect(payload).toEqual({
      status: 'ok',
      entries: 2,
      environment: 'beta',
      db: 'Beta',
      options: {
        command: 'status',
        root: '/tmp/accepted',
        dryRun: true,
        apply: false,
        confirmAcceptedInputsApply: false,
        limit: 25,
        output: '/tmp/accepted-status.json',
      },
    });
  });

  it('blocks accepted-inputs apply against production without confirmation', () => {
    expect(() =>
      assertAcceptedInputsApplyAllowed(
        {
          command: 'scholar:apply',
          root: '/tmp/accepted',
          dryRun: false,
          apply: true,
          confirmAcceptedInputsApply: true,
          limit: Infinity,
        },
        {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'false',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('requires explicit confirmation before supported accepted-inputs apply', () => {
    expect(
      parseAcceptedInputsArgs([
        'scholar:apply',
        '--apply',
        '--confirm-accepted-inputs-apply',
        '--input=/tmp/accepted.csv',
      ]),
    ).toMatchObject({
      command: 'scholar:apply',
      apply: true,
      dryRun: false,
      confirmAcceptedInputsApply: true,
      input: '/tmp/accepted.csv',
    });

    expect(() =>
      assertAcceptedInputsApplyAllowed(
        {
          command: 'scholar:apply',
          root: '/tmp/accepted',
          dryRun: false,
          apply: true,
          confirmAcceptedInputsApply: false,
          limit: Infinity,
        },
        {
          SCRAPER_ENV: 'beta',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-accepted-inputs-apply is required/);
  });

  it('rejects --apply on accepted-inputs commands without apply semantics', () => {
    expect(() =>
      assertAcceptedInputsApplyAllowed(
        {
          command: 'fellowship:candidates',
          root: '/tmp/accepted',
          dryRun: false,
          apply: true,
          confirmAcceptedInputsApply: false,
          limit: Infinity,
        },
        {
          SCRAPER_ENV: 'beta',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/does not support --apply/);
  });
});
