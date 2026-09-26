/**
 * The regions of a Yale profile page that publish news and media *about* a person
 * rather than anything the person authored, and which therefore contribute no
 * harvested data at all: no link, no prose, no name.
 *
 * The Yale School of Medicine template (`medicine.yale.edu`, including the Cancer
 * Center's `/cancer/profile/<slug>/` namespace, and `ysph.yale.edu`) closes every
 * profile with a "News & Links" region holding a press-release list and a video /
 * image gallery. Its links are ordinary in-tab page content, so the collapsed-widget
 * and site-chrome guards do not see them, and a headline routinely spells a lab name
 * ("... - The <Name> Lab at Yale School of Medicine"), which is exactly the token the
 * roster lane's website signal looks for. That is how a press release and a video
 * player became the served "Visit lab website" of 12 rows (#3184).
 *
 * The whole region is refused rather than only its two observed subsections, because
 * what it publishes is publicity by construction: a page about the research is not
 * the research's own home even when the region's own wrapper changes name. Both
 * subsection ids are matched as well, so a template that drops the wrapper still
 * fails closed rather than silently reopening the harvest.
 */
import type * as cheerio from 'cheerio';

const PROFILE_PUBLICITY_REGION_SELECTORS = [
  '#links-details-section',
  '#links-news',
  '#links-media',
  '[aria-label="News & Links"]',
  '[class*="profile-details-news-list"]',
  '[class*="digital-asset-media-list"]',
  // A whole-token match, not a substring one: this class names the template's news
  // teaser list, and a substring form would also claim any wrapper whose name merely
  // contains it on a page that is not a profile.
  '[class~="article-list"]',
] as const;

export const PROFILE_PUBLICITY_REGION_SELECTOR = PROFILE_PUBLICITY_REGION_SELECTORS.join(', ');

/** Whether the element sits inside a profile page's news or media publicity region. */
export function isInProfilePublicityRegion(element: cheerio.Cheerio<any>): boolean {
  return element.closest(PROFILE_PUBLICITY_REGION_SELECTOR).length > 0;
}

/**
 * Drops every publicity region from a loaded document, for the text harvests that
 * scan a whole page rather than walking anchors. A news item's own paragraph is
 * prose on the page, so without this removal it competes to become the entity's
 * served description.
 */
export function removeProfilePublicityRegions($: cheerio.CheerioAPI): void {
  $(PROFILE_PUBLICITY_REGION_SELECTOR).remove();
}
