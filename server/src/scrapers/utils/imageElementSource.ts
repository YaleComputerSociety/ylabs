import type * as cheerio from 'cheerio';

function firstImageUrlFromSrcset(value: string | undefined | null): string | undefined {
  const first = String(value || '')
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .find(Boolean);
  return first || undefined;
}

export function imageElementSource(node: cheerio.Cheerio<any>): string {
  const img = node.find('img').first();
  if (!img.length) return '';
  return (
    img.attr('src') ||
    img.attr('data-src') ||
    firstImageUrlFromSrcset(img.attr('srcset')) ||
    firstImageUrlFromSrcset(img.attr('data-srcset')) ||
    ''
  );
}
