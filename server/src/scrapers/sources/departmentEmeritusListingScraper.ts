/**
 * `department-emeritus-listings` (#5835): reads the emeritus faculty page a department publishes
 * and records, on each row a listed person already leads, that their department lists them as
 * emeritus. It is evidence about a lead and nothing else: it never mints a row, an edge or a
 * roster member, and a person it cannot place on a row they lead is skipped.
 *
 * The owner's precedence (2026-11-11) is that a fresh read of the person's own page wins, so a
 * listing is recorded only for a lead whose stored title no live observation backs, or whose title
 * already holds only emeritus appointments. A lead whose current title a live lane still asserts
 * is left to that title. `decideEmeritusWayIn` then treats a recorded lead as emeritus.
 *
 * It also records a lead whose own profile page, as the profile lanes already stored it, holds only
 * emeritus appointments (#6081), from stored observations and with no fetch.
 *
 * Deterministic and manual-only. A page that cannot be read leaves the rows it gave before alone.
 */
import * as cheerio from 'cheerio';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import {
  titleHoldsActiveFacultyAppointment,
  titleHoldsOnlyEmeritusAppointments,
} from '../../services/emeritusLeadWayIn';
import { researcherNetid } from '../../utils/researcherIdentity';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { departmentsAgree } from '../utils/labScienceAdviserRule';
import { observedPersonNameAgreesWith } from '../utils/personNameAgreement';
import {
  ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD,
  parseRosterMemberIdentityEvidence,
} from '../utils/rosterMemberIdentityEvidence';
import { surnameFetchRegex } from '../utils/piNameMatch';
import { splitName } from '../utils/scraperHelpers';
import { defaultMentorFetchText, listedNameAgrees } from './officialUndergradListScraper';
import {
  defaultAdvisorResolution,
  existingLeadRowsForOwner,
  leadRowDepartmentsForOwner,
  researcherToUserMatch,
  type UserMatch,
} from './undergradFellowshipRecipientScraper';

export const DEPARTMENT_EMERITUS_LISTINGS_SOURCE = 'department-emeritus-listings';
export const EMERITUS_LISTED_LEADS_FIELD = 'emeritusListedLeadIds';

export interface EmeritusListingPage {
  department: string;
  url: string;
}

export const DEPARTMENT_EMERITUS_LISTING_PAGES: readonly EmeritusListingPage[] = [
  { department: 'Anthropology', url: 'https://anthropology.yale.edu/people/emeritus-faculty' },
  { department: 'Black Studies', url: 'https://blackstudies.yale.edu/people/emeritus-faculty' },
  { department: 'Chemistry', url: 'https://chem.yale.edu/people/emeriti' },
  { department: 'Classics', url: 'https://classics.yale.edu/people/emeritus-faculty' },
  { department: 'Cognitive Science', url: 'https://cogsci.yale.edu/people/emeritus-faculty' },
  {
    department: 'Comparative Literature',
    url: 'https://complit.yale.edu/people/emeritus-faculty',
  },
  { department: 'English', url: 'https://english.yale.edu/people/emeritus-faculty' },
  { department: 'French', url: 'https://french.yale.edu/people/emeritus-faculty' },
  {
    department: 'Italian Language and Literature',
    url: 'https://italian.yale.edu/people/emeritus-faculty',
  },
  { department: 'Judaic Studies', url: 'https://jewishstudies.yale.edu/people/emeritus-faculty' },
  { department: 'Linguistics', url: 'https://ling.yale.edu/people/emeritus-faculty' },
  { department: 'Mathematics', url: 'https://math.yale.edu/people/emeritus-faculty' },
  {
    department: 'Molecular, Cellular and Developmental Biology',
    url: 'https://mcdb.yale.edu/people/emeritus-faculty',
  },
  { department: 'Medieval Studies', url: 'https://medieval.yale.edu/people/emeritus-faculty' },
  {
    department: 'Near Eastern Languages & Civilizations',
    url: 'https://nelc.yale.edu/people/emeritus-faculty',
  },
  { department: 'Philosophy', url: 'https://philosophy.yale.edu/people/emeritus-faculty' },
  { department: 'Religious Studies', url: 'https://religiousstudies.yale.edu/people/emeriti' },
  {
    department: "Women's, Gender, and Sexuality Studies",
    url: 'https://wgss.yale.edu/people/emeritus-faculty',
  },
];

