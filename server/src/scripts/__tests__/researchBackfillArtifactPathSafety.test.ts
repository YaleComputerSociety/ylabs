import { describe, expect, it } from 'vitest';

import { parseBrowseRankBackfillArgs } from '../backfillBrowseRank';
import { parseCenterDirectorsBackfillArgs } from '../backfillCenterDirectors';
import { parseFacultyWaysInBackfillArgs } from '../backfillFacultyWaysIn';
import { parseProfileBioBackfillArgs } from '../backfillProfileBiosFromOfficialUrls';
import { parseResearchDescriptionBackfillArgs } from '../backfillResearchDescriptions';
import { parseResearchHomeUrlBackfillArgs } from '../backfillResearchHomeOfficialUrls';

const parsers: Array<[string, (argv: string[]) => { output?: string }]> = [
  ['research home URL backfill', parseResearchHomeUrlBackfillArgs],
  ['research description backfill', parseResearchDescriptionBackfillArgs],
  ['profile bio backfill', parseProfileBioBackfillArgs],
  ['center directors backfill', parseCenterDirectorsBackfillArgs],
  ['faculty ways-in backfill', parseFacultyWaysInBackfillArgs],
  ['browse rank backfill', parseBrowseRankBackfillArgs],
];

describe('research/profile backfill artifact path safety', () => {
  it.each(parsers)('%s accepts safe JSON output paths', (_name, parseArgs) => {
    expect(parseArgs(['--output', '/tmp/ylabs-backfill-report.json']).output).toBe(
      '/tmp/ylabs-backfill-report.json',
    );
    expect(parseArgs(['--output=/tmp/ylabs-backfill-report.json']).output).toBe(
      '/tmp/ylabs-backfill-report.json',
    );
  });

  it.each(parsers)('%s rejects missing output paths', (_name, parseArgs) => {
    expect(() => parseArgs(['--output', '--apply'])).toThrow(/--output requires a path/);
    expect(() => parseArgs(['--output=--apply'])).toThrow(/--output requires a path/);
  });

  it.each(parsers)('%s rejects unsafe output roots', (_name, parseArgs) => {
    expect(() => parseArgs(['--output', '/var/tmp/ylabs-backfill-report.json'])).toThrow(
      /--output must write under/,
    );
  });

  it.each(parsers)('%s rejects non-JSON output paths', (_name, parseArgs) => {
    expect(() => parseArgs(['--output', '/tmp/ylabs-backfill-report.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );
  });
});
