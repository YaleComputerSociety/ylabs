/**
 * Reads a lab website for the lead it declares for itself.
 *
 * A lab website harvested off a person's profile is evidence of a link, not of
 * ownership, and only the site can say whose lab it is. This is the evidence step
 * behind re-homing such a link (#2385); the decision itself is pure and lives in
 * `utils/foreignLabWebsiteRetarget.ts`.
 *
 * A lab's homepage usually credits its lead only inside news items and
 * publication author lists, which the prompt refuses on purpose, so the roster
 * page is normally the page that states it: `apollo-lab-yale.github.io` names
 * "Daniel Rakita / Principal Investigator" on `/team/` and nowhere on `/`.
 * Candidate pages are therefore tried in turn and the first stated lead wins.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { LAB_SITE_DECLARED_LEAD_PROMPT, LAB_SITE_DECLARED_LEAD_PROMPT_HASH } from '../prompts';
import { htmlToText } from './labMicrositeDescriptionLLMExtractor';

export { LAB_SITE_DECLARED_LEAD_PROMPT_HASH };

export const LAB_SITE_DECLARED_LEAD_SOURCE = 'lab-site-declared-lead-llm';
export const DEFAULT_DECLARED_LEAD_MODEL = 'gpt-5-mini';
const MAX_PROMPT_CHARS = 40_000;
const MAX_PAGES_PER_SITE = 4;

// A lead attribution moves a website between records, so it is a judgement rather
// than a transcription. The minimal effort `openAiChatSampling` picks for gpt-5
// measurably under-reads exactly this kind of subject-scope question, so this
// extractor asks for medium instead.
const DECLARED_LEAD_REASONING_EFFORT = 'medium';

const ROSTER_LINK_RE = /\b(?:team|people|members?|lab|group|who[-\s]?we[-\s]?are|about|faculty)\b/i;

// Hosts that publish somebody's bibliography or a shortened link rather than a
// lab's own site. A profile lab-website slot holds several of these (a Google
// Scholar profile, a PubMed record, a `t.co` redirect), and none can state who
// leads a lab, so reading them costs an LLM call to learn nothing.
const NON_LAB_SITE_HOSTS = new Set([
  'scholar.google.com',
  'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  'clinicaltrials.gov',
  'doi.org',
  'orcid.org',
  'researchgate.net',
  'linkedin.com',
  'x.com',
  'twitter.com',
  't.co',
  'bit.ly',
  'youtube.com',
  'github.com',
]);

/** Whether a URL is an aggregator or link shortener rather than a lab's own site. */
export function isNonLabSiteUrl(value: unknown): boolean {
  try {
    const host = new URL(textValue(value)).hostname.toLowerCase().replace(/^www\./, '');
    return NON_LAB_SITE_HOSTS.has(host);
  } catch {
    return true;
  }
}

export interface DeclaredLeadExtraction {
  declaredLead: string;
  labName: string;
}

export interface FetchedLabSitePage {
  url: string;
  html: string;
}

export interface LabSiteDeclaredLead {
  declaredLead: string;
  labName: string;
  evidenceUrl: string;
  pagesRead: string[];
}

export type LabSitePageFetcher = (url: string) => Promise<FetchedLabSitePage | null>;

export type DeclaredLeadLLMFn = (input: {
  model: string;
  apiKey: string;
  sourceUrl: string;
  pageText: string;
}) => Promise<DeclaredLeadExtraction>;

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function sameHost(candidate: string, base: string): boolean {
  try {
    return new URL(candidate).hostname.toLowerCase() === new URL(base).hostname.toLowerCase();
  } catch {
    return false;
  }
}

// A trailing segment is only dropped when it names a file (`/lab/oconnor/index.aspx`).
// A bare segment is a CMS section, not a document, so `medicine.yale.edu/labmed`
// bounds the subtree at `/labmed/` rather than at the whole host.
function sitePathPrefix(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/')) return pathname;
    const withoutFile = /\/[^/]*\.[a-z0-9]{2,5}$/i.test(pathname)
      ? pathname.replace(/\/[^/]*$/, '')
      : pathname;
    return withoutFile.endsWith('/') ? withoutFile : `${withoutFile}/`;
  } catch {
    return '/';
  }
}