export interface EmeritusListedPerson {
  name: string;
  profileUrl?: string;
}

const PERSON_CARD_LINKS = [
  'h3.directory-listing-card__heading a',
  'h3.reference-card__heading a',
  'td.views-field-name a',
  '.field-content.name a',
].join(', ');

/** The people an emeritus page lists: each card's name and the profile it links. */
export function emeritusListingPeople(html: string, pageUrl: string): EmeritusListedPerson[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const people: EmeritusListedPerson[] = [];
  $(PERSON_CARD_LINKS).each((_, element) => {
    const name = $(element).text().replace(/\s+/g, ' ').trim();
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    let profileUrl: string | undefined;
    try {
      const href = $(element).attr('href');
      profileUrl = href ? new URL(href, pageUrl).toString() : undefined;
    } catch {
      profileUrl = undefined;
    }
    people.push({ name, ...(profileUrl ? { profileUrl } : {}) });
  });
  return people;
}

export interface EmeritusListedLead {
  researcherId: string;
  slugs: string[];
}

export type EmeritusLeadResolver = (
  person: EmeritusListedPerson,
  page: EmeritusListingPage,
) => Promise<EmeritusListedLead | null>;

const profileUrlVariants = (url: string): string[] => {
  const bare = url.replace(/\/+$/, '');
  const http = bare.replace(/^https:\/\//, 'http://');
  return [bare, `${bare}/`, http, `${http}/`];
};

async function soleHolderOfProfileUrl(url: string): Promise<any | null> {
  const holders: any[] = await Researcher.find({
    archived: { $ne: true },
    'profileLinks.url': { $in: profileUrlVariants(url) },
  })
    .select('_id displayName profile identifiers profileLinks')
    .limit(2)
    .lean();
  return holders.length === 1 ? holders[0] : null;
}

async function liveNamesakes(name: string): Promise<number> {
  const { last } = splitName(name);
  const surnameRe = surnameFetchRegex(last);
  if (!surnameRe) return 0;
  return Researcher.countDocuments({ displayName: surnameRe, archived: { $ne: true } });
}

// The Yale directory's title is the HR record, which is often the appointment a person held
// before retiring, so it is not a read of the person's own page and does not outrank a listing.
const DIRECTORY_TITLE_SOURCES = ['yale-directory', 'yale-directory-csv'];

function userKeysOfResearcher(researcher: any): Record<string, unknown>[] {
  const netid = researcherNetid(researcher).toLowerCase();
  const profilePages = (researcher.profileLinks ?? [])
    .map((link: any) => (typeof link?.url === 'string' ? link.url.trim() : ''))
    .filter(Boolean)
    .flatMap(profileUrlVariants);
  return [
    { entityId: researcher._id },
    ...(netid ? [{ entityKey: { $in: [netid, `netid:${netid}`] } }] : []),
    ...(profilePages.length ? [{ sourceUrl: { $in: profilePages } }] : []),
  ];
}

/**
 * A stored title a live lane other than the directory still asserts about this person is a
 * current read of them, so the department listing does not override it; a title only the
 * directory or nothing asserts any more is a leftover the listing outranks.
 */
async function storedTitleIsBacked(researcher: any): Promise<boolean> {
  const title = researcher?.profile?.title;
  if (typeof title !== 'string' || !title.trim()) return false;
  return Boolean(
    await Observation.exists({
      entityType: 'user',
      field: 'title',
      superseded: { $ne: true },
      sourceName: { $nin: DIRECTORY_TITLE_SOURCES },
      value: title.trim(),
      $or: userKeysOfResearcher(researcher),
    }),
  );
}

/**
 * The rows a listed person leads, when the listing may stand for them. A profile link binds when
 * exactly one live researcher holds it and carries the listed name; otherwise the name binds only
 * when one researcher carries it and their rows agree with the page's department.
 */
export const defaultEmeritusLeadResolver: EmeritusLeadResolver = async (person, page) => {
  let researcher: any = person.profileUrl ? await soleHolderOfProfileUrl(person.profileUrl) : null;
  let owner: UserMatch | null = researcher
    ? researcherToUserMatch(researcher, researcherNetid(researcher))
    : null;
  if (owner && !listedNameAgrees(person.name, owner)) owner = null;
  if (!owner) {
    const resolution = await defaultAdvisorResolution(person.name);
    if (resolution.status !== 'matched' || !resolution.match) return null;
    if (
      (await liveNamesakes(person.name)) > 1 &&
      !listedNameAgrees(person.name, resolution.match)
    ) {
      return null;
    }
    const own = await leadRowDepartmentsForOwner(resolution.match);
    if (!departmentsAgree([page.department], [...own.departments, ...own.affiliations]))
      return null;
    owner = resolution.match;
    researcher = await Researcher.findById(owner._id)
      .select('_id profile identifiers profileLinks')
      .lean();
  }
  if (!researcher) return null;
  if (
    !titleHoldsOnlyEmeritusAppointments(researcher.profile?.title) &&
    (await storedTitleIsBacked(researcher))
  ) {
    return null;
  }
  const slugs = (await existingLeadRowsForOwner(owner)).map((row) => row.slug).sort();
  return slugs.length ? { researcherId: String(owner._id), slugs } : null;
};

// The profile lane's title read still stores captured navigation menus on some sites (#6177),
// so its reads can show a current appointment but never by themselves make a lead emeritus.
const EMERITUS_VETO_ONLY_TITLE_SOURCES = new Set(['official-profile-pi-backfill']);
const OWN_PAGE_TITLE_FIELDS = ['title', 'profileTitle'];

export interface OwnPageTitleRead {
  value: unknown;
  sourceName: string;
  observedAt: Date | string;
}

const readMarksEmeritus = (read: OwnPageTitleRead): boolean =>
  titleHoldsOnlyEmeritusAppointments(read.value) &&
  !EMERITUS_VETO_ONLY_TITLE_SOURCES.has(read.sourceName);

/**
 * Whether the freshest decisive read of the person's own profile page holds only emeritus
 * appointments (#6081). A read is decisive when it holds only emeritus appointments from a
 * source allowed to say so, or names a current faculty appointment; anything else is ignored,
 * so a fresh current appointment on the person's own page wins over an older emeritus read.
 */
export function ownPageTitlesSayEmeritus(reads: readonly OwnPageTitleRead[]): boolean {
  const decisive = reads
    .filter((read) => readMarksEmeritus(read) || titleHoldsActiveFacultyAppointment(read.value))
    .sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
  return decisive.length > 0 && readMarksEmeritus(decisive[0]);
}

const ownProfilePages = (researcher: any): string[] =>
  (researcher.profileLinks ?? [])
    .map((link: any) => (typeof link?.url === 'string' ? link.url.trim() : ''))
    .filter(Boolean)
    .flatMap(profileUrlVariants);

export type OwnProfileEmeritusLeadFinder = () => Promise<EmeritusListedLead[]>;

const listedNameOf = (value: unknown): string => {
  const name = value as { fname?: unknown; lname?: unknown } | null;
  return [name?.fname, name?.lname]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
};

/**
 * The researcher a roster member is, decided only by the identity evidence the member's own
 * profile page states: a netid or Yale email that exactly one live researcher holds, whose name
 * agrees with the listed name. Anything else resolves to nobody.
 */
async function researcherForRosterMember(
  sourceName: string,
  entityKey: string,
): Promise<any | null> {
  const rows: any[] = await Observation.find({
    sourceName,
    entityKey,
    field: { $in: [ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD, 'inferredUserName'] },
    superseded: { $ne: true },
  })
    .select('field value')
    .lean();
  const evidence = parseRosterMemberIdentityEvidence(
    rows.find((row) => row.field === ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD)?.value,
  );
  const listedName = listedNameOf(rows.find((row) => row.field === 'inferredUserName')?.value);
  if (!evidence || !listedName) return null;
  const keys = [
    ...(evidence.netids.length ? [{ 'identifiers.netid': { $in: evidence.netids } }] : []),
    ...(evidence.emails.length ? [{ 'identifiers.email': { $in: evidence.emails } }] : []),
  ];
  if (keys.length === 0) return null;
  const holders: any[] = await Researcher.find({ archived: { $ne: true }, $or: keys })
    .select('_id displayName profile identifiers profileLinks')
    .limit(3)
    .lean();
  const agreeing = holders.filter((holder) =>
    observedPersonNameAgreesWith(holder.displayName, listedName),
  );
  return holders.length === 1 && agreeing.length === 1 ? agreeing[0] : null;
}

const OWN_PAGE_TITLE_SELECT = 'value sourceName observedAt entityType entityKey entityId sourceUrl';
const OWN_PROFILE_URL_FIELDS = ['profileUrl', 'profileUrls'];

const bareUrl = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .trim()
        .replace(/\/+$/, '')
        .replace(/^http:\/\//, 'https://')
    : '';

const statedProfileUrls = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>);
  return [value];
};

