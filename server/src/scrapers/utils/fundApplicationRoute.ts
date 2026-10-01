/**
 * Where a Student Grants Database fund page says a student applies (#4216).
 *
 * Most fund pages are applied to from the page itself, but many say the application
 * happens somewhere else: a common application that covers a family of funds (itself
 * another FundDetails page), a Qualtrics form, or a department page. Emitting the fund's
 * own page as the application link on those sends a student to a page where they cannot
 * apply. The route is read only from a link the page carries; a page that says to apply
 * elsewhere but links nothing yields no route rather than a guessed one.
 */
import { isRecordSpecificApplicationPortalUrl } from '../../utils/researchHomeWebsiteUrl';

export interface FundProseLink {
  url: string;
  text: string;
}

/** A prose section whose links are replaced in `text` by `fundProseLinkMarker(index)`. */
export interface FundProseSection {
  text: string;
  links: FundProseLink[];
}

export type FundApplicationRoute =
  | { kind: 'fund-page' }
  | { kind: 'elsewhere'; url: string }
  | { kind: 'elsewhere-unlinked' };

export const FUND_PROSE_BLOCK_BREAK = '¶';

export function fundProseLinkMarker(index: number): string {
  return ` ⟦${index}⟧ `;
}

const LINK_MARKER = /⟦(\d+)⟧/g;

const APPLY_WORD_SOURCE = '(?:apply|applies|applying|applications?|submi(?:t|ts|tted|ssions?))';

const CONDITIONAL_OPENING = /^\W*(?:if|when|unless|should you)\b/i;

const routeBeforeLink = (prepositions: string) =>
  new RegExp(
    `\\b${APPLY_WORD_SOURCE}\\b(?:\\W+(?!who\\b|which\\b|that\\b|whose\\b)\\w+){0,10}?\\W+(?:${prepositions})\\b(?:\\s+(?:the|this|our|a|an))?[\\s:]*(?:[^\\s.]+\\s+){0,6}$`,
    'i',
  );

const ROUTED_THROUGH_LINK = routeBeforeLink('via|through|using');

const ROUTED_ON_LINK = routeBeforeLink('on|part of');

const APPLY_DIRECTLY_ON = /\bapply\s+(?:\w+\s+)?on\s+(?:the\s+)?$/i;

const NAMES_AN_APPLICATION = /\b(?:application|apply|form)\b/i;