/**
 * Pages inside the linked site worth reading for a lead, most likely first, with
 * the site's own entry point always read first because many labs state their lead
 * in a single "led by" line there.
 *
 * Candidates are confined to the linked URL's own subtree, not merely its host. A
 * Yale CMS lab page carries the whole school's navigation, so following a same-host
 * "About" link off `medicine.yale.edu/labmed` lands on `medicine.yale.edu/about/`
 * and reads back the DEAN as the declared lead - which attributed four different
 * departmental sites to the same person in one measured run.
 */
export function declaredLeadCandidateUrls(rootUrl: string, rootHtml: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const normalized = value.replace(/#.*$/, '');
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    urls.push(normalized);
  };
  add(rootUrl);
  const prefix = sitePathPrefix(rootUrl);
  const $ = cheerio.load(rootHtml);
  const scored: Array<{ url: string; rank: number }> = [];
  $('a[href]').each((_index, element) => {
    const href = textValue($(element).attr('href'));
    if (!href || /^(?:mailto|tel|javascript):/i.test(href)) return;
    let resolved: URL;
    try {
      resolved = new URL(href, rootUrl);
    } catch {
      return;
    }
    if (!sameHost(resolved.toString(), rootUrl)) return;
    if (!resolved.pathname.toLowerCase().startsWith(prefix.toLowerCase())) return;
    const label = `${textValue($(element).text())} ${resolved.pathname}`;
    if (!ROSTER_LINK_RE.test(label)) return;
    scored.push({
      url: resolved.toString(),
      rank: /\b(?:team|people|members?)\b/i.test(label) ? 0 : 1,
    });
  });
  for (const entry of scored.sort((left, right) => left.rank - right.rank)) add(entry.url);
  return urls.slice(0, MAX_PAGES_PER_SITE);
}

const defaultFetchPage: LabSitePageFetcher = async (url) => {
  try {
    const page = await fetchPageWithPolicy(url, {
      headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
      timeoutMs: 10_000,
    });
    return { url: page.url, html: page.html };
  } catch {
    return null;
  }
};

const defaultCallLLM: DeclaredLeadLLMFn = async (input) => {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: input.model,
      response_format: { type: 'json_object' },
      reasoning_effort: DECLARED_LEAD_REASONING_EFFORT,
      messages: [
        { role: 'system', content: LAB_SITE_DECLARED_LEAD_PROMPT },
        {
          role: 'user',
          content: [
            `Source URL: ${redactDirectContactInfo(input.sourceUrl).slice(0, 2048)}`,
            'Return JSON with declaredLead and labName.',
            redactDirectContactInfo(input.pageText).slice(0, MAX_PROMPT_CHARS),
          ].join('\n\n'),
        },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') throw new Error('LLM returned empty content');
  const parsed = JSON.parse(content) as Partial<DeclaredLeadExtraction>;
  return { declaredLead: textValue(parsed.declaredLead), labName: textValue(parsed.labName) };
};

/**
 * The lead a lab website states for itself, or null when it states none.
 *
 * Returning null rather than a best guess is the point: the caller moves a
 * website on the strength of this answer, so "the site does not say" has to be
 * distinguishable from "the site says someone".
 */
export async function extractLabSiteDeclaredLead(
  websiteUrl: string,
  options: {
    apiKey?: string;
    model?: string;
    fetchPage?: LabSitePageFetcher;
    callLLM?: DeclaredLeadLLMFn;
  } = {},
): Promise<LabSiteDeclaredLead | null> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (isNonLabSiteUrl(websiteUrl)) return null;
  const fetchPage = options.fetchPage ?? defaultFetchPage;
  const callLLM = options.callLLM ?? defaultCallLLM;
  const model = options.model ?? DEFAULT_DECLARED_LEAD_MODEL;

  const root = await fetchPage(websiteUrl);
  if (!root) return null;

  const pagesRead: string[] = [];
  let labName = '';
  for (const candidateUrl of declaredLeadCandidateUrls(root.url || websiteUrl, root.html)) {
    const page = candidateUrl === (root.url || websiteUrl) ? root : await fetchPage(candidateUrl);
    if (!page) continue;
    const pageText = htmlToText(page.html);
    if (!pageText) continue;
    pagesRead.push(candidateUrl);
    let extraction: DeclaredLeadExtraction;
    try {
      extraction = await callLLM({ model, apiKey, sourceUrl: candidateUrl, pageText });
    } catch {
      continue;
    }
    if (!labName) labName = extraction.labName;
    if (extraction.declaredLead) {
      return {
        declaredLead: extraction.declaredLead,
        labName: labName || extraction.labName,
        evidenceUrl: candidateUrl,
        pagesRead,
      };
    }
  }
  return null;
}