/**
 * A read of a page is a read of the person only when the observation's own entity is the person:
 * their netid-keyed user row, or a row whose own profile URL observation names that same page. A
 * shared page in the person's profile links, such as a lab's people page, carries other people's
 * card titles, so a page URL never binds a read by itself.
 */
async function readsOfThePerson(researcher: any, reads: any[]): Promise<OwnPageTitleRead[]> {
  const netid = researcherNetid(researcher).toLowerCase();
  const ownKeys = new Set(netid ? [netid, `netid:${netid}`] : []);
  const isOwnUserRow = (read: any) =>
    read.entityType === 'user' &&
    (String(read.entityId ?? '') === String(researcher._id) ||
      ownKeys.has(String(read.entityKey ?? '').toLowerCase()));
  const unresolved = reads.filter((read) => !isOwnUserRow(read));
  const statedUrls = new Map<string, Set<string>>();
  if (unresolved.length > 0) {
    const rows: any[] = await Observation.find({
      superseded: { $ne: true },
      field: { $in: OWN_PROFILE_URL_FIELDS },
      $or: unresolved.map((read) => ({ sourceName: read.sourceName, entityKey: read.entityKey })),
    })
      .select('sourceName entityKey value')
      .lean();
    for (const row of rows) {
      const key = `${row.sourceName}\u0000${row.entityKey}`;
      const urls = statedUrls.get(key) ?? new Set<string>();
      for (const url of statedProfileUrls(row.value)) if (bareUrl(url)) urls.add(bareUrl(url));
      statedUrls.set(key, urls);
    }
  }
  return reads.filter(
    (read) =>
      isOwnUserRow(read) ||
      Boolean(
        statedUrls.get(`${read.sourceName}\u0000${read.entityKey}`)?.has(bareUrl(read.sourceUrl)),
      ),
  );
}

