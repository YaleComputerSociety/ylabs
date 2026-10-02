import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

const SOCIAL_PLATFORM_HOST =
  /(?:^|\.)(?:twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|youtu\.be|tiktok\.com|threads\.net|bsky\.app|bsky\.social|mastodon\.social|flickr\.com|vimeo\.com|pinterest\.com)$/i;

const FOLLOW_CALL_TEXT =
  /^(?:(?:follow|connect with|share|tag) us\b.{0,40}|(?:follow us on |our )?social(?: media)?(?: links| channels| accounts)?)[.!:]?$/i;

const FOLLOW_LINK_TEXT =
  /^(?:|@\S+|(?:(?:follow|find|visit|connect with)(?: us)?(?: on)? |our )?(?:twitter|x|facebook|instagram|linkedin|youtube|tiktok|threads|bluesky|bsky|mastodon|flickr|vimeo|pinterest)(?: (?:icon|page|profile|channel|account))?)$/i;

const LABEL_ELEMENT_SELECTOR =
  'h1, h2, h3, h4, h5, h6, dt, legend, [class*="heading"], [class*="title"], [class*="eyebrow"], [class*="label"]';

const MAX_FOLLOW_BLOCK_TEXT = 200;

const collapsedText = (value: string): string => value.replace(/\s+/g, ' ').trim();

function isSocialPlatformHref(href: string | undefined): boolean {
  if (!href) return false;
  try {
    return SOCIAL_PLATFORM_HOST.test(new URL(href, 'https://placeholder.invalid').hostname);
  } catch {
    return false;
  }
}

function ownTextOutsideLinks($: CheerioAPI, el: Element): string {
  const clone = $(el).clone();
  clone.find('a').remove();
  return collapsedText(clone.text());
}

function isFollowLink($: CheerioAPI, link: Element): boolean {
  const label = collapsedText($(link).text());
  return isSocialPlatformHref($(link).attr('href')) && FOLLOW_LINK_TEXT.test(label);
}

function containsFollowLink($: CheerioAPI, el: Element): boolean {
  return $(el)
    .find('a[href]')
    .toArray()
    .some((link) => isFollowLink($, link));
}

function isSocialLinkBlock($: CheerioAPI, el: Element): boolean {
  const links = $(el).find('a[href]').toArray();
  if (links.length === 0 || !links.every((link) => isFollowLink($, link))) return false;
  const ownText = ownTextOutsideLinks($, el);
  return ownText === '' || FOLLOW_CALL_TEXT.test(ownText);
}

function removeSocialFollowBlocks($: CheerioAPI): void {
  for (const link of $('a[href]').toArray()) {
    if (!isFollowLink($, link) || !link.parent) continue;
    let block: Element | null = null;
    for (const ancestor of $(link).parents().toArray()) {
      if (ancestor.name === 'body' || ancestor.name === 'html') break;
      if (!isSocialLinkBlock($, ancestor)) break;
      block = ancestor;
    }
    if (block) $(block).remove();
  }
  for (const label of $(LABEL_ELEMENT_SELECTOR).toArray()) {
    if (!FOLLOW_CALL_TEXT.test(collapsedText($(label).text()))) continue;
    const parent = $(label).parent();
    const parentEl = parent.get(0);
    if (!parentEl || !containsFollowLink($, parentEl)) continue;
    if (parentEl.name !== 'body' && collapsedText(parent.text()).length <= MAX_FOLLOW_BLOCK_TEXT) {
      parent.remove();
    } else {
      $(label).remove();
    }
  }
}

/**
 * A whole-page phrase scan mints an area from one mention, so a social-follow block in the page
 * body minted "Social Media" on pages that never claim it (#4047). Publication titles and dated
 * news listings were measured too and are deliberately still read: hand-read on Development,
 * most topics a publication title supplied were the person's real subject, and a news-listing
 * rule withdrew as many real topics as wrong ones.
 */
export function removeNonSelfDeclaringContent($: CheerioAPI): void {
  removeSocialFollowBlocks($);
}
