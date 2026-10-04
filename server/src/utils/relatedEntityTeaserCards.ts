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
 */
import type * as cheerio from 'cheerio';

// Whole class tokens naming a card BLOCK ("card", "cores-card", "card--listing",
// "teaser", "listing-item"). A BEM element such as "card__content" is the inside of
// a card, often the page's own hero, so it never counts.
const TEASER_CARD_CLASS_TOKEN = /^(?:[a-z0-9]+-)*(?:card|teaser|listing-item)(?:--[a-z0-9-]+)?$/i;

const LINKED_HEADING_SELECTOR = 'h2 > a[href], h3 > a[href], h4 > a[href]';

const linksElsewhere = (href: string | undefined): boolean => {
  const value = (href || '').trim();
  return Boolean(value) && !value.startsWith('#') && !/^(?:mailto|tel):/i.test(value);
};

const isTeaserCardBlock = ($: cheerio.CheerioAPI, element: any): boolean =>
  ($(element).attr('class') || '').split(/\s+/).some((token) => TEASER_CARD_CLASS_TOKEN.test(token));

const hasSameShapeSibling = ($: cheerio.CheerioAPI, element: any): boolean => {
  const tag = element.tagName;
  const className = ($(element).attr('class') || '').trim();
  return $(element)
    .siblings()
    .toArray()
    .some((sibling: any) => sibling.tagName === tag && ($(sibling).attr('class') || '').trim() === className);
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

export function removeRelatedEntityTeaserCards($: cheerio.CheerioAPI): void {
  $('[class]')
    .toArray()
    .filter((element) => isTeaserCardBlock($, element))
    .filter((element) => isInListingOfCards($, element))
    .filter((element) =>
      $(element)
        .find(LINKED_HEADING_SELECTOR)
        .toArray()
        .some((anchor) => linksElsewhere($(anchor).attr('href'))),
    )
    .forEach((element) => {
      $(element).remove();
    });
}