/**
 * Leads whose own profile page, as the profile lanes already stored it, holds only emeritus
 * appointments (#6081). A read counts as the person's own page when its source URL is one of
 * their profile links, or when it is a roster member's profile title and the member's identity
 * evidence names them. Reads stored observations only and never fetches.
 */
export const defaultOwnProfileEmeritusLeadFinder: OwnProfileEmeritusLeadFinder = async () => {
  const candidates: any[] = await Observation.find({
    field: { $in: OWN_PAGE_TITLE_FIELDS },
    superseded: { $ne: true },
    value: /\bemerit/i,
    sourceName: { $nin: [...DIRECTORY_TITLE_SOURCES, ...EMERITUS_VETO_ONLY_TITLE_SOURCES] },
    sourceUrl: { $type: 'string' },
  })
    .select('entityType entityKey field sourceName sourceUrl')
    .lean();
  const memberKeysByResearcher = new Map<string, { researcher: any; members: Set<string> }>();
  const bind = (researcher: any, member?: { sourceName: string; entityKey: string }) => {
    const id = String(researcher._id);
    const bound = memberKeysByResearcher.get(id) ?? { researcher, members: new Set<string>() };
    if (member) bound.members.add(`${member.sourceName}\u0000${member.entityKey}`);
    memberKeysByResearcher.set(id, bound);
  };
  for (const candidate of candidates) {
    const byLink = await soleHolderOfProfileUrl(String(candidate.sourceUrl).replace(/\/+$/, ''));
    if (byLink) bind(byLink);
    if (candidate.entityType === 'researchGroupMember' && candidate.field === 'profileTitle') {
      const byEvidence = await researcherForRosterMember(candidate.sourceName, candidate.entityKey);
      if (byEvidence) bind(byEvidence, candidate);
    }
  }
  const leads: EmeritusListedLead[] = [];
  const ordered = [...memberKeysByResearcher.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [id, { researcher, members }] of ordered) {
    const memberReads = [...members].map((key) => {
      const [sourceName, entityKey] = key.split('\u0000');
      return { sourceName, entityKey, field: 'profileTitle' };
    });
    const reads = (await Observation.find({
      superseded: { $ne: true },
      $or: [
        {
          field: { $in: OWN_PAGE_TITLE_FIELDS },
          sourceName: { $nin: DIRECTORY_TITLE_SOURCES },
          sourceUrl: { $in: ownProfilePages(researcher) },
        },
        ...memberReads,
      ],
    })
      .select(OWN_PAGE_TITLE_SELECT)
      .lean()) as any[];
    const memberKeys = new Set(
      memberReads.map((read) => `${read.sourceName}\u0000${read.entityKey}`),
    );
    const byPage = reads.filter(
      (read) => !memberKeys.has(`${read.sourceName}\u0000${read.entityKey}`),
    );
    const byEvidence = reads.filter((read) =>
      memberKeys.has(`${read.sourceName}\u0000${read.entityKey}`),
    );
    if (!ownPageTitlesSayEmeritus([...(await readsOfThePerson(researcher, byPage)), ...byEvidence]))
      continue;
    const owner = researcherToUserMatch(researcher, researcherNetid(researcher));
    const slugs = (await existingLeadRowsForOwner(owner)).map((row) => row.slug).sort();
    if (slugs.length) leads.push({ researcherId: id, slugs });
  }
  return leads;
};

