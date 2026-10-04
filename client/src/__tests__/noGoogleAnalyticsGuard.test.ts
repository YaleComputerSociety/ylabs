import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const CLIENT_ROOT = join(__dirname, '..', '..');
const SRC = join(CLIENT_ROOT, 'src');
const PUBLIC = join(CLIENT_ROOT, 'public');

const GOOGLE_ANALYTICS_MARKERS = [
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /analytics\.google\.com/i,
  /doubleclick\.net/i,
  /\bgtag\b/,
  /\bdataLayer\b/,
  /\bG-[A-Z0-9]{10}\b/,
];

const SCANNED_EXTENSIONS = /\.(?:html|js|mjs|ts|tsx|json|txt|svg|webmanifest)$/;

const textFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : textFiles(full);
    }
    return SCANNED_EXTENSIONS.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const shippedClientFiles = (): string[] => [
  join(CLIENT_ROOT, 'index.html'),
  ...textFiles(PUBLIC),
  ...textFiles(SRC),
];

const googleAnalyticsHits = (): string[] =>
  shippedClientFiles().flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        GOOGLE_ANALYTICS_MARKERS.some((marker) => marker.test(line))
          ? [`${relative(CLIENT_ROOT, file)}:${index + 1}`]
          : [],
      ),
  );

describe('the client ships no Google Analytics', () => {
  it('scans the entry document, the public directory and the application source', () => {
    const scanned = shippedClientFiles().map((file) => relative(CLIENT_ROOT, file));

    expect(scanned).toContain('index.html');
    expect(scanned).toContain('public/robots.txt');
    expect(scanned.some((file) => file.startsWith('src/'))).toBe(true);
  });

  it('has no Google tag loader, measurement id, gtag call or measurement host in any shipped file', () => {
    expect(googleAnalyticsHits()).toEqual([]);
  });

  it('no longer ships the GA bootstrap script', () => {
    expect(existsSync(join(PUBLIC, 'analytics.js'))).toBe(false);
  });
});
