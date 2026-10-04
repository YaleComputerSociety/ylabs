/**
 * Teaser cards for OTHER entities that a page lists beside its own content: a core
 * facility page closing with cards for related cores, a center page listing
 * affiliated centers. Each card is a heading that links to the other entity's own
 * page plus that entity's blurb, so its paragraph is real prose on the page and,
 * without this removal, competes to become the listing page's description. That is
 * how a diagnostics core came to serve another core's metabolomics services (#4809).
 *
 * A card is recognised by shape rather than by one template's class name: an element
 * whose class names a card, teaser or listing item, whose heading is a link, and
 * which sits among siblings of the same class. The listing is what separates a
 * teaser from the page's own content: measured on 668 Development org pages, a
 * linked-heading card alone also matched the page's own single content card on 26
 * of them and removed their real description.
 *
 * A heading link only names another entity when it leaves the page's own path
 * subtree: a lab homepage's cards for its own /research and /people sections are the
 * lab's content, while a core page's cards for sibling cores are not. Without the
 * page's URL that cannot be told apart, so nothing is removed.
 */
import * as cheerio from 'cheerio';

// Whole class tokens naming a card BLOCK ("card", "cores-card", "card--listing",
// "teaser", "listing-item"). A BEM element such as "card__content" is the inside of
// a card, often the page's own hero, so it never counts.
const TEASER_CARD_CLASS_TOKEN = /^(?:[a-z0-9]+-)*(?:card|teaser|listing-item)(?:--[a-z0-9-]+)?$/i;

const LINKED_HEADING_SELECTOR = 'h2 > a[href], h3 > a[href], h4 > a[href]';

const parseUrl = (value: string, base?: URL): URL | null => {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
};

const withoutTrailingSlash = (path: string): string => path.replace(/\/+$/, '');

const linksOutsidePageSubtree = (href: string | undefined, page: URL): boolean => {
  const value = (href || '').trim();
  const target = value ? parseUrl(value, page) : null;
  if (!target || !/^https?:$/.test(target.protocol)) return false;
  if (target.host !== page.host) return true;
  const pagePath = withoutTrailingSlash(page.pathname);
  const targetPath = withoutTrailingSlash(target.pathname);
  return targetPath !== pagePath && !targetPath.startsWith(`${pagePath}/`);
};

const isTeaserCardBlock = ($: cheerio.CheerioAPI, element: any): boolean =>
  ($(element).attr('class') || '')
    .split(/\s+/)
    .some((token) => TEASER_CARD_CLASS_TOKEN.test(token));

const hasSameShapeSibling = ($: cheerio.CheerioAPI, element: any): boolean => {
  const tag = element.tagName;
  const className = ($(element).attr('class') || '').trim();
  return $(element)
    .siblings()
    .toArray()
    .some(
      (sibling: any) =>
        sibling.tagName === tag && ($(sibling).attr('class') || '').trim() === className,
    );
};

// The repeating unit of a listing is the card itself, or the list item or article
// wrapping it when each card is its wrapper's only child.
const isInListingOfCards = ($: cheerio.CheerioAPI, element: any): boolean => {
  if (hasSameShapeSibling($, element)) return true;
  const parent = $(element).parent()[0] as any;
  return Boolean(
    parent &&
    ['li', 'article'].includes(parent.tagName) &&
    $(parent).children().length === 1 &&
    hasSameShapeSibling($, parent),
  );
};

const relatedEntityTeaserCardElements = ($: cheerio.CheerioAPI, page: URL): any[] =>
  $('[class]')
    .toArray()
    .filter((element) => isTeaserCardBlock($, element))
    .filter((element) => isInListingOfCards($, element))
    .filter((element) =>
      $(element)
        .find(LINKED_HEADING_SELECTOR)
        .toArray()
        .some((anchor) => linksOutsidePageSubtree($(anchor).attr('href'), page)),
    );

export function removeRelatedEntityTeaserCards($: cheerio.CheerioAPI, pageUrl?: string): void {
  const page = pageUrl ? parseUrl(pageUrl) : null;
  if (!page) return;
  relatedEntityTeaserCardElements($, page).forEach((element) => {
    $(element).remove();
  });
}

const comparableText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const OPENING_WORDS = 12;

/**
 * Whether a description is another unit's teaser blurb on this page: its opening
 * appears inside one of the page's related-unit teaser cards and nowhere in the
 * page's own text. A lane that stored such a description before teaser cards were
 * removed (#4823) can then retract it, because re-reading the page shows the text
 * was never this page's own.
 */
export function isRelatedEntityTeaserTextOnPage(
  html: string,
  pageUrl: string,
  description: string,
): boolean {
  const page = parseUrl(pageUrl);
  const opening = comparableText(description).split(' ').slice(0, OPENING_WORDS).join(' ');
  if (!page || opening.split(' ').length < OPENING_WORDS) return false;
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const teasers = relatedEntityTeaserCardElements($, page);
  if (!teasers.some((element) => comparableText($(element).text()).includes(opening))) return false;
  teasers.forEach((element) => {
    $(element).remove();
  });
  return !comparableText($('body').text()).includes(opening);
}
