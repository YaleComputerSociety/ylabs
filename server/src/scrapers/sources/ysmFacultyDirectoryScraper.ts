/**
 * YsmFacultyDirectoryScraper
 *
 * Bespoke per-faculty enrichment scraper for the Yale School of Medicine's
 * school-wide A-Z faculty directory (issue #639). `ysm-atoz-index` covers YSM
 * lab research homes discovered from the centralized lab-websites index;
 * `ysm-mesh-keyword` attaches governed MeSH research areas to entities that
 * already exist. Neither walks the school-wide faculty directory itself to
 * discover new PIs and lab websites directly from each faculty's own profile.
 *
 * Crawl shape:
 *   - The A-Z directory root is a SEED only (~14k entries: faculty, staff, and
 *     trainees). It is never recorded as a source.
 *   - Each individual's own profile page (`/profile/<slug>/`) is the official
 *     source cited for every observation about that person and their research
 *     home. The directory root and any listing/facet page are rejected
 *     listings and are never cited (issues #510/#516/#529/#549).
 *   - A profile is only processed further when its own "research" section
 *     carries a lab website, governed MeSH research areas, or a research
 *     description; the directory
 *     lists many non-research staff and trainees whose profile has no
 *     research section at all, and those are skipped without emitting any
 *     observation (identity roster maintenance for the wider community is
 *     `yale-directory`'s job, not this per-PI enrichment pass).
 *
 * A profile with its own lab website seeds a LAB research home with that site
 * as the websiteUrl; a profile with governed research areas or a research
 * description but no lab site
 * seeds a FACULTY_RESEARCH_AREA home instead. Contact is fail-closed: emails
 * derive stable Researcher identity and key the lead PI to the canonical
 * Researcher, and are redacted from public payloads at read time. The lead PI is
 * never attached from a surname match against the researcher collection (#562,
 * #579); identity here comes directly from the person's own official profile
 * page, keyed by their own profile email/netid, exactly as `yseFacultyDirectoryScraper`
 * already does for YSE.
 */
import {
  loadLaneTitledPersonKeys,
  type TitledPersonKeysLoader,
} from '../utils/laneTitledPersonKeys';
import axios from 'axios';
import {
  catalogDepartment,
  catalogSchoolForDepartment,
} from '../directoryExportDepartmentEvidence';
import { SCHOOL_OF_MEDICINE_NAME } from '../orgUnitCanonicalization';
import { mongooseConnectionWasOpened } from '../../utils/mongooseConnectionWasOpened';
import type { CanonicalDepartment } from '../utils/directoryExportDepartment';
import { retryOnRetryableStatus } from '../utils/httpFetch';
import * as cheerio from 'cheerio';
import { clampDescriptionLength } from '../../utils/descriptionHygiene';
import { forEachInOrderWithPrefetch } from '../utils/boundedConcurrency';
import { fetchFailureStatusCode } from '../utils/fetchFailure';
import { flattenHtmlToText } from '../utils/htmlText';
import { singleStatedOrcid } from '../utils/rosterMemberIdentityEvidence';
import {
  classifyHarvestedResearchHomeName,
  isLabShapedResearchHome,
  personSurnamesFromDisplayNames,
} from '../../utils/researchHomeNameIdentityAuthority';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { isPersonalNameDomainWebsite } from '../../utils/personalNameWebsite';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { getCached, setCached } from '../snapshotCache';
import { REFUSED_WEBSITE_URL_FIELD } from '../laneRefusedWebsiteUrl';
import {
  isLikelyPersonSpecificYaleEmail,
  netidFromEmail,
  splitName,
} from '../utils/scraperHelpers';
import { personNameKey } from '../rekeyedPersonKeyPlan';
import { RekeyedPersonReads, settleRekeyedPersonReads } from '../rekeyedPersonKeyRetirement';
import { asYaleNetid } from '../../utils/yaleNetid';
import {
  classifyUserType,
  isResearchSupportStaffTitle,
  isSubordinateResearchRank,
  looksLikeNonResearchTitle,
  mintsNoResearchEntityAsTeachingAppointment,
} from './yaleDirectoryScraper';
import { withoutMeshNonSubjectDescriptors } from '../utils/meshNonSubjectDescriptors';
import { normalizeYsmProfileUrl } from './ysmMeshKeywordScraper';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';
import {
  emitLanePageHealthForCitedPages,
  LanePageReads,
  type LanePageProbe,
} from '../lanePageHealth';
import {
  labUrlUnusabilityFor,
  loadLabUrlEvidenceBySlug,
  type LabUrlEvidenceLoader,
  type LabUrlIsUnusable,
} from '../utils/labUrlEvidence';
import {
  coLedGroupSiteFor,
  loadCoLedSiteIndex,
  type CoLedSiteIndexLoader,
  type LabUrlIsCoLedGroupSite,
} from '../utils/coLedGroupSites';

