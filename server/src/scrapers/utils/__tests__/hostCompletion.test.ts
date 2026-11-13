import { describe, expect, it } from 'vitest';

import { HostCompletionTracker, orderRowsByHostCompletion, plannedHosts } from '../hostCompletion';

const planned = (row: string, ...urls: string[]) => ({ row, hosts: plannedHosts(urls) });

describe('plannedHosts', () => {
  it('keys hosts the way the fetch path names a host lease', () => {
    expect([
      ...plannedHosts(['https://WWW.Example.edu/a', 'https://www.example.edu/b', 'not a url']),
    ]).toEqual(['www.example.edu']);
  });
});

describe('orderRowsByHostCompletion', () => {
  it('runs every row on the most shared host first and keeps incoming order within a host', () => {
    const ordered = orderRowsByHostCompletion([
      planned('a', 'https://lab-a.example.edu/'),
      planned('b', 'https://shared.example.edu/b', 'https://lab-b.example.edu/'),
      planned('c', 'https://lab-c.example.edu/'),
      planned('d', 'https://shared.example.edu/d'),
      planned('e'),
    ]);

    expect(ordered.map(({ row }) => row)).toEqual(['b', 'd', 'a', 'c', 'e']);
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
