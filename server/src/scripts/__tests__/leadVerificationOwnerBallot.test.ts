import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseLaneScorecardArgs, resolveLeadBallotDirectory } from '../laneScorecard';
import {
  parseOwnerLeadBallot,
  readOwnerLeadBallot,
  type LeadBallotKey,
} from '../leadVerificationOwnerBallot';

const key: LeadBallotKey = {
  benchmarkId: 'synthetic-lead-benchmark',
  seed: 'seed-1',
  items: [
    { item: 1, entityKey: 'row-b', personId: 'p-2' },
    { item: 2, entityKey: 'row-a', personId: 'p-1' },
    { item: 3, entityKey: 'row-c', personId: 'p-3' },
  ],
};

const item = (n: number, verdictLine: string) =>
  `## Item ${n}\n\nRow: Synthetic row\nCandidate lead: Synthetic person\n\n${verdictLine}\nNote:\n`;

const blank = "Verdict: [ ] correct lead  [ ] not the lead  [ ] can't tell";

describe('parseOwnerLeadBallot', () => {
  it('reads one marked box per item and leaves an unmarked item unlabelled', () => {
    const ballot = [
      '# Ballot',
      item(1, "Verdict: [x] correct lead  [ ] not the lead  [ ] can't tell"),
      item(2, "Verdict: [ ] correct lead  [X] not the lead  [ ] can't tell"),
      item(3, blank),
    ].join('\n');
    expect(parseOwnerLeadBallot(ballot, key)).toEqual({
      benchmarkId: 'synthetic-lead-benchmark',
      items: 3,
      marked: 2,
      unmarked: [3],
      labels: [
        { entityKey: 'row-b', personId: 'p-2', ownerVerdict: 'correct_lead' },
        { entityKey: 'row-a', personId: 'p-1', ownerVerdict: 'not_the_lead' },
      ],
    });
  });

  it('refuses an item that marks two verdicts', () => {
    const ballot = [
      item(1, "Verdict: [x] correct lead  [x] not the lead  [ ] can't tell"),
      item(2, blank),
      item(3, blank),
    ].join('\n');
    expect(() => parseOwnerLeadBallot(ballot, key)).toThrow(/item 1 marks more than one/);
  });

  it('refuses a ballot missing a keyed item or carrying an unkeyed one', () => {
    expect(() => parseOwnerLeadBallot([item(1, blank), item(2, blank)].join('\n'), key)).toThrow(
      /missing item 3/,
    );
    expect(() =>
      parseOwnerLeadBallot(
        [item(1, blank), item(2, blank), item(3, blank), item(4, blank)].join('\n'),
        key,
      ),
    ).toThrow(/item 4 is not in the key/);
  });

  it('refuses an edited Verdict line that dropped a box', () => {
    const ballot = [item(1, 'Verdict: [x] correct lead'), item(2, blank), item(3, blank)].join(
      '\n',
    );
    expect(() => parseOwnerLeadBallot(ballot, key)).toThrow(/no "not the lead" box/);
  });

  it('reads the ballot and its key from one directory', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-ballot-'));
    fs.writeFileSync(path.join(directory, 'key.json'), JSON.stringify(key));
    fs.writeFileSync(
      path.join(directory, 'ballot.md'),
      [
        item(1, blank),
        item(2, blank),
        item(3, "Verdict: [ ] correct lead  [x] not the lead  [ ] can't tell"),
      ].join('\n'),
    );
    expect(readOwnerLeadBallot(directory).labels).toEqual([
      { entityKey: 'row-c', personId: 'p-3', ownerVerdict: 'not_the_lead' },
    ]);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe('--lead-ballot', () => {
  it('reads a ballot directory outside the repository', () => {
    expect(parseLaneScorecardArgs([`--lead-ballot=${os.tmpdir()}/ballot`]).leadBallot).toBe(
      path.resolve(os.tmpdir(), 'ballot'),
    );
  });

  it('refuses a ballot inside the repository, because it names people', () => {
    expect(() => resolveLeadBallotDirectory('/repo/tmp/ballot', '/repo')).toThrow(
      /outside the repository/,
    );
    expect(() => resolveLeadBallotDirectory('/repo', '/repo')).toThrow(/outside the repository/);
    expect(resolveLeadBallotDirectory('/elsewhere/ballot', '/repo')).toBe('/elsewhere/ballot');
  });
});
