import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { describeSeedResult, parseArgs, seedHostPauseFromNotice } from '../seedHostPauseFromNotice';
import { hostPausedUntil, resetHostPauseStateForTests } from '../../scrapers/utils/hostPauseState';

// RFC 5737 reserves 192.0.2.0/24 for documentation, so this stands in for the address a real
// notice names without ever putting this machine's own address in the repository.
const SYNTHETIC_ADDRESS = '192.0.2.10';
const STATED = 'Fri, 20 Nov 2099 07:32:40 +0000';
const NOTICE = `Error 1015\nYou are being rate limited.\nYour address ${SYNTHETIC_ADDRESS} has been banned up to ${STATED}.\n`;

let directory: string;

const bodyFile = (contents: string): string => {
  const file = path.join(directory, 'notice.txt');
  fs.writeFileSync(file, contents);
  return file;
};

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylhseed-'));
});

afterEach(() => {
  resetHostPauseStateForTests();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('parseArgs', () => {
  it('reads the host and body file in either spelling, and keys the host as the pause does', () => {
    expect(parseArgs(['--host', 'WWW.Dept.Example.edu.', '--body-file', '/tmp/n.txt'])).toEqual({
      host: 'dept.example.edu',
      bodyFile: '/tmp/n.txt',
      apply: false,
    });
    expect(parseArgs(['--host=dept.example.edu', '--body-file=/tmp/n.txt', '--apply'])).toEqual({
      host: 'dept.example.edu',
      bodyFile: '/tmp/n.txt',
      apply: true,
    });
  });

  it('refuses a missing host, a missing body file, a bare flag and any other argument', () => {
    expect(() => parseArgs(['--body-file', '/tmp/n.txt'])).toThrow('--host');
    expect(() => parseArgs(['--host', 'dept.example.edu'])).toThrow('--body-file');
    expect(() => parseArgs(['--host', '--body-file', '/tmp/n.txt'])).toThrow('needs a value');
    expect(() =>
      parseArgs([
        '--host',
        'dept.example.edu',
        '--body-file',
        '/tmp/n.txt',
        '--until',
        '2099-01-01',
      ]),
    ).toThrow('Unknown argument');
  });

  it.each(['--until', '--stated-until', '--paused-until', '--date', '--retry-after', '--at'])(
    'takes no date from the operator, so %s is refused',
    (flag) => {
      const base = ['--host', 'dept.example.edu', '--body-file', '/tmp/n.txt'];
      expect(() => parseArgs([...base, flag, '2099-01-01'])).toThrow('Unknown argument');
      expect(() => parseArgs([...base, `${flag}=2099-01-01`])).toThrow('Unknown argument');
    },
  );
});

describe('seeding a host pause from a stored refusal notice', () => {
  it('plans the stated date without recording it, and records it only under --apply', async () => {
    const file = bodyFile(NOTICE);
    const host = 'dept.example.edu';

    const dry = await seedHostPauseFromNotice({ host, bodyFile: file, apply: false });
    expect(dry).toMatchObject({ host, statedUntil: new Date(STATED), applied: false });
    expect(hostPausedUntil(host)).toBeUndefined();
    expect(describeSeedResult(dry)).toBe(
      `${host}: would pause until 2099-11-20T07:32:40.000Z (dry run; pass --apply to record it)`,
    );

    const applied = await seedHostPauseFromNotice({ host, bodyFile: file, apply: true });
    expect(applied.applied).toBe(true);
    expect(hostPausedUntil(host)).toEqual(new Date(STATED));
    expect(describeSeedResult(applied)).toBe(`${host}: paused until 2099-11-20T07:32:40.000Z`);
  });

  it('records nothing when the notice states no date, or one already past', async () => {
    for (const body of [
      'Error 1015. You are being rate limited.',
      `Your address ${SYNTHETIC_ADDRESS} has been banned up to Mon, 20 Nov 2000 07:32:40 +0000.`,
    ]) {
      const result = await seedHostPauseFromNotice({
        host: 'dept.example.edu',
        bodyFile: bodyFile(body),
        apply: true,
      });

      expect(result).toEqual({ host: 'dept.example.edu', applied: false });
      expect(hostPausedUntil('dept.example.edu')).toBeUndefined();
      expect(describeSeedResult(result)).toBe(
        'dept.example.edu: the notice states no date still ahead, so nothing was recorded',
      );
    }
  });

  it('never puts any of the notice body, the address included, in what it prints', async () => {
    const result = await seedHostPauseFromNotice({
      host: 'dept.example.edu',
      bodyFile: bodyFile(NOTICE),
      apply: true,
    });

    const printed = describeSeedResult(result);
    expect(printed).not.toContain(SYNTHETIC_ADDRESS);
    expect(printed).not.toContain('rate limited');
    expect(printed).not.toContain('Error 1015');
    expect(printed).not.toContain('banned');
  });
});
