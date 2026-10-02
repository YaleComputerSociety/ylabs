import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

const CLIENT_ROOT = join(__dirname, '..', '..');
const SITE_ORIGIN = 'https://yalelabs.io';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CONTENT_HASHED_ASSET_PATH = /^\/assets\/[^/]+-([A-Za-z0-9_-]{8})\.png$/;
const MAX_SHARE_IMAGE_BYTES = 300 * 1024;

const shareTags = (): Map<string, string> => {
  const document = new DOMParser().parseFromString(
    readFileSync(join(CLIENT_ROOT, 'index.html'), 'utf8'),
    'text/html',
  );
  const tags = new Map<string, string>();
  for (const meta of document.head.querySelectorAll('meta[content]')) {
    const key = meta.getAttribute('property') ?? meta.getAttribute('name');
    if (key && /^(og|twitter):/.test(key)) {
      tags.set(key, meta.getAttribute('content') ?? '');
    }
  }
  return tags;
};

const pngDimensions = (png: Buffer) => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
});

describe('shared link preview tags', () => {
  const tags = shareTags();
  const imageUrl = new URL(tags.get('og:image') ?? '', SITE_ORIGIN);

  it('declares a large image card with the image size, type, and alt text', () => {
    expect(tags.get('og:image')).toBe(imageUrl.href);
    expect(imageUrl.origin).toBe(SITE_ORIGIN);
    expect(tags.get('og:image:type')).toBe('image/png');
    expect(tags.get('og:image:width')).toBe('1200');
    expect(tags.get('og:image:height')).toBe('630');
    expect(tags.get('og:image:alt')).toMatch(/\S/);
    expect(tags.get('twitter:card')).toBe('summary_large_image');
    expect(tags.get('twitter:image')).toBe(imageUrl.href);
    expect(tags.get('twitter:image:alt')).toBe(tags.get('og:image:alt'));
  });

  it('names a content-hashed png that matches the declared size', () => {
    const hashedName = imageUrl.pathname.match(CONTENT_HASHED_ASSET_PATH);
    expect(hashedName, `${imageUrl.pathname} is not a content-hashed png asset`).not.toBeNull();

    const imagePath = join(CLIENT_ROOT, 'public', imageUrl.pathname);
    expect(existsSync(imagePath), `${imagePath} does not exist`).toBe(true);
    const png = readFileSync(imagePath);

    expect(png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)).toBe(true);
    expect(pngDimensions(png)).toEqual({
      width: Number(tags.get('og:image:width')),
      height: Number(tags.get('og:image:height')),
    });
    expect(png.length).toBeLessThan(MAX_SHARE_IMAGE_BYTES);
    expect(createHash('sha256').update(png).digest('hex').slice(0, 8)).toBe(hashedName?.[1]);
  });
});
