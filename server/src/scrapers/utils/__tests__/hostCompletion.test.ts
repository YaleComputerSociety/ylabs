import { describe, expect, it } from 'vitest';

import {
  HostCompletionTracker,
  orderRowsBySmallestSharedHost,
  plannedHosts,
} from '../hostCompletion';

const planned = (row: string, ...urls: string[]) => ({ row, hosts: plannedHosts(urls) });

describe('plannedHosts', () => {
  it('keys hosts the way the fetch path names a host lease', () => {
    expect([
      ...plannedHosts(['https://WWW.Example.edu/a', 'https://www.example.edu/b', 'not a url']),
    ]).toEqual(['www.example.edu']);
  });
});

describe('orderRowsBySmallestSharedHost', () => {
  it('runs unshared rows first, then each shared host as one group, smallest first', () => {
    const ordered = orderRowsBySmallestSharedHost([
      planned('big-1', 'https://big.example.edu/1', 'https://lab-1.example.org/'),
      planned('small-and-big', 'https://small.example.edu/a', 'https://big.example.edu/2'),
      planned('alone', 'https://lab-2.example.org/'),
      planned('big-3', 'https://big.example.edu/3'),
      planned('small-only', 'https://small.example.edu/b'),
      planned('no-hosts'),
    ]);

    expect(ordered.map(({ row }) => row)).toEqual([
      'alone',
      'no-hosts',
      'small-and-big',
      'small-only',
      'big-1',
      'big-3',
    ]);
  });

  it('finishes the smaller shared host before the larger one starts its own group', async () => {
    const rows = orderRowsBySmallestSharedHost([
      planned('big-1', 'https://big.example.edu/1'),
      planned('small-1', 'https://small.example.edu/1'),
      planned('big-2', 'https://big.example.edu/2'),
      planned('small-2', 'https://small.example.edu/2'),
      planned('big-3', 'https://big.example.edu/3'),
    ]);
    const released: Array<[string, number]> = [];
    let finished = 0;
    const tracker = new HostCompletionTracker(rows, async (host) => {
      released.push([host, finished]);
    });

    for (const { hosts } of rows) {
      finished += 1;
      tracker.rowFinished(hosts);
    }
    await tracker.settled();

    expect(released).toEqual([
      ['small.example.edu', 2],
      ['big.example.edu', 5],
    ]);
  });
});

describe('HostCompletionTracker', () => {
  it('releases a host only once its last planned row finishes', async () => {
    const released: string[] = [];
    const rows = [
      planned('a', 'https://shared.example.edu/a', 'https://lab-a.example.edu/'),
      planned('b', 'https://shared.example.edu/b'),
    ];
    const tracker = new HostCompletionTracker(rows, async (host) => {
      released.push(host);
    });

    tracker.rowFinished(rows[0].hosts);
    expect(released).toEqual(['lab-a.example.edu']);

    tracker.rowFinished(rows[1].hosts);
    await tracker.settled();
    expect(released).toEqual(['lab-a.example.edu', 'shared.example.edu']);
  });

  it('a failed release does not fail the run', async () => {
    const rows = [planned('a', 'https://lab-a.example.edu/')];
    const tracker = new HostCompletionTracker(rows, async () => {
      throw new Error('lease store unreachable');
    });

    tracker.rowFinished(rows[0].hosts);
    await expect(tracker.settled()).resolves.toBeUndefined();
  });
});