export type EmeritusListingFetchText = (url: string) => Promise<string | null>;

export type StoredEmeritusListingFinder = () => Promise<Map<string, string[]>>;

export const defaultStoredEmeritusListingFinder: StoredEmeritusListingFinder = async () => {
  const rows: any[] = await ResearchEntity.find(
    { archived: { $ne: true }, [`${EMERITUS_LISTED_LEADS_FIELD}.0`]: { $exists: true } },
    { slug: 1, [EMERITUS_LISTED_LEADS_FIELD]: 1 },
  ).lean();
  return new Map(rows.map((row) => [String(row.slug), row[EMERITUS_LISTED_LEADS_FIELD] ?? []]));
};

export interface DepartmentEmeritusListingDeps {
  pages?: readonly EmeritusListingPage[];
  fetchText?: EmeritusListingFetchText;
  resolveLead?: EmeritusLeadResolver;
  storedListingFinder?: StoredEmeritusListingFinder;
  ownProfileLeadFinder?: OwnProfileEmeritusLeadFinder;
}

export class DepartmentEmeritusListingScraper implements IScraper {
  readonly name = DEPARTMENT_EMERITUS_LISTINGS_SOURCE;
  readonly displayName = 'Department emeritus listings';
  private readonly pages: readonly EmeritusListingPage[];
  private readonly fetchText: EmeritusListingFetchText;
  private readonly resolveLead: EmeritusLeadResolver;
  private readonly storedListingFinder: StoredEmeritusListingFinder;
  private readonly ownProfileLeadFinder: OwnProfileEmeritusLeadFinder;