const DIRECTORY_URL = 'https://medicine.yale.edu/faculty/faculty-directory/facultylist/';
const SOURCE_KEY = 'ysm-faculty-directory';
const SCHOOL_NAME = 'Yale School of Medicine';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const PROFILE_FETCH_LOOKAHEAD = 4;
export const REFUSED_PROFILE_RETRY_PAUSE_MS = 60_000;
const REFUSAL_STATUS_CODES: ReadonlySet<number> = new Set([403, 429]);
// The profile-page research prose is the faculty's own official description but
// lives on a profile page, so it must rank at the profile-page description tier:
// above the synthesized roster one-liner and below a lab-microsite full page.
// Mirrors yseFacultyDirectoryScraper and labMicrositeDescriptionLLMExtractor's
// profile branch.
const PROFILE_DESCRIPTION_CONFIDENCE = 0.55;
const INFERRED_PI_CONFIDENCE = 0.7;
const MAX_RESEARCH_AREAS = 24;
const MAX_DEPARTMENTS = 10;

export type HtmlFetcher = (
  url: string,
  useCache: boolean,
  pageReads?: LanePageReads,
) => Promise<string>;

export interface RawYsmFaculty {
  name: string;
  profileUrl: string;
  slug: string;
}

export interface YsmFacultyProfile {
  name: string;
  profileUrl: string;
  slug: string;
  title?: string;
  /**
   * What the mint screens and `userType` read: the HR title when the page carries one. A
   * hospital staff affiliate can display a clinical rank, and the screens were measured
   * against the HR title (#5578).
   */
  screeningTitle?: string;
  email?: string;
  orcid?: string;
  departments: string[];
  /**
   * The profile's stated appointments, primary first, without the `organizations` list the
   * `departments` label carries (centers, houses, labs, societies). Only these can be a home
   * department (#6070).
   */
  appointmentDepartments: string[];
  /** The units of the appointments the page marks `Primary`; a secondary is never one (#6160). */
  primaryAppointmentUnits?: string[];
  /** The one catalog school those primary units belong to, when they name exactly one (#6160). */
  primaryAppointmentSchool?: string;
  researchAreas: string[];
  description?: string;
  bio?: string;
  labUrl?: string;
  /**
   * `empty` only when the profile carries no lab-website link at all; a link the page
   * carries and this lane cannot adopt is `refused`, which licenses no absence (#2647).
   */
  labSlotAttestation?: 'empty' | 'refused';
  labName?: string;
  labDescription?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = textValue(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function decodeEmbeddedJson(raw: string): unknown | null {
  const decoded = cheerio.load(`<textarea>${raw}</textarea>`)('textarea').text();
  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function parsePageData(html: string): Record<string, unknown> | null {
  if (!html) return null;
  return ysmPageDataFrom(cheerio.load(html));
}

export function ysmPageDataFrom($: cheerio.CheerioAPI): Record<string, unknown> | null {
  const targeted = $('script#page-data').first().html();
  if (targeted) {
    const parsed = decodeEmbeddedJson(targeted);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  }
  let found: Record<string, unknown> | null = null;
  $('script[type="application/json"]').each((_i, el) => {
    if (found) return;
    const raw = $(el).html() || '';
    if (!raw.includes('mainComponents')) return;
    const parsed = decodeEmbeddedJson(raw);
    if (parsed && typeof parsed === 'object') found = parsed as Record<string, unknown>;
  });
  return found;
}

export function mainComponentsOf(
  pageData: Record<string, unknown> | null,
): Record<string, unknown>[] {
  const components = pageData?.mainComponents;
  return Array.isArray(components) ? (components as Record<string, unknown>[]) : [];
}

function profileSlugFromUrl(url: string): string {
  return url.match(/\/profile\/([^/]+)\/?$/i)?.[1]?.toLowerCase() || '';
}

function nameFromDirectoryText(text: string): string {
  const [last, first] = text.split(',').map((part) => part.trim());
  if (last && first) return `${first} ${last}`;
  return text.trim();
}

function htmlToText(value: unknown): string {
  const raw = textValue(value);
  if (!raw) return '';
  return flattenHtmlToText(raw);
}

function clippedText(value: string, minChars = 40, maxChars = 2000): string | undefined {
  if (value.length < minChars) return undefined;
  return clampDescriptionLength(value, maxChars);
}

function isHttpUrl(value: unknown): boolean {
  const raw = textValue(value);
  if (!raw) return false;
  try {
    return /^https?:$/i.test(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/**
 * Parse the school-wide A-Z directory into {name, profileUrl, slug} rows. The
 * full model.items payload is embedded in the single directory page (no
 * pagination): every category letter's roster is a crawl SEED only, never
 * cited as a source. External links and non-`/profile/` entries are dropped.
 */
export function parseYsmFacultyDirectory(html: string): RawYsmFaculty[] {
  const pageData = parsePageData(html);
  const listing = mainComponentsOf(pageData).find((component) => component.key === 'PeopleAzList');
  const model = (listing?.model || {}) as Record<string, unknown>;
  const categories = Array.isArray(model.items) ? model.items : [];

  const bySlug = new Map<string, RawYsmFaculty>();
  for (const category of categories) {
    const items = Array.isArray((category as Record<string, unknown>)?.items)
      ? ((category as Record<string, unknown>).items as Record<string, unknown>[])
      : [];
    for (const item of items) {
      if (item.isExternal) continue;
      const profileUrl = normalizeYsmProfileUrl(textValue(item.url), DIRECTORY_URL);
      if (!profileUrl) continue;
      const slug = profileSlugFromUrl(profileUrl);
      if (!slug || bySlug.has(slug)) continue;
      const rawText = textValue(item.text);
      bySlug.set(slug, { name: nameFromDirectoryText(rawText) || rawText, profileUrl, slug });
    }
  }
  return Array.from(bySlug.values());
}

function appointmentDepartmentsFromAboutSection(about: Record<string, unknown>): string[] {
  const appointments = Array.isArray(about.appointments)
    ? (about.appointments as Record<string, unknown>[])
    : [];
  const primary = appointments
    .filter((a) => textValue(a.type) === 'Primary')
    .map((a) => textValue(a.organizationName));
  const secondary = appointments
    .filter((a) => textValue(a.type) !== 'Primary')
    .map((a) => textValue(a.organizationName));
  return uniqueStrings([...primary, ...secondary]).slice(0, MAX_DEPARTMENTS);
}

function primaryAppointmentUnitsFromAboutSection(about: Record<string, unknown>): string[] {
  const appointments = Array.isArray(about.appointments)
    ? (about.appointments as Record<string, unknown>[])
    : [];
  return uniqueStrings(
    appointments
      .filter((a) => textValue(a.type) === 'Primary')
      .map((a) => textValue(a.organizationName)),
  );
}

export type SchoolForDepartment = (department: string) => string | undefined;

export function ysmPrimaryAppointmentSchool(
  profile: Pick<YsmFacultyProfile, 'primaryAppointmentUnits'>,
  schoolForDepartment: SchoolForDepartment | null,
): string | undefined {
  const units = profile.primaryAppointmentUnits ?? [];
  if (!schoolForDepartment || units.length === 0) return undefined;
  const schools = units.map((unit) => schoolForDepartment(unit));
  if (schools.some((school) => !school)) return undefined;
  const distinct = uniqueStrings(schools);
  return distinct.length === 1 ? distinct[0] : undefined;
}

function ysmResearchEntitySchool(profile: Pick<YsmFacultyProfile, 'primaryAppointmentSchool'>) {
  const stated = profile.primaryAppointmentSchool;
  return stated && stated !== SCHOOL_OF_MEDICINE_NAME ? stated : SCHOOL_NAME;
}

function departmentsFromAboutSection(about: Record<string, unknown>): string[] {
  const organizations = Array.isArray(about.organizations)
    ? (about.organizations as Record<string, unknown>[])
    : [];
  const orgNames = organizations.map((o) => textValue(o.name));
  return uniqueStrings([...appointmentDepartmentsFromAboutSection(about), ...orgNames]).slice(
    0,
    MAX_DEPARTMENTS,
  );
}

/**
 * The home department a profile states: its first appointment, when the department catalog
 * names it (#6070). A later appointment is never promoted in its place (`docs/decisions.md`,
 * 2026-11-13), an organization is never one, and an appointment the catalog does not name (a
 * program, a center, a lab) is no department claim. With no catalog the lane emits none, failing
 * closed like the official-profile backfill (#6099), because it cannot tell a department from a
 * center then.
 */
export function ysmHomeDepartment(
  profile: Pick<YsmFacultyProfile, 'appointmentDepartments'>,
  canonicalDepartment: CanonicalDepartment | null,
): string | undefined {
  if (!canonicalDepartment) return undefined;
  const [first] = profile.appointmentDepartments;
  return first && canonicalDepartment(first) ? first : undefined;
}

function extractPersonEmail(rawEmail: unknown, name: string): string | undefined {
  const email = textValue(rawEmail).toLowerCase();
  if (!email || !isLikelyPersonSpecificYaleEmail(email, name)) return undefined;
  return email;
}

/**
 * The profile's own ORCID list names its subject's iD only when it holds exactly one: a list of
 * several does not say which is the subject's, so its first entry is no evidence (#5932).
 */
function extractOrcid(research: Record<string, unknown>): string | undefined {
  const entries = Array.isArray(research.orcids)
    ? (research.orcids as Record<string, unknown>[])
    : [];
  return singleStatedOrcid(entries.map((entry) => textValue(entry.url) || textValue(entry.text)));
}

function extractLabWebsite(
  research: Record<string, unknown>,
  about: Record<string, unknown>,
): {
  url?: string;
  slotAttestation?: YsmFacultyProfile['labSlotAttestation'];
  name?: string;
  description?: string;
} {
  const raw = (research.labWebsite || about.labWebsite) as Record<string, unknown> | null;
  const url = raw && isHttpUrl(raw.url) ? textValue(raw.url) : undefined;
  const pageCarriesLink = Boolean(raw && textValue(raw.url));
  return {
    url,
    ...(url ? {} : { slotAttestation: pageCarriesLink ? 'refused' : 'empty' }),
    name: url ? textValue(raw?.name) || undefined : undefined,
    description: url ? htmlToText(raw?.description) || undefined : undefined,
  };
}

/**
 * The leading title of the page's header title block, which the page renders and its
 * JSON-LD `jobTitle` repeats. `about.workdayTitle` is the HR record instead, and it can
 * be a recruiting placeholder or a job code ("Medical School Recruit - ...") while the
 * page displays the person's appointment (#5578), so it is read only when the header
 * states no title.
 */
function displayedProfileTitle(model: Record<string, unknown>): string {
  const header = (model.header || {}) as Record<string, unknown>;
  const titles = Array.isArray(header.titles) ? header.titles : [];
  return titles.map((title) => textValue(title)).find(Boolean) || '';
}

/**
 * Parse an individual profile page's `ProfileDetails` component into a
 * researcher-shaped record. Returns null when the page carries no
 * `ProfileDetails` component (a malformed/removed profile).
 */
export function extractProfile(html: string, faculty: RawYsmFaculty): YsmFacultyProfile | null {
  const pageData = parsePageData(html);
  const profileDetails = mainComponentsOf(pageData).find(
    (component) => component.key === 'ProfileDetails',
  );
  if (!profileDetails) return null;
  const model = (profileDetails.model || {}) as Record<string, unknown>;
  const name = textValue(model.fullName) || faculty.name;
  const sections = Array.isArray(model.sections)
    ? (model.sections as Record<string, unknown>[])
    : [];
  const about = (sections.find((s) => s.sectionType === 'about') || {}) as Record<string, unknown>;
  const research = (sections.find((s) => s.sectionType === 'research') || {}) as Record<
    string,
    unknown
  >;
  const getInTouch = (sections.find((s) => s.sectionType === 'getInTouch') || {}) as Record<
    string,
    unknown
  >;

  const meshKeywords = Array.isArray(research.meshKeywords)
    ? (research.meshKeywords as Record<string, unknown>[])
    : [];
  const researchAreas = withoutMeshNonSubjectDescriptors(
    uniqueStrings(meshKeywords.map((k) => k.name)),
  ).slice(0, MAX_RESEARCH_AREAS);
  const labWebsite = extractLabWebsite(research, about);

  return {
    name,
    profileUrl: faculty.profileUrl,
    slug: faculty.slug,
    title: displayedProfileTitle(model) || textValue(about.workdayTitle) || undefined,
    screeningTitle: textValue(about.workdayTitle) || undefined,
    email: extractPersonEmail(getInTouch.email, name),
    orcid: extractOrcid(research),
    departments: departmentsFromAboutSection(about),
    appointmentDepartments: appointmentDepartmentsFromAboutSection(about),
    primaryAppointmentUnits: primaryAppointmentUnitsFromAboutSection(about),
    researchAreas,
    description: clippedText(htmlToText(research.researchDescription)),
    bio: clippedText(htmlToText(about.bio)),
    labUrl: labWebsite.url,
    labSlotAttestation: labWebsite.slotAttestation,
    labName: labWebsite.name,
    labDescription: labWebsite.description,
  };
}

/**
 * User (Researcher) observations. Identity keys on netid when derivable from a
 * person-specific @yale.edu email, otherwise on a synthetic ysm:<slug> key.
 * Every observation is sourced to the individual profile page, never the
 * directory root.
 */
/**
 * A profile screened out of person enrichment (a trainee, a non-research title, no research
 * section) still states the person's own title first-hand. When this lane has titled that
 * person before, the title alone is re-emitted so the read stays fresh and the stored title
 * settles to the page (#5801). A person the lane never titled gains nothing.
 */
export function screenedProfileTitleObservations(
  profile: YsmFacultyProfile,
  titledPersonKeys: ReadonlySet<string>,
): ObservationInput[] {
  if (!profile.title) return [];
  const { observations, entityKey } = facultyToUserObservations(profile);
  if (!titledPersonKeys.has(entityKey)) return [];
  return observations.filter((observation) => observation.field === 'title');
}

export function facultyToUserObservations(
  profile: YsmFacultyProfile,
  canonicalDepartment: CanonicalDepartment | null = null,
): {
  observations: ObservationInput[];
  entityKey: string;
} {
  const { first, last } = splitName(profile.name);
  const netid = netidFromEmail(profile.email);
  const entityKey = netid ? `netid:${netid}` : `ysm:${profile.slug}`;
  const base = { entityType: 'user' as const, entityKey, sourceUrl: profile.profileUrl };
  const obs: ObservationInput[] = [];

  const statedNetid = asYaleNetid(netid);
  if (statedNetid) obs.push({ ...base, field: 'netid', value: statedNetid });
  if (first) obs.push({ ...base, field: 'fname', value: first });
  if (last) obs.push({ ...base, field: 'lname', value: last });
  obs.push({ ...base, field: 'userType', value: classifyUserType(profile.screeningTitle) });
  const homeDepartment = ysmHomeDepartment(profile, canonicalDepartment);
  if (homeDepartment) obs.push({ ...base, field: 'primaryDepartment', value: homeDepartment });
  if (profile.departments.length > 0) {
    obs.push({ ...base, field: 'departments', value: profile.departments });
  }
  if (profile.email) obs.push({ ...base, field: 'email', value: profile.email });
  if (profile.title) obs.push({ ...base, field: 'title', value: profile.title });
  obs.push({
    ...base,
    field: 'profileUrls',
    value: { medicine: profile.profileUrl, official: profile.profileUrl },
  });
  if (profile.orcid) obs.push({ ...base, field: 'orcid', value: profile.orcid });
  if (profile.bio) obs.push({ ...base, field: 'bio', value: profile.bio });
  if (profile.researchAreas.length > 0) {
    obs.push({ ...base, field: 'researchInterests', value: profile.researchAreas });
    obs.push({ ...base, field: 'topics', value: profile.researchAreas });
  }
  obs.push({ ...base, field: 'dataSources', value: [SOURCE_KEY] });

  return { observations: obs, entityKey };
}

export interface ProfileLabWebsiteClassification {
  isOwnResearchHome: boolean;
  adoptableName?: string;
  verdict: ReturnType<typeof classifyHarvestedResearchHomeName> | 'NO_LINK';
}

/**
 * Decides whether the profile's linked "lab website" may be this person's
 * research-home identity. The YSM profile content model offers one such slot for
 * both "my lab" and "a center I am affiliated with", so an affiliation link must
 * not become the entity's name, type, or website (issue #2234).
 *
 * `knownPersonSurnames` is the directory's own roster of surnames, which is what
 * lets an eponymous name reading as somebody else's lab be refused when the
 * linked site's path never spells the surname out (#2361).
 *
 * The linked site is handed over twice, as the page the name came off and as the URL
 * the slot cites, because the two answer different questions: the first corroborates
 * whose eponym the name is, and the second is what says a name naming the shared
 * academic host the slot links belongs to that host organization and not to this
 * person (#2360). This slot is a faculty directory's, which is the page shape the
 * graft arrives on, so refusing it here is what keeps the repair from re-reporting
 * the same row after every scrape.
 */
export function classifyProfileLabWebsite(
  profile: Pick<YsmFacultyProfile, 'name' | 'labUrl' | 'labName' | 'labDescription'>,
  knownPersonSurnames: ReadonlySet<string>,
): ProfileLabWebsiteClassification {
  if (!profile.labUrl) return { isOwnResearchHome: false, verdict: 'NO_LINK' };
  const verdict = classifyHarvestedResearchHomeName({
    harvestedName: profile.labName,
    personName: profile.name,
    websiteUrl: profile.labUrl,
    harvestedDescription: profile.labDescription,
    knownPersonSurnames,
    recordCitedUrls: [profile.labUrl],
  });
  if (verdict === 'AFFILIATED_ORGANIZATION' || verdict === 'ANOTHER_PERSONS_LAB') {
    return { isOwnResearchHome: false, verdict };
  }
  return {
    isOwnResearchHome: true,
    adoptableName: verdict === 'OWN_IDENTITY' ? profile.labName : undefined,
    verdict,
  };
}

function researchEntityKeyOf(faculty: Pick<RawYsmFaculty, 'slug'>): string {
  return `ysm-faculty-${faculty.slug}`.slice(0, 100);
}

export function ysmFacultyResearchEntityKeyForProfileUrl(profileUrl: string): string {
  const slug = profileSlugFromUrl(profileUrl.replace(/[?#].*$/, ''));
  return slug ? researchEntityKeyOf({ slug }) : '';
}

export function skippedProfileRefusedWebsiteObservations(
  profile: YsmFacultyProfile,
): ObservationInput[] {
  if (!profile.labUrl) return [];
  return [
    {
      entityType: 'researchEntity',
      entityKey: researchEntityKeyOf(profile),
      sourceUrl: profile.profileUrl,
      field: REFUSED_WEBSITE_URL_FIELD,
      value: profile.labUrl,
    },
  ];
}

/**
 * ResearchEntity observations. A profile whose own research section links a
 * lab website that is plausibly that person's own research home seeds a LAB home
 * with that site as the websiteUrl; a link to an organization the person is
 * merely affiliated with is not an identity, so it seeds neither the name nor
 * the LAB type nor the websiteUrl (issue #2234). Otherwise a
 * profile with governed research areas or a research description seeds a
 * FACULTY_RESEARCH_AREA home
 * whose only cited source is the profile page. Returns [] for a profile with
 * none of those so nothing empty is minted.
 *
 * The lead PI is keyed on the person-specific email when present, mirroring
 * yseFacultyDirectoryScraper: identity here comes from the person's own
 * profile, not a name search against the researcher collection, so this never risks
 * the surname-collision failure mode fixed in #562/#579.
 */
export function facultyToResearchEntityObservations(
  profile: YsmFacultyProfile,
  fallbackUserKey: string,
  knownPersonSurnames: ReadonlySet<string>,
  labUrlIsUnusable: LabUrlIsUnusable = () => false,
  labUrlIsCoLedGroupSite: LabUrlIsCoLedGroupSite = () => false,
): ObservationInput[] {
  const linkedSite = classifyProfileLabWebsite(profile, knownPersonSurnames);
  if (!profile.labUrl && profile.researchAreas.length === 0 && !profile.description) return [];
  // `classifyProfileLabWebsite` answers whose lab the link names from the page
  // alone. It cannot see what the corpus has since decided about that URL, and
  // `wrong_owner` is exactly the verdict it misses: the slot names a lab this
  // person works in rather than runs, which reads as an own research home on the
  // page and is refused at write time. Without this the refusal withheld only the
  // `websiteUrl`, and the name, kind, and `entityType` kept asserting the lab
  // (#3452). Withdrawal needs a positive verdict, never silence - see
  // `labUrlIsUnusableForResearchHome`.
  const linkIsOwnSite =
    linkedSite.isOwnResearchHome && !(profile.labUrl && labUrlIsUnusable(profile.labUrl));
  // The slot is labelled for a lab whatever it links, so a person's own name-domain site
  // under a non-identifying label names no lab: it is the person's website (#4552).
  const linksPersonalWebsite =
    linkIsOwnSite &&
    !linkedSite.adoptableName &&
    isPersonalNameDomainWebsite(profile.labUrl, profile.name);
  // A slot naming an organization the person leads keeps the site as their website, but the
  // organization's name and type stay on the organization's own row (#5283).
  const linksAnOrganization =
    Boolean(linkedSite.adoptableName) &&
    !isLabShapedResearchHome(linkedSite.adoptableName, profile.labUrl);
  const linksCoLedGroupSite = linkIsOwnSite && labUrlIsCoLedGroupSite(profile.labUrl!);
  const hasLab =
    linkIsOwnSite && !linksPersonalWebsite && !linksAnOrganization && !linksCoLedGroupSite;

  const slug = researchEntityKeyOf(profile);
  const entityName = hasLab
    ? linkedSite.adoptableName || `${profile.name} Lab`
    : `${profile.name} Faculty Research`;
  const sourceUrls = linkIsOwnSite ? [profile.profileUrl, profile.labUrl!] : [profile.profileUrl];
  const piUserKey = profile.email || fallbackUserKey;
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: slug,
    sourceUrl: profile.profileUrl,
  };

  // Only an empty lab slot is an absence. `hasLab` is also false when the slot is
  // POPULATED and `classifyProfileLabWebsite` refuses the link as an affiliated
  // organization or another person's lab, and that refusal is a judgement about a
  // link the page still carries - the opposite of the page having dropped it. Field
  // retraction cannot tell the two apart from the observation log, so the
  // distinction has to be stated here, at the only place that knows it (#2647).
  const labSlotIsEmpty = !profile.labUrl && profile.labSlotAttestation === 'empty';

  const obs: ObservationInput[] = [
    {
      ...base,
      field: 'slug',
      value: slug,
      ...(labSlotIsEmpty ? { assertsNoValueFor: ['websiteUrl'] } : {}),
    },
    { ...base, field: 'name', value: entityName },
    { ...base, field: 'kind', value: hasLab ? 'lab' : 'individual' },
    { ...base, field: 'entityType', value: hasLab ? 'LAB' : 'FACULTY_RESEARCH_AREA' },
    { ...base, field: 'school', value: ysmResearchEntitySchool(profile) },
    { ...base, field: 'sourceUrls', value: sourceUrls },
    {
      ...base,
      field: 'inferredPiUserKey',
      value: piUserKey,
      confidenceOverride: INFERRED_PI_CONFIDENCE,
    },
  ];

  if (profile.departments.length > 0) {
    obs.push({ ...base, field: 'departments', value: profile.departments });
  }
  if (linkIsOwnSite) obs.push({ ...base, field: 'websiteUrl', value: profile.labUrl });
  else if (profile.labUrl) {
    obs.push({ ...base, field: REFUSED_WEBSITE_URL_FIELD, value: profile.labUrl });
  }
  if (profile.researchAreas.length > 0) {
    obs.push({ ...base, field: 'researchAreas', value: profile.researchAreas });
  }
  if (profile.description) {
    obs.push({
      ...base,
      field: 'fullDescription',
      value: profile.description,
      confidenceOverride: PROFILE_DESCRIPTION_CONFIDENCE,
    });
  }

  return obs;
}

function directoryNameCensus(
  roster: readonly RawYsmFaculty[],
): Array<{ nameKey: string; identity: string }> {
  return roster.map((entry) => {
    const { first, last } = splitName(entry.name);
    return { nameKey: personNameKey(first, last), identity: entry.slug };
  });
}

function matchesOnlyFilter(faculty: RawYsmFaculty, only: string[]): boolean {
  const normalized = new Set(
    [faculty.slug, faculty.name, faculty.profileUrl].map((value) => value.toLowerCase().trim()),
  );
  return only.some((value) => normalized.has(value.toLowerCase().trim()));
}

async function fetchHtml(
  url: string,
  useCache: boolean,
  pageReads?: LanePageReads,
): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const cacheKey = `page:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(SOURCE_KEY, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const res = await retryOnRetryableStatus(() =>
    axios.get(safeUrlText, {
      timeout: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT },
      maxRedirects: 5,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
    }),
  );
  pageReads?.recordRead(url, res.request?.res?.responseUrl || url);
  const html = res.data as string;
  if (useCache) await setCached(SOURCE_KEY, cacheKey, html);
  return html;
}

export class YsmFacultyDirectoryScraper implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'YSM faculty directory and individual profiles';

  constructor(
    private readonly htmlFetcher: HtmlFetcher = fetchHtml,
    private readonly labUrlEvidenceLoader: LabUrlEvidenceLoader = loadLabUrlEvidenceBySlug,
    private readonly pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly probePage?: LanePageProbe,
    private readonly coLedSiteIndexLoader: CoLedSiteIndexLoader = loadCoLedSiteIndex,
    private readonly titledPersonKeysLoader: TitledPersonKeysLoader = loadLaneTitledPersonKeys,
    private readonly catalogDepartmentLoader: () => Promise<CanonicalDepartment | null> = () =>
      mongooseConnectionWasOpened() ? catalogDepartment() : Promise.resolve(null),
    private readonly catalogSchoolLoader: () => Promise<SchoolForDepartment | null> = () =>
      mongooseConnectionWasOpened() ? catalogSchoolForDepartment() : Promise.resolve(null),
  ) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const offsetOption = ctx.options.offset;
    if (offsetOption !== undefined && (!Number.isSafeInteger(offsetOption) || offsetOption < 0)) {
      throw new Error('--offset must be a safe non-negative integer');
    }

    ctx.log(`Fetching ${DIRECTORY_URL}`);
    const directoryHtml = await this.htmlFetcher(DIRECTORY_URL, ctx.options.useCache);
    const roster = parseYsmFacultyDirectory(directoryHtml);
    ctx.log(`Parsed ${roster.length} faculty-directory entries`);

    const only = ctx.options.only || [];
    const selected = only.length ? roster.filter((r) => matchesOnlyFilter(r, only)) : roster;
    const offset = offsetOption && offsetOption > 0 ? offsetOption : 0;
    const offsetRoster = offset > 0 ? selected.slice(offset) : selected;
    const limited = limitOption ? offsetRoster.slice(0, limitOption) : offsetRoster;

    // Built from the whole roster rather than the limited slice: whose lab a
    // harvested name claims does not depend on how many profiles this run walks,
    // and a `--limit` run must reach the same verdict as a full one (#2361).
    //
    // That whole roster is the A-Z directory, so this vocabulary is every surname of
    // ~14k faculty, staff, and trainees - wider than the Researcher-collection roster
    // the collision envelope in `claimsAnotherPersonsLab` was measured against, and
    // unmeasured itself. It accepts more collisions in exchange: a single-token
    // topical name whose eponym-position word is also some staff member's surname is
    // classified ANOTHER_PERSONS_LAB and loses its name, type, and lab website. It
    // cannot be narrowed to research roles here - a role needs the person's own
    // profile, and this run only fetches the limited slice (#2368/#2369).
    const directorySurnames = personSurnamesFromDisplayNames(roster.map((entry) => entry.name));
    const canonicalDepartment = await this.catalogDepartmentLoader();
    const schoolForDepartment = await this.catalogSchoolLoader();
    const rekeyReads = new RekeyedPersonReads(SOURCE_KEY);
    rekeyReads.recordLaneNames(directoryNameCensus(roster));
    const labUrlEvidenceBySlug = await this.labUrlEvidenceLoader(
      limited.map((faculty) => `ysm-faculty-${faculty.slug}`),
    );
    const coLedSites = await this.coLedSiteIndexLoader();
    const titledPersonKeys = await this.titledPersonKeysLoader(SOURCE_KEY);

    let totalObs = 0;
    let profilesScanned = 0;
    let researchersEnriched = 0;
    let entityCount = 0;
    let subordinateRankSkipped = 0;
    let supportStaffSkipped = 0;
    let teachingAppointmentSkipped = 0;
    let labCount = 0;
    let withdrawnLabCount = 0;
    let areaCount = 0;

    let screenedTitlesRefreshed = 0;
    const emitScreenedProfileTitle = async (profile: YsmFacultyProfile): Promise<number> => {
      const refresh = screenedProfileTitleObservations(profile, titledPersonKeys);
      if (refresh.length === 0) return 0;
      await ctx.emit(refresh);
      screenedTitlesRefreshed += 1;
      return refresh.length;
    };

    const emitSkippedProfileRefusal = async (profile: YsmFacultyProfile): Promise<number> => {
      const refusal = skippedProfileRefusedWebsiteObservations(profile);
      if (refusal.length > 0) await ctx.emit(refusal);
      return refusal.length;
    };

    const pageReads = new LanePageReads();
    const refusedProfiles: RawYsmFaculty[] = [];
    let refusedProfilesRecovered = 0;
    const fetchProfile = (faculty: RawYsmFaculty) =>
      this.htmlFetcher(faculty.profileUrl, ctx.options.useCache, pageReads);
    const consumeProfile =
      (pass: 'first' | 'retry') =>
      async (faculty: RawYsmFaculty, fetched: PromiseSettledResult<string>): Promise<void> => {
        if (pass === 'first') profilesScanned += 1;
        if (fetched.status === 'rejected') {
          pageReads.recordFailure(faculty.profileUrl, fetched.reason);
          const status = fetchFailureStatusCode(fetched.reason);
          if (pass === 'first' && status !== undefined && REFUSAL_STATUS_CODES.has(status)) {
            refusedProfiles.push(faculty);
            return;
          }
          ctx.log(`[${faculty.slug}] profile fetch failed: ${sanitizeLogValue(fetched.reason)}`);
          return;
        }
        if (pass === 'retry') refusedProfilesRecovered += 1;
        const profileHtml = fetched.value;

        const profile = extractProfile(profileHtml, faculty);
        if (!profile) return;
        rekeyReads.recordListingRead(profile.profileUrl, { complete: true });
        if (looksLikeNonResearchTitle(profile.screeningTitle)) {
          totalObs += await emitScreenedProfileTitle(profile);
          totalObs += await emitSkippedProfileRefusal(profile);
          return;
        }
        // A trainee works in somebody else's lab, so their profile mints no
        // research home of their own and cannot inherit their PI's lab name
        // (#2304, the mint-side cause of the #2285 grafts). A lab technician,
        // instrument technologist or research librarian works in somebody else's
        // lab for the same reason, and matched neither screen before #3410.
        if (isSubordinateResearchRank(profile.screeningTitle)) {
          subordinateRankSkipped += 1;
          totalObs += await emitScreenedProfileTitle(profile);
          totalObs += await emitSkippedProfileRefusal(profile);
          return;
        }
        if (!profile.labUrl && profile.researchAreas.length === 0 && !profile.description) {
          totalObs += await emitScreenedProfileTitle(profile);
          return;
        }

        researchersEnriched += 1;
        const { observations: userObs, entityKey } = facultyToUserObservations(
          profile,
          canonicalDepartment,
        );
        await ctx.emit(userObs);
        rekeyReads.recordPerson(userObs);
        totalObs += userObs.length;

        // After the person observations, not before them, because a support-staff
        // profile still describes a real person: their title is the evidence the
        // retirement pass keys on, so screening ahead of the emit would stop
        // refreshing the very claim that judges the row (#3410). The two screens above
        // still skip person enrichment, which predates this change.
        if (isResearchSupportStaffTitle(profile.screeningTitle)) {
          supportStaffSkipped += 1;
          totalObs += await emitSkippedProfileRefusal(profile);
          return;
        }

        if (
          mintsNoResearchEntityAsTeachingAppointment(profile.screeningTitle, {
            fullDescription: profile.description,
          })
        ) {
          teachingAppointmentSkipped += 1;
          totalObs += await emitSkippedProfileRefusal(profile);
          return;
        }

        const entityObs = facultyToResearchEntityObservations(
          {
            ...profile,
            primaryAppointmentSchool: ysmPrimaryAppointmentSchool(profile, schoolForDepartment),
          },
          entityKey,
          directorySurnames,
          labUrlUnusabilityFor(labUrlEvidenceBySlug, `ysm-faculty-${profile.slug}`),
          coLedGroupSiteFor(coLedSites, `ysm-faculty-${profile.slug}`, {
            email: profile.email,
            netid: netidFromEmail(profile.email) ?? undefined,
            profileUrl: profile.profileUrl,
          }),
        );
        if (entityObs.length > 0) {
          await ctx.emit(entityObs);
          totalObs += entityObs.length;
          entityCount += 1;
          if (entityObs.some((obs) => obs.field === 'websiteUrl')) labCount += 1;
          else if (profile.labUrl) withdrawnLabCount += 1;
          if (profile.researchAreas.length > 0) areaCount += 1;
        }
      };
    await forEachInOrderWithPrefetch(
      limited,
      PROFILE_FETCH_LOOKAHEAD,
      fetchProfile,
      consumeProfile('first'),
    );

    if (refusedProfiles.length > 0) {
      ctx.log(
        `Retrying ${refusedProfiles.length} refused profile(s) once after a ${REFUSED_PROFILE_RETRY_PAUSE_MS} ms pause`,
      );
      await this.pause(REFUSED_PROFILE_RETRY_PAUSE_MS);
      await forEachInOrderWithPrefetch(
        refusedProfiles,
        PROFILE_FETCH_LOOKAHEAD,
        fetchProfile,
        consumeProfile('retry'),
      );
    }
    const refusedProfilesLost = refusedProfiles.length - refusedProfilesRecovered;
    const pageHealth = await emitLanePageHealthForCitedPages(
      ctx,
      pageReads,
      this.probePage,
      only.length ? { entityKeys: selected.map(researchEntityKeyOf) } : undefined,
    );
    totalObs += pageHealth.gone + pageHealth.restored;
    const rekeyed = await settleRekeyedPersonReads(rekeyReads, ctx);

    ctx.log(
      `Emitted ${totalObs} observations across ${researchersEnriched} researchers / ${entityCount} entities ` +
        `(${labCount} with lab sites, ${withdrawnLabCount} whose linked lab site the corpus refuses, ` +
        `${areaCount} with research areas) of ${profilesScanned} profiles scanned; ` +
        `${subordinateRankSkipped} skipped as subordinate research ranks, ` +
        `${supportStaffSkipped} skipped as research-support staff, ` +
        `${teachingAppointmentSkipped} skipped as teaching appointments, ` +
        `${screenedTitlesRefreshed} screened profiles' titles refreshed; ` +
        `${refusedProfiles.length} refused on the first pass, ${refusedProfilesRecovered} recovered on the retry, ${refusedProfilesLost} lost`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: researchersEnriched + entityCount,
      notes:
        `YSM faculty directory: ${researchersEnriched} researchers with research content, ` +
        `${entityCount} research homes (${labCount} labs, ${areaCount} with areas) of ${profilesScanned} profiles scanned, ` +
        `${subordinateRankSkipped} subordinate ranks skipped, ` +
        `${supportStaffSkipped} research-support staff skipped, ` +
        `${teachingAppointmentSkipped} teaching appointments skipped, ` +
        `${screenedTitlesRefreshed} screened profiles' titles refreshed, ` +
        `${refusedProfiles.length} profiles refused then ${refusedProfilesRecovered} recovered on a second pass` +
        (rekeyed.note ? `; ${rekeyed.note}` : ''),
      ...(rekeyed.partialFailure ? { partialFailures: [rekeyed.partialFailure] } : {}),
    };
  }
}
