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
 * Deterministic and manual-only. A page that cannot be read leaves the rows it gave before alone.
 */
import * as cheerio from 'cheerio';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { titleHoldsOnlyEmeritusAppointments } from '../../services/emeritusLeadWayIn';
import { researcherNetid } from '../../utils/researcherIdentity';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { departmentsAgree } from '../utils/labScienceAdviserRule';
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
}

export class DepartmentEmeritusListingScraper implements IScraper {
  readonly name = DEPARTMENT_EMERITUS_LISTINGS_SOURCE;
  readonly displayName = 'Department emeritus listings';
  private readonly pages: readonly EmeritusListingPage[];
  private readonly fetchText: EmeritusListingFetchText;
  private readonly resolveLead: EmeritusLeadResolver;
  private readonly storedListingFinder: StoredEmeritusListingFinder;

  constructor(deps: DepartmentEmeritusListingDeps = {}) {
    this.pages = deps.pages ?? DEPARTMENT_EMERITUS_LISTING_PAGES;
    this.fetchText = deps.fetchText ?? defaultMentorFetchText;
    this.resolveLead = deps.resolveLead ?? defaultEmeritusLeadResolver;
    this.storedListingFinder = deps.storedListingFinder ?? defaultStoredEmeritusListingFinder;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const only = new Set(ctx.options.only ?? []);
    const pages = this.pages.filter((page) => only.size === 0 || only.has(page.url));
    const leadsBySlug = new Map<string, Set<string>>();
    const unreadPages: string[] = [];
    const stats = { pages: pages.length, listed: 0, recorded: 0, skipped: 0 };
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
      notes: `${stats.recorded} of ${stats.listed} listed people recorded on a row they lead`,
      ...(unreadPages.length ? { partialFailures: unreadPages } : {}),
    };
  }
}