  constructor(deps: DepartmentEmeritusListingDeps = {}) {
    this.pages = deps.pages ?? DEPARTMENT_EMERITUS_LISTING_PAGES;
    this.fetchText = deps.fetchText ?? defaultMentorFetchText;
    this.resolveLead = deps.resolveLead ?? defaultEmeritusLeadResolver;
    this.storedListingFinder = deps.storedListingFinder ?? defaultStoredEmeritusListingFinder;
    this.ownProfileLeadFinder = deps.ownProfileLeadFinder ?? defaultOwnProfileEmeritusLeadFinder;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const only = new Set(ctx.options.only ?? []);
    const pages = this.pages.filter((page) => only.size === 0 || only.has(page.url));
    const leadsBySlug = new Map<string, Set<string>>();
    const unreadPages: string[] = [];
    const stats = { pages: pages.length, listed: 0, recorded: 0, skipped: 0, ownProfile: 0 };
    for (const page of pages) {
      const html = await this.fetchText(page.url);
      if (html === null) {
        unreadPages.push(page.url);
        continue;
      }
      for (const person of emeritusListingPeople(html, page.url)) {
        stats.listed += 1;
        const lead = await this.resolveLead(person, page);
        if (!lead) {
          stats.skipped += 1;
          continue;
        }
        stats.recorded += 1;
        for (const slug of lead.slugs) {
          const leads = leadsBySlug.get(slug) ?? new Set<string>();
          leads.add(lead.researcherId);
          leadsBySlug.set(slug, leads);
        }
      }
    }

    for (const lead of await this.ownProfileLeadFinder()) {
      stats.ownProfile += 1;
      for (const slug of lead.slugs) {
        const leads = leadsBySlug.get(slug) ?? new Set<string>();
        leads.add(lead.researcherId);
        leadsBySlug.set(slug, leads);
      }
    }

    const complete = unreadPages.length === 0 && only.size === 0;
    const stored = await this.storedListingFinder();
    const observations: ObservationInput[] = [];
    for (const [slug, leads] of leadsBySlug) {
      if (!complete) for (const previous of stored.get(slug) ?? []) leads.add(previous);
      observations.push({
        entityType: 'researchEntity',
        entityKey: slug,
        field: EMERITUS_LISTED_LEADS_FIELD,
        value: [...leads].sort(),
      });
    }
    if (complete) {
      for (const [slug, previous] of stored) {
        if (leadsBySlug.has(slug) || previous.length === 0) continue;
        observations.push({
          entityType: 'researchEntity',
          entityKey: slug,
          field: EMERITUS_LISTED_LEADS_FIELD,
          value: null,
          assertsNoValueFor: [EMERITUS_LISTED_LEADS_FIELD],
        });
      }
    }
    for (const observation of observations) await ctx.emit(observation);
    ctx.log('department emeritus listings read', { ...stats, unreadPages: unreadPages.length });
    return {
      observationCount: observations.length,
      entitiesObserved: observations.length,
      notes: `${stats.recorded} of ${stats.listed} listed people recorded on a row they lead; ${stats.ownProfile} leads emeritus by their own profile page`,
      ...(unreadPages.length ? { partialFailures: unreadPages } : {}),
    };
  }
}
