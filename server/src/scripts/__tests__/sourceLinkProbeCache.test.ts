import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  SOURCE_LINK_PROBE_CACHE_RETENTION_MS,
  readSourceLinkProbeCache,
  writeSourceLinkProbeCache,
} from '../sourceLinkProbeCache';

const tempFile = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'probe-cache-unit-')), 'nested', 'probes.json');

describe('source link probe cache', () => {
  it('reads a missing or unreadable file as empty', () => {
    const file = tempFile();
    expect(readSourceLinkProbeCache(file).size).toBe(0);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not json');
    expect(readSourceLinkProbeCache(file).size).toBe(0);
  });

  it('skips malformed entries', () => {
    const file = tempFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        'https://a.example.edu/': { health: { healthStatus: 'HEALTHY' }, probedAt: 'not a date' },
        'https://b.example.edu/': { probedAt: new Date().toISOString() },
        'https://c.example.edu/': {
          health: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
          probedAt: new Date().toISOString(),
        },
      }),
    );
    expect([...readSourceLinkProbeCache(file).keys()]).toEqual(['https://c.example.edu/']);
  });

  it('merges new probes over stored ones and drops entries past retention', () => {
    const file = tempFile();
    const now = new Date();
    const expired = new Date(now.getTime() - SOURCE_LINK_PROBE_CACHE_RETENTION_MS - 1);
    writeSourceLinkProbeCache(
      file,
      new Map([
        [
          'https://old.example.edu/',
          { health: { healthStatus: 'HEALTHY' } as any, probedAt: expired.toISOString() },
        ],
        [
          'https://kept.example.edu/',
          { health: { healthStatus: 'HEALTHY' } as any, probedAt: now.toISOString() },
        ],
      ]),
      expired,
    );
    writeSourceLinkProbeCache(
      file,
      new Map([
        [
          'https://kept.example.edu/',
          { health: { healthStatus: 'UNAVAILABLE' } as any, probedAt: now.toISOString() },
        ],
      ]),
      now,
    );
    const cache = readSourceLinkProbeCache(file);
    expect([...cache.keys()]).toEqual(['https://kept.example.edu/']);
    expect(cache.get('https://kept.example.edu/')?.health.healthStatus).toBe('UNAVAILABLE');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['probes.json']);
  });

  it('keeps the cache owner-only, tightening a file left readable by others', () => {
    const file = tempFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{}', { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    writeSourceLinkProbeCache(
      file,
      new Map([
        [
          'https://a.example.edu/',
          { health: { healthStatus: 'HEALTHY' } as any, probedAt: new Date().toISOString() },
        ],
      ]),
    );
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    const fresh = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'probe-cache-dir-')),
      'ylabs',
      'probes.json',
    );
    writeSourceLinkProbeCache(
      fresh,
      new Map([
        [
          'https://a.example.edu/',
          { health: { healthStatus: 'HEALTHY' } as any, probedAt: new Date().toISOString() },
        ],
      ]),
    );
    expect(fs.statSync(path.dirname(fresh)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(fresh).mode & 0o777).toBe(0o600);
  });
});
