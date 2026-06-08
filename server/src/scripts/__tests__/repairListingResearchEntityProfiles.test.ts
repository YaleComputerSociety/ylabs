import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertRepairListingResearchEntityProfilesApplyAllowed,
  buildRepairListingResearchEntityProfilesOutput,
  parseRepairListingResearchEntityProfilesArgs,
  writeRepairListingResearchEntityProfilesOutput,
} from '../repairListingResearchEntityProfiles';

describe('repairListingResearchEntityProfiles CLI helpers', () => {
  it('parses apply, limit, and output flags', () => {
    expect(
      parseRepairListingResearchEntityProfilesArgs([
        '--apply',
        '--confirm-listing-profile-repair',
        '--limit=20',
        '--output',
        '/tmp/ylabs-repair-listing-entities.json',
      ]),
    ).toEqual({
      apply: true,
      confirmListingProfileRepair: true,
      limit: 20,
      output: '/tmp/ylabs-repair-listing-entities.json',
    });
  });

  it('rejects malformed repair parser values before repair work starts', () => {
    expect(() => parseRepairListingResearchEntityProfilesArgs(['--limit=bad'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseRepairListingResearchEntityProfilesArgs(['--limit=1e3'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() =>
      parseRepairListingResearchEntityProfilesArgs(['--output', '--apply']),
    ).toThrow(/--output requires a path/);
    expect(() =>
      parseRepairListingResearchEntityProfilesArgs(['--output=--apply']),
    ).toThrow(/--output requires a path/);
  });

  it('writes the repair artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-repair-listing-entities-'));
    const output = path.join(dir, 'repair-listing-entities.json');
    const payload = {
      mode: 'dry-run',
      repairCount: 2,
      fieldCounts: { shortDescription: 2 },
    };

    writeRepairListingResearchEntityProfilesOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('wraps repair artifacts with target metadata and parsed options', () => {
    const options = {
      apply: false,
      confirmListingProfileRepair: false,
      limit: 5,
      output: '/tmp/ylabs-repair-listing-entities.json',
    };

    expect(
      buildRepairListingResearchEntityProfilesOutput(
        {
          mode: 'dry-run',
          repairCount: 2,
        },
        {
          environment: 'beta',
          db: 'Beta',
          options,
        },
      ),
    ).toEqual({
      mode: 'dry-run',
      repairCount: 2,
      environment: 'beta',
      db: 'Beta',
      options,
    });
  });

  it('requires a bounded limit before apply mode can run', () => {
    expect(() =>
      assertRepairListingResearchEntityProfilesApplyAllowed(
        {
          apply: true,
          confirmListingProfileRepair: false,
          limit: Infinity,
          output: '/tmp/ylabs-repair-listing-entities.json',
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--limit is required/);
  });

  it('requires explicit confirmation before apply mode can run', () => {
    expect(() =>
      parseRepairListingResearchEntityProfilesArgs(['--confirm-listing-profile-repair=false']),
    ).toThrow(/--confirm-listing-profile-repair does not accept a value/);

    expect(() =>
      assertRepairListingResearchEntityProfilesApplyAllowed(
        {
          apply: true,
          confirmListingProfileRepair: false,
          limit: 20,
          output: '/tmp/ylabs-repair-listing-entities.json',
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-listing-profile-repair is required/);
  });
});
