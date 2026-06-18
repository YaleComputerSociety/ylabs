/**
 * Grounded faculty-bio backfill from official Yale profile URLs.
 *
 * Many student-visible research homes are led by a professor whose
 * `/profile/:netid` page renders no bio: their `user.bio` is empty AND the
 * research-home bio fallback can't fire (individual home, or no qualifying
 * lead home with a trusted website + summary). The companion
 * `backfillResearchDescriptions` only grounds from existing entity text /
 * grant abstracts, so it can't help these — see profile-bio-interest-coverage.
 *
 * This closes that gap with REAL per-person data and produces a genuine
 * BIOGRAPHY (not a research-interest blurb). For each professor it fetches their
 * official Yale profile page and builds the bio in priority order:
 *   1. The page's own "Biography"/"Biographical Sketch" section, sliced
 *      deterministically (highest fidelity — who they are, training,
 *      appointments, and research, in the page's own words).
 *   2. An LLM-extracted third-person biography copied from the page (for
 *      templates without a Biography heading).
 *   3. A title-led composed bio from authoritative fields:
 *      "{Name} is {article} {title} at Yale. {grounded research summary}".
 *
 * Quality safety (no invention, no scope creep):
 *  - The official URL must look like it belongs to this person
 *    (`isLikelyPersonUrl`) and must be a Yale profile/people page (never a
 *    grant/ORCID source). Same-name-contaminated profiles are skipped.
 *  - Page bios are accepted ONLY if GROUNDED (>= MIN_GROUNDING of words appear
 *    in the page) AND pass `profileBioQuality` (a BIO-specific gate that allows
 *    biographical sentences — degrees, appointments — but rejects first-person
 *    voice, navigation chrome, publication-list dumps, and truncated text).
 *    The composed fallback grounds only its research clause (the title is
 *    authoritative). Ungrounded / low-quality / empty rewrites are skipped.
 *  - `manuallyLockedFields` are never overwritten. Existing non-empty
 *    interests/topics are never clobbered.
 *  - Bios whose content shares no field word with the person's title/department
 *    /home/research-areas are flagged in `suspectedWrong` for MANUAL review
 *    (e.g. a wrong-page fetch) — never auto-reverted.
 *  - `--regenerate` refreshes bios this backfill previously wrote
 *    (confidenceByField.bio === 0.7), e.g. to replace the older research-only
 *    blurbs with real biographies.
 *
 * Dry-run-first; apply requires --confirm-profile-bios + an explicit --limit;
 * blocked against production unless CONFIRM_PROD_SCRAPE=true.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { User } from '../models/user';
import {
  isLikelyPersonUrl,
  isLikelySameNameContaminatedProfile,
  normalizePublicProfile,
} from '../services/profileService';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../utils/ssrfGuard';
import { groundingScore } from './backfillResearchDescriptions';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const LEAD_ROLES = ['pi', 'co-pi', 'director', 'co-director', 'core-faculty'];
const SOURCE_NAME = 'official-profile-bio-backfill';
const MIN_GROUNDING = 0.6;
const MIN_BIO_LENGTH = 120;
// Real page biographies (and title-led composed bios) are longer than the old
// research-only blurbs; the public display layer (`clipPublicProfileBio`) trims
// for presentation, so we keep the stored bio generous but bounded.
const MAX_BIO_LENGTH = 3000;
const MAX_PROMPT_CHARS = 40_000;
const MAX_PROMPT_NAME_CHARS = 240;
const MAX_PROMPT_TITLE_CHARS = 500;
const MAX_PROMPT_SOURCE_URL_CHARS = 2048;
const DEFAULT_MODEL = 'gpt-4o-mini';
const BIO_CONFIDENCE = 0.7;
const MAX_INTEREST_TERMS = 8;

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const idValue = (value: unknown): string => {
  return serializedDocumentId(value) || '';
};

function displayName(user: Record<string, any>): string {
  return (
    [user.fname, user.lname].filter(Boolean).join(' ') ||
    textValue(user.displayName) ||
    textValue(user.name) ||
    textValue(user.netid)
  );
}

function isGrantOrIdentitySourceUrl(url: string): boolean {
  return /reporter\.nih\.gov|api\.reporter\.nih\.gov|nsf\.gov|orcid\.org|openalex\.org|pubmed\.ncbi\.nlm\.nih\.gov|doi\.org|crossref\.org/i.test(
    url,
  );
}

function isYaleHost(url: URL): boolean {
  return /(^|\.)yale\.edu$/i.test(url.hostname);
}

function isOfficialYaleProfileUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || isGrantOrIdentitySourceUrl(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!isYaleHost(url)) return false;
  return /\/(?:profile|people|faculty|faculty-directory)\//i.test(url.pathname);
}

/**
 * Pick the official Yale profile URL most likely to describe THIS professor.
 * Returns '' when no trusted, person-matching URL exists.
 */