const NEGATED_OR_ADDITIONAL =
  /\b(?:not|cannot|never|n['’]t|separately|also|in addition|additionally)\b/i;

const APPLY_BUTTON_ON_THIS_PAGE =
  /\b(?:click(?:ing)?\s+(?:on\s+)?(?:the\s+)?["'“‘]?apply["'”’]?|(?:accessible|available)\s+(?:via|through|from)\s+the\s+["'“‘]?apply["'”’]?\s+(?:link|button))/i;

const NOT_THROUGH_THIS_DATABASE =
  /\b(?:cannot|can ?not|not|n['’]t)\s+(?:be\s+)?(?:submitted|accepted|made|completed)\s+(?:via|through|in|on|using)\s+(?:this|the)\s+(?:student grants\s+)?(?:database|system|site|portal)\b/i;

const UNLINKED_COMMON_APPLICATION_ROUTE =
  /\b(?:apply|applications?)\b[^.]{0,60}?\b(?:via|through|using)\s+(?:the\s+)?[^.]{0,80}?\bcommon application\b/i;

const NAMES_A_COMMON_APPLICATION = /\bcommon application\b/i;

function comparableUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.protocol = 'https:';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}

function isCommunityForceHost(url: URL): boolean {
  return /(?:^|\.)communityforce\.com$/i.test(url.hostname);
}

function isRouteCandidate(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (isCommunityForceHost(parsed)) return isRecordSpecificApplicationPortalUrl(parsed.toString());
  return true;
}

function sentencesOf(text: string): string[] {
  return text
    .split(FUND_PROSE_BLOCK_BREAK)
    .flatMap((block) => block.split(/(?<=[.!?])\s+(?=\S)/))
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function linkIndexesIn(sentence: string): Array<{ index: number; offset: number }> {
  return Array.from(sentence.matchAll(LINK_MARKER)).map((match) => ({
    index: Number(match[1]),
    offset: match.index ?? 0,
  }));
}

function textBeforeLink(sentence: string, offset: number): string {
  return sentence.slice(0, offset).replace(LINK_MARKER, ' ').replace(/\s+/g, ' ');
}

function routedLinkInSentence(sentence: string, links: FundProseLink[]): string | null {
  if (CONDITIONAL_OPENING.test(sentence)) return null;
  for (const { index, offset } of linkIndexesIn(sentence)) {
    const link = links[index];
    if (!link || !isRouteCandidate(link.url)) continue;
    const before = textBeforeLink(sentence, offset);
    if (NEGATED_OR_ADDITIONAL.test(before)) continue;
    if (ROUTED_THROUGH_LINK.test(before)) return link.url.trim();
    if (APPLY_DIRECTLY_ON.test(before)) return link.url.trim();
    if (ROUTED_ON_LINK.test(before) && NAMES_AN_APPLICATION.test(link.text)) return link.url.trim();
  }
  return null;
}

function firstRouteCandidateIn(sentence: string, links: FundProseLink[]): string | null {
  for (const { index } of linkIndexesIn(sentence)) {
    const link = links[index];
    if (link && isRouteCandidate(link.url)) return link.url.trim();
  }
  return null;
}

function routeAfterDatabaseRefusal(sentences: string[], at: number, links: FundProseLink[]) {
  const refusal = sentences[at];
  const tail = refusal.slice(refusal.search(NOT_THROUGH_THIS_DATABASE));
  return (
    firstRouteCandidateIn(tail, links) ??
    (sentences[at + 1] ? firstRouteCandidateIn(sentences[at + 1], links) : null)
  );
}

/**
 * A linked route wins over an unlinked one, and the first linked route in reading order
 * wins over a later one. An unlinked route reached through this page's own Apply button
 * is applied to from this page. A page whose own title names a common application is that
 * application, so it is applied to directly whatever its prose says about the family.
 */
export function resolveFundApplicationRoute(
  sections: FundProseSection[],
  fund: { url: string; title: string },
): FundApplicationRoute {
  if (NAMES_A_COMMON_APPLICATION.test(fund.title)) return { kind: 'fund-page' };
  const ownUrl = comparableUrl(fund.url);
  let saysElsewhere = false;
  let appliedFromThisPage = false;

  for (const section of sections) {
    const sentences = sentencesOf(section.text);
    for (let at = 0; at < sentences.length; at += 1) {
      const sentence = sentences[at];
      const refusesDatabase =
        NOT_THROUGH_THIS_DATABASE.test(sentence) && !CONDITIONAL_OPENING.test(sentence);
      const route = refusesDatabase
        ? routeAfterDatabaseRefusal(sentences, at, section.links)
        : routedLinkInSentence(sentence, section.links);
      if (route) {
        return comparableUrl(route) === ownUrl
          ? { kind: 'fund-page' }
          : { kind: 'elsewhere', url: route };
      }
      if (refusesDatabase) saysElsewhere = true;
      const unlinked = sentence.replace(LINK_MARKER, ' ');
      if (APPLY_BUTTON_ON_THIS_PAGE.test(unlinked)) appliedFromThisPage = true;
      if (!CONDITIONAL_OPENING.test(unlinked) && UNLINKED_COMMON_APPLICATION_ROUTE.test(unlinked)) {
        saysElsewhere = true;
      }
    }
  }

  return saysElsewhere && !appliedFromThisPage
    ? { kind: 'elsewhere-unlinked' }
    : { kind: 'fund-page' };
}