export function selectOfficialBioUrl(
  profileUrls: Record<string, string> | undefined | null,
  website: string | undefined,
  firstName: string,
  lastName: string,
): string {
  const keyed = profileUrls && typeof profileUrls === 'object' ? profileUrls : {};
  // Priority order: explicit official, then /profile/ pages, then directory pages.
  const ordered: string[] = [
    textValue(keyed.official),
    textValue(keyed.profile),
    ...Object.entries(keyed)
      .filter(([key]) => !['official', 'profile'].includes(key))
      .map(([, value]) => textValue(value)),
    textValue(website),
  ].filter(Boolean);

  const candidates = ordered.filter(
    (url) => isOfficialYaleProfileUrl(url) && isLikelyPersonUrl(url, firstName, lastName),
  );
  if (candidates.length === 0) return '';

  // Prefer dedicated /profile/ pages over generic /people|/faculty listings.
  const profilePage = candidates.find((url) => /\/profile\//i.test(url));
  return profilePage || candidates[0];
}

/**
 * Fallback URL source: a missing-bio professor often has no official URL on
 * their User doc, but their (gate-vetted, student-visible) research home stores
 * the faculty's official Yale page in websiteUrl / sourceUrls. Reuse it — still
 * a real fetched bio written to user.bio, not a display-logic change.
 */
export function selectOfficialBioUrlFromHomes(
  homes: Array<Record<string, any>>,
  firstName: string,
  lastName: string,
): string {
  const urls: string[] = [];
  for (const home of homes) {
    urls.push(textValue(home.websiteUrl), textValue(home.website));
    const sourceUrls = Array.isArray(home.sourceUrls) ? home.sourceUrls : [];
    for (const url of sourceUrls) urls.push(textValue(url));
  }
  const candidates = urls.filter(
    (url) => url && isOfficialYaleProfileUrl(url) && isLikelyPersonUrl(url, firstName, lastName),
  );
  if (candidates.length === 0) return '';
  const profilePage = candidates.find((url) => /\/profile\//i.test(url));
  return profilePage || candidates[0];
}

export function htmlToText(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, nav, footer, header').remove();
  return textValue($('body').text() || $.root().text()).slice(0, MAX_PROMPT_CHARS);
}

/** Keep only research-interest terms whose words actually appear in the page. */
export function groundedInterestTerms(terms: unknown, sourceText: string): string[] {
  if (!Array.isArray(terms)) return [];
  const src = sourceText.toLowerCase();
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of terms) {
    const term = textValue(raw);
    if (!term || term.length < 3 || term.length > 80) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    const words = (key.match(/[a-z]{4,}/g) || []);
    if (words.length === 0) continue;
    const hits = words.filter((w) => src.includes(w)).length;
    if (hits / words.length < MIN_GROUNDING) continue;
    seen.add(key);
    kept.push(term);
    if (kept.length >= MAX_INTEREST_TERMS) break;
  }
  return kept;
}

/**
 * Pull the genuine "Biography"/"About" narrative out of an official Yale
 * profile page's flattened text. Yale School of Medicine and most departmental
 * profile templates render a real third-person bio under a "Biography" heading,
 * immediately followed by structured sections (Appointments, Education &
 * Training, Selected Publications, …). We slice the prose between the heading
 * and the first such section and drop the "Last Updated on …" trailer. Returns
 * '' when the page has no biography heading (callers fall back to LLM
 * extraction / a title-led composed bio).
 */
// Flattened page text concatenates the heading directly onto the body
// ("BiographyDr. …"), so we anchor on a leading boundary only — no trailing
// boundary. Section-end markers are matched case-SENSITIVELY against Title-Case
// headings so lowercase prose words (e.g. "awards", "publications") inside the
// biography don't truncate it early.
const BIOGRAPHY_HEADING = /(?<!auto)Biograph(?:y|ical\s+Sketch)/i;
const BIOGRAPHY_SECTION_END =
  /(?:Appointments|Departments\s*&\s*Organizations|Education\s*&\s*Training|Selected\s+Publications|Clinical\s+Specialties|Patient\s+Care\s+Locations|Last\s+Updated\s+on)/;

export function extractBiographySection(pageText: unknown): string {
  const text = textValue(pageText);
  if (!text) return '';
  const heading = BIOGRAPHY_HEADING.exec(text);
  if (!heading) return '';
  const rest = text.slice(heading.index + heading[0].length);
  const end = BIOGRAPHY_SECTION_END.exec(rest);
  const section = (end ? rest.slice(0, end.index) : rest)
    .replace(/Last\s+Updated\s+on\b.*$/i, '')
    .trim();
  return section.slice(0, MAX_BIO_LENGTH).trim();
}

/**
 * Choose the indefinite/definite article for a faculty title. Named/endowed
 * chairs (which start with a person or place name, e.g. "Sterling Professor",
 * "C.N.H. Long Professor") take "the"; plain ranks ("Assistant Professor",
 * "Senior Lecturer") take "a"/"an".
 */
const TITLE_RANK_LEAD =
  /^(?:Assistant|Associate|Adjunct|Clinical|Visiting|Research|Senior|Full|Distinguished|Emeritus|Emerita|Professor|Lecturer|Lector|Instructor|Director|Co-Director|Dean|Provost|Chair|Scientist|Scholar|Fellow|Postdoctoral)\b/i;

export function articleForFacultyTitle(title: string): string {
  const trimmed = textValue(title);
  if (!trimmed) return '';
  if (TITLE_RANK_LEAD.test(trimmed)) return /^[aeiou]/i.test(trimmed) ? 'an' : 'a';
  return 'the';
}

/**
 * Compose a title-led bio from authoritative fields when the page yields no
 * usable narrative: "{Name} is {article} {title} [at Yale]. {researchSummary}".
 * Requires a research summary so we never store a bare appointment line.
 */
export function composeTitleLedBio(
  name: string,
  title: string,
  researchSummary: string,
): string {
  const cleanName = textValue(name);
  const cleanTitle = textValue(title);
  const research = textValue(researchSummary);
  const article = articleForFacultyTitle(cleanTitle);
  if (!cleanName || !cleanTitle || !article || !research) return '';
  const mentionsAffiliation = /\b(?:at|yale|school|college|institute|university)\b/i.test(cleanTitle);
  const lead = mentionsAffiliation
    ? `${cleanName} is ${article} ${cleanTitle}.`
    : `${cleanName} is ${article} ${cleanTitle} at Yale.`;
  const sentence = /[.!?]$/.test(research) ? research : `${research}.`;
  return `${lead} ${sentence}`;
}

const FIRST_PERSON_BIO_VOICE =
  /(?:^|[.!?]\s+)(?:I|I['’]m|We|Our|My)\b/;
const NAV_CHROME_FRAGMENT =
  /(?:skip to main content|^menu\b|\bview full profile\b|\bread more\b|\bedit profile\b|cookie preferences|\bprivacy policy\b|\bterms of use\b|\baccept cookies\b)/i;
const PUBLICATION_LIST_FRAGMENT = /\bPMID:\s*\d|\bDOI:\s*10\.|\bdoi\.org\/10\./i;

export type ProfileBioQualityFlag =
  | 'blank'
  | 'too-short'
  | 'too-long'
  | 'first-person'
  | 'chrome'
  | 'publication-list'
  | 'incomplete-sentence';

export interface ProfileBioQuality {
  text: string;
  isUseful: boolean;
  flags: ProfileBioQualityFlag[];
}

/**
 * Bio-specific quality gate. UNLIKE `fullDescriptionQuality` (which is tuned for
 * lab descriptions and deliberately rejects biographical sentences — degrees,
 * appointments, "joined Yale"), this gate ALLOWS biographical prose and only
 * rejects junk: blanks, too-short/long, first-person voice, navigation chrome,
 * raw publication-list dumps, and truncated/incomplete sentences.
 */
export function profileBioQuality(value: unknown): ProfileBioQuality {
  const text = textValue(value);
  const flags: ProfileBioQualityFlag[] = [];
  if (!text) {
    return { text, isUseful: false, flags: ['blank'] };
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  if (text.length < MIN_BIO_LENGTH || words < 20) flags.push('too-short');
  if (text.length > MAX_BIO_LENGTH) flags.push('too-long');
  if (FIRST_PERSON_BIO_VOICE.test(text)) flags.push('first-person');
  if (NAV_CHROME_FRAGMENT.test(text)) flags.push('chrome');
  if (PUBLICATION_LIST_FRAGMENT.test(text)) flags.push('publication-list');
  if (!/[.!?]["'’)\]]?$/.test(text)) flags.push('incomplete-sentence');
  return { text, isUseful: flags.length === 0, flags };
}

export interface BioBackfillDecision {
  accepted: boolean;
  bio: string;
  interests: string[];
  source: 'page-section' | 'page-llm' | 'composed' | 'none';
  reason: 'accepted' | 'no_bio' | 'ungrounded' | 'low_quality' | 'bad_length';
  grounding: number;
}

/**
 * Pure acceptance gate — testable without DB / network / LLM. Prefers the real
 * page biography (deterministic section first, then the LLM-extracted narrative)
 * and falls back to a title-led composed bio grounded on the page's research
 * summary. Page bios must be grounded in the page text; the composed bio's
 * authoritative title is exempt from grounding (it comes from the User doc),
 * only its research clause is grounding-checked.
 */
export function decideBioBackfill(input: {
  name: string;
  title?: string;
  pageBiography?: unknown;
  researchSummary?: unknown;
  interests: unknown;
  sourceText: string;
}): BioBackfillDecision {
  const interests = groundedInterestTerms(input.interests, input.sourceText);
  const researchSummary = textValue(input.researchSummary);

  const pageCandidates: Array<{ text: string; source: 'page-section' | 'page-llm' }> = [];
  const section = extractBiographySection(input.sourceText);
  if (section) pageCandidates.push({ text: section, source: 'page-section' });
  const llmBio = textValue(input.pageBiography);
  if (llmBio) pageCandidates.push({ text: llmBio, source: 'page-llm' });

  let sawLength = false;
  let sawUngrounded = false;
  let sawLowQuality = false;
  for (const candidate of pageCandidates) {
    if (candidate.text.length < MIN_BIO_LENGTH || candidate.text.length > MAX_BIO_LENGTH) {
      sawLength = true;
      continue;
    }
    const grounding = groundingScore(candidate.text, input.sourceText);
    if (grounding < MIN_GROUNDING) {
      sawUngrounded = true;
      continue;
    }
    if (!profileBioQuality(candidate.text).isUseful) {
      sawLowQuality = true;
      continue;
    }
    return {
      accepted: true,
      bio: candidate.text,
      interests,
      source: candidate.source,
      reason: 'accepted',
      grounding,
    };
  }

  // Fallback: title-led composed bio (authoritative title + grounded research).
  const composed = composeTitleLedBio(input.name, textValue(input.title), researchSummary);
  if (composed) {
    const researchGrounding = groundingScore(researchSummary, input.sourceText);
    if (researchGrounding >= MIN_GROUNDING && profileBioQuality(composed).isUseful) {
      return {
        accepted: true,
        bio: composed,
        interests,
        source: 'composed',
        reason: 'accepted',
        grounding: researchGrounding,
      };
    }
    if (researchGrounding < MIN_GROUNDING) sawUngrounded = true;
    else sawLowQuality = true;
  }

  const reason = sawLength
    ? 'bad_length'
    : sawUngrounded
      ? 'ungrounded'
      : sawLowQuality
        ? 'low_quality'
        : 'no_bio';
  return { accepted: false, bio: '', interests, source: 'none', reason, grounding: 0 };
}

export type ProfileBioFetcher = (url: string) => Promise<string>;
export interface ProfileBioRewrite {
  /** Third-person biographical narrative copied from the page, '' if none. */
  biography: string;
  /** One pronoun-free sentence on what they study (starts with "Research"). */
  researchSummary: string;
  interests: string[];
}
export type ProfileBioRewriter = (input: {
  name: string;
  title: string;
  sourceUrl: string;
  pageText: string;
}) => Promise<ProfileBioRewrite>;

const defaultFetcher: ProfileBioFetcher = async (url) => {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrlText, {
    timeout: 12_000,
    maxRedirects: 5,
    maxContentLength: 5_000_000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  return htmlToText(String(res.data || ''));
};

const defaultRewriter: ProfileBioRewriter = async ({ name, title, sourceUrl, pageText }) => {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const safeName = redactDirectContactInfo(name).slice(0, MAX_PROMPT_NAME_CHARS);
  const safeTitle = redactDirectContactInfo(title).slice(0, MAX_PROMPT_TITLE_CHARS);
  const safeSourceUrl = redactDirectContactInfo(sourceUrl).slice(0, MAX_PROMPT_SOURCE_URL_CHARS);
  const safePageText = redactDirectContactInfo(pageText).slice(0, MAX_PROMPT_CHARS);
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: process.env.PROFILE_BIO_BACKFILL_MODEL?.trim() || DEFAULT_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You extract a faculty biography from an official Yale profile page. Use ONLY facts present in the page text. Never invent facts. Always write in the THIRD PERSON (never "I"/"we"/"my"). Return strict JSON.',
        },
        {
          role: 'user',
          content: [
            `Faculty member: ${safeName}`,
            `Known title (authoritative): ${safeTitle || '(unknown)'}`,
            `Source URL: ${safeSourceUrl}`,
            'Return JSON with exactly these keys:',
            '- "biography": A 2-6 sentence third-person biography of THIS person taken from the page\'s biographical narrative — who they are, their role/appointments, their education or training, and their research focus. Copy the page\'s wording closely; do not loosely paraphrase. OMIT navigation menus, contact details, "last updated" notes, course catalogs, and long publication or award lists. Start with the person\'s name or "Dr."/their title. Return "" if the page has no real biographical narrative about this person.',
            '- "researchSummary": Exactly ONE sentence describing what this person studies. It MUST start with the word "Research" (e.g. "Research focuses on…", "Research centers on…", "Research examines…") and contain NO name and NO pronoun. Return "" if the page has no research content.',
            '- "interests": up to 8 short research-topic phrases that appear on the page.',
            'PAGE TEXT:',
            safePageText,
          ].join('\n\n'),
        },
      ],
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 40_000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  const parsed = content ? JSON.parse(content) : {};
  return {
    biography: typeof parsed.biography === 'string' ? parsed.biography.trim() : '',
    researchSummary: typeof parsed.researchSummary === 'string' ? parsed.researchSummary.trim() : '',
    interests: Array.isArray(parsed.interests) ? parsed.interests : [],
  };
};

interface BioBackfillCandidate {
  userId: string;
  netid: string;
  name: string;
  fname: string;
  lname: string;
  title: string;
  url: string;
  homeText: string;
  /** Title + departments + home names + research areas, for mismatch flagging. */
  fieldCorpus: string;
  /** The bio currently shown on the profile (for regenerate review reporting). */
  priorBio: string;
  needsBio: boolean;
  needsChips: boolean;
  bioLocked: boolean;
  interestsLocked: boolean;
  /** True when this bio was previously written by this backfill (regenerate). */
  bioWasBackfilled: boolean;
  dataSources: string[];
}

const MIN_INTEREST_SOURCE_CHARS = 60;
const MIN_CHIP_TERMS = 2;

async function buildCandidates(regenerate: boolean): Promise<BioBackfillCandidate[]> {
  const visibleEntities = await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  })
    .select('_id')
    .lean();
  const visibleEntityIds = visibleEntities.map((entity: any) => entity._id);
  if (visibleEntityIds.length === 0) return [];

  const members = await ResearchGroupMember.find({
    researchEntityId: { $in: visibleEntityIds },
    archived: { $ne: true },
    isCurrentMember: { $ne: false },
    role: { $in: LEAD_ROLES },
    userId: { $exists: true, $ne: null },
  })
    .select('researchEntityId userId role')
    .lean();
  const userIds = [...new Set(members.map((m: any) => idValue(m.userId)).filter(Boolean))];
  const memberEntityIds = [
    ...new Set(members.map((m: any) => idValue(m.researchEntityId)).filter(Boolean)),
  ];
  if (userIds.length === 0) return [];

  const [users, homes] = await Promise.all([
    User.find({ _id: { $in: userIds } })
      .select(
        '_id netid fname lname name displayName bio title primaryDepartment secondaryDepartments website websiteUrl profileUrls researchInterests topics openAlexId openalex_id manuallyLockedFields dataSources confidenceByField',
      )
      .lean(),
    ResearchEntity.find({ _id: { $in: memberEntityIds }, archived: { $ne: true } })
      .select(
        '_id slug name displayName kind entityType shortDescription fullDescription description departments researchAreas sourceUrls website websiteUrl',
      )
      .lean(),
  ]);

  const homeById = new Map((homes as any[]).map((entity) => [idValue(entity._id), entity]));
  const homesByUserId = new Map<string, any[]>();
  for (const member of members as any[]) {
    const key = idValue(member.userId);
    const entity = homeById.get(idValue(member.researchEntityId));
    if (!key || !entity) continue;
    const rows = homesByUserId.get(key) || [];
    rows.push({ ...entity, role: member.role || '' });
    homesByUserId.set(key, rows);
  }

  const candidates: BioBackfillCandidate[] = [];
  for (const user of users as any[]) {
    if (isLikelySameNameContaminatedProfile(user)) continue;
    const lockedFields: string[] = Array.isArray(user.manuallyLockedFields)
      ? user.manuallyLockedFields
      : [];
    const bioLocked = lockedFields.includes('bio');
    const interestsLocked = lockedFields.includes('researchInterests');

    const userHomes = homesByUserId.get(idValue(user._id)) || [];
    const publicProfile = normalizePublicProfile(user, {
      researchEntities: userHomes,
      trustedResearchEntities: true,
    });
    // Tag chips render from research_interests + topics; the summary paragraph
    // alone does NOT produce chips.
    const hasChips =
      (Array.isArray(publicProfile.research_interests) &&
        publicProfile.research_interests.length > 0) ||
      (Array.isArray(publicProfile.topics) && publicProfile.topics.length > 0);

    const bioWasBackfilled = Number(user.confidenceByField?.bio) === BIO_CONFIDENCE;
    // In regenerate mode, refresh bios this backfill previously wrote (the old
    // research-only blurbs) even though the profile now shows a bio.
    const needsBio =
      !bioLocked && (!textValue(publicProfile.bio) || (regenerate && bioWasBackfilled));
    const needsChips = !hasChips && !interestsLocked;
    if (!needsBio && !needsChips) continue;

    const fname = textValue(user.fname);
    const lname = textValue(user.lname);
    const url =
      selectOfficialBioUrl(user.profileUrls, user.website, fname, lname) ||
      selectOfficialBioUrlFromHomes(userHomes, fname, lname);
    const homeText = textValue(
      userHomes
        .map((home) => textValue(home.shortDescription) || textValue(home.fullDescription))
        .filter(Boolean)
        .join(' '),
    );
    // Need at least one grounding source: an official page to fetch, or (for
    // chips only) the home's own vetted description text.
    if (!url && !(needsChips && homeText.length >= MIN_INTEREST_SOURCE_CHARS)) continue;

    const fieldCorpus = textValue(
      [
        textValue(user.title),
        textValue(user.primaryDepartment),
        Array.isArray(user.secondaryDepartments) ? user.secondaryDepartments.join(' ') : '',
        ...userHomes.map((home) => textValue(home.name) || textValue(home.displayName)),
        ...userHomes.flatMap((home) =>
          Array.isArray(home.researchAreas) ? home.researchAreas.map(textValue) : [],
        ),
      ]
        .filter(Boolean)
        .join(' '),
    );

    candidates.push({
      userId: idValue(user._id),
      netid: textValue(user.netid),
      name: displayName(user),
      fname,
      lname,
      title: textValue(user.title),
      url,
      homeText,
      fieldCorpus,
      priorBio: textValue(publicProfile.bio),
      needsBio,
      needsChips,
      bioLocked,
      interestsLocked,
      bioWasBackfilled,
      dataSources: Array.isArray(user.dataSources) ? user.dataSources : [],
    });
  }
  return candidates;
}

// Generic academic words that overlap almost any bio/field corpus and would
// mask a genuine topic mismatch, so they are ignored when comparing.
const GENERIC_FIELD_WORDS = new Set([
  'research',
  'researcher',
  'study',
  'studies',
  'studying',
  'science',
  'sciences',
  'scientific',
  'professor',
  'university',
  'yale',
  'school',
  'college',
  'department',
  'program',
  'center',
  'centre',
  'institute',
  'faculty',
  'academic',
  'interests',
  'focuses',
  'focus',
  'understanding',
  'including',
  'various',
  'methods',
  'approach',
  'theory',
  'analysis',
  'project',
  'projects',
  'students',
  'teaching',
  'professorial',
  'investigates',
  'investigator',
]);

const significantWords = (value: string): Set<string> => {
  const words = (textValue(value).toLowerCase().match(/[a-z]{5,}/g) || []).filter(
    (word) => !GENERIC_FIELD_WORDS.has(word),
  );
  return new Set(words);
};

/**
 * Heuristic flag for a bio that may describe the wrong person/field: the bio
 * shares no meaningful (non-generic) word with the faculty member's title,
 * department, research home, or research areas. Used only to build a manual
 * review report — never to auto-revert.
 */
export function detectFieldMismatch(bio: string, fieldCorpus: string): boolean {
  const bioWords = significantWords(bio);
  const corpusWords = significantWords(fieldCorpus);
  if (bioWords.size === 0 || corpusWords.size === 0) return false;
  for (const word of bioWords) {
    if (corpusWords.has(word)) return false;
  }
  return true;
}

export interface ProfileBioBackfillResult {
  mode: 'dry-run' | 'apply';
  candidates: number;
  scanned: number;
  bioWritten: number;
  bioRegenerated: number;
  chipsWritten: number;
  skippedThinSource: number;
  skippedNothingWritten: number;
  fetchErrors: number;
  bioSourceCounts: Record<string, number>;
  suspectedWrong: Array<{
    netid: string;
    title: string;
    bio: string;
    reason: 'field-mismatch' | 'regenerate-failed-stale-bio';
  }>;
  samples: Array<{
    netid: string;
    grounding: number;
    source: string;
    bio: string;
    interests: string[];
  }>;
}

export async function runProfileBioBackfill(options: {
  dryRun: boolean;
  limit?: number;
  regenerate?: boolean;
  fetcher?: ProfileBioFetcher;
  rewriter?: ProfileBioRewriter;
}): Promise<ProfileBioBackfillResult> {
  const fetcher = options.fetcher || defaultFetcher;
  const rewriter = options.rewriter || defaultRewriter;
  const candidates = await buildCandidates(Boolean(options.regenerate));

  const result: ProfileBioBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    candidates: candidates.length,
    scanned: 0,
    bioWritten: 0,
    bioRegenerated: 0,
    chipsWritten: 0,
    skippedThinSource: 0,
    skippedNothingWritten: 0,
    fetchErrors: 0,
    bioSourceCounts: {},
    suspectedWrong: [],
    samples: [],
  };

  for (const candidate of candidates) {
    if (options.limit && result.scanned >= options.limit) break;
    result.scanned += 1;

    // Grounding source: prefer the official page (gives a bio + interests);
    // fall back to the home's own vetted description (interests/chips only).
    let sourceText = '';
    let fromOfficialPage = false;
    if (candidate.url) {
      try {
        sourceText = await fetcher(candidate.url);
        fromOfficialPage = true;
      } catch (error) {
        console.error(
          'Fetch failed for profile-bio candidate:',
          sanitizeLogValue(error),
        );
      }
    }
    if (!fromOfficialPage || sourceText.length < MIN_INTEREST_SOURCE_CHARS) {
      // Fetch failed or page too thin — for a chip-only need, ground on home text.
      if (candidate.needsChips && candidate.homeText.length >= MIN_INTEREST_SOURCE_CHARS) {
        sourceText = candidate.homeText;
        fromOfficialPage = false;
      } else if (candidate.url && !fromOfficialPage) {
        result.fetchErrors += 1;
        continue;
      }
    }
    if (sourceText.length < MIN_INTEREST_SOURCE_CHARS) {
      result.skippedThinSource += 1;
      continue;
    }

    let rewritten: ProfileBioRewrite;
    try {
      rewritten = await rewriter({
        name: candidate.name,
        title: candidate.title,
        sourceUrl: candidate.url || 'research-home-description',
        pageText: sourceText,
      });
    } catch (error) {
      result.fetchErrors += 1;
      console.error('Rewrite failed for profile-bio candidate:', sanitizeLogValue(error));
      continue;
    }

    const decision = decideBioBackfill({
      name: candidate.name,
      title: candidate.title,
      pageBiography: rewritten.biography,
      researchSummary: rewritten.researchSummary,
      interests: rewritten.interests,
      sourceText,
    });

    // Bios are only written from an official page (never synthesized from a
    // research-home description — that is a deliberate product decision).
    const writeBio = candidate.needsBio && !candidate.bioLocked && fromOfficialPage && decision.accepted;
    let chipTerms = decision.interests;

    // If the official page yielded too few grounded interest terms, retry the
    // interest extraction on the home's own (vetted) description text.
    if (
      candidate.needsChips &&
      !candidate.interestsLocked &&
      chipTerms.length < MIN_CHIP_TERMS &&
      fromOfficialPage &&
      candidate.homeText.length >= MIN_INTEREST_SOURCE_CHARS &&
      candidate.homeText !== sourceText
    ) {
      try {
        const homeRewrite = await rewriter({
          name: candidate.name,
          title: candidate.title,
          sourceUrl: 'research-home-description',
          pageText: candidate.homeText,
        });
        chipTerms = groundedInterestTerms(homeRewrite.interests, candidate.homeText);
      } catch (error) {
        console.error('Home-text interest retry failed for profile-bio candidate:', sanitizeLogValue(error));
      }
    }

    const writeChips =
      candidate.needsChips && !candidate.interestsLocked && chipTerms.length >= MIN_CHIP_TERMS;

    // Regenerate review: a previously-backfilled bio that the new pipeline could
    // NOT reproduce/improve survives unchanged — surface it for manual review.
    // This catches same-name-contaminated sources (e.g. a research home whose
    // sourceUrl points to a different person of the same name) whose stale bio
    // we deliberately do not auto-revert.
    if (candidate.bioWasBackfilled && candidate.needsBio && !writeBio) {
      result.suspectedWrong.push({
        netid: candidate.netid,
        title: candidate.title,
        bio: candidate.priorBio,
        reason: 'regenerate-failed-stale-bio',
      });
    }

    if (!writeBio && !writeChips) {
      result.skippedNothingWritten += 1;
      continue;
    }

    if (writeBio) {
      result.bioWritten += 1;
      if (candidate.bioWasBackfilled) result.bioRegenerated += 1;
      result.bioSourceCounts[decision.source] = (result.bioSourceCounts[decision.source] || 0) + 1;
      // Flag (for manual review only) bios whose content doesn't intersect the
      // person's field — likely a wrong-page / same-name fetch (e.g. a
      // geochemist whose bio is about "health equity").
      if (decision.source !== 'composed' && detectFieldMismatch(decision.bio, candidate.fieldCorpus)) {
        result.suspectedWrong.push({
          netid: candidate.netid,
          title: candidate.title,
          bio: decision.bio,
          reason: 'field-mismatch',
        });
      }
    }
    if (writeChips) result.chipsWritten += 1;
    if (result.samples.length < 25) {
      result.samples.push({
        netid: candidate.netid,
        grounding: Number(decision.grounding.toFixed(2)),
        source: writeBio ? decision.source : 'none',
        bio: writeBio ? decision.bio : '',
        interests: writeChips ? chipTerms : [],
      });
    }

    if (!options.dryRun) {
      const set: Record<string, unknown> = {};
      if (writeBio) {
        set.bio = decision.bio;
        set['confidenceByField.bio'] = BIO_CONFIDENCE;
      }
      if (writeChips) set.researchInterests = chipTerms;
      await User.updateOne(
        { _id: candidate.userId },
        { $set: set, $addToSet: { dataSources: SOURCE_NAME } },
      );
    }
  }
  return result;
}

export interface ProfileBioBackfillOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  regenerate: boolean;
  output?: string;
}

export function parseProfileBioBackfillArgs(argv: string[]): ProfileBioBackfillOptions {
  const options: ProfileBioBackfillOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirm: false,
    regenerate: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-profile-bios') options.confirm = true;
    else if (arg === '--regenerate') options.regenerate = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--limit must be a positive integer');
  return parsed;
}

async function main(): Promise<void> {
  const options = parseProfileBioBackfillArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) throw new Error('Apply mode requires --confirm-profile-bios.');
  if (apply && !options.explicitLimit) throw new Error('Apply mode requires an explicit --limit.');

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'official-profile bio backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runProfileBioBackfill({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
      regenerate: options.regenerate,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: {
        dryRun: options.dryRun,
        limit: options.explicitLimit ? options.limit : undefined,
        regenerate: options.regenerate,
      },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved profile-bio backfill report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
