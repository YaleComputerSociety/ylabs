import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  DEFAULT_DEPT_CONFIGS,
  rosterResearchEntitySlug,
  type DeptConfig,
  type FacultyEntry,
} from './departmentRosterScraper';
import { ysmFacultyResearchEntityKeyForProfileUrl } from './ysmFacultyDirectoryScraper';
import {
  normalizeRosterBioUrl,
  planRosterBioResearchRows,
  rosterBioPersonNameKey,
  rosterBioProfileUrl,
  rosterBioResearchObservations,
  type RosterBioCoveredIdentities,
  type RosterBioDepartment,
  type RosterBioPerson,
} from '../utils/rosterBioResearchEvidence';

export const ROSTER_BIO_RESEARCH_EVIDENCE_SOURCE = 'roster-bio-research-evidence';
const ROSTER_SOURCE = 'dept-faculty-roster';
const PERSON_FIELDS = [
  'bio',
  'title',
  'fname',
  'lname',
  'profileUrls',
  'primaryDepartment',
  'departments',
];

export async function loadRosterBioPeople(): Promise<RosterBioPerson[]> {
  const rows = (await Observation.find({
    sourceName: ROSTER_SOURCE,
    entityType: 'user',
    field: { $in: PERSON_FIELDS },
    superseded: false,
  })
    .select('entityKey field value observedAt sourceUrl')
    .lean()) as Array<{
    entityKey: string;
    field: string;
    value: unknown;
    observedAt: Date;
    sourceUrl?: string;
  }>;
  const latest = new Map<string, Map<string, (typeof rows)[number]>>();
  for (const row of rows) {
    const fields = latest.get(row.entityKey) ?? new Map();
    const previous = fields.get(row.field);
    if (!previous || new Date(row.observedAt) > new Date(previous.observedAt)) {
      fields.set(row.field, row);
    }
    latest.set(row.entityKey, fields);
  }
  const people: RosterBioPerson[] = [];
  for (const [key, fields] of latest) {
    const bio = fields.get('bio')?.value;
    if (typeof bio !== 'string' || !bio.trim()) continue;
    people.push({
      key,
      bio,
      title: fields.get('title')?.value,
      fname: fields.get('fname')?.value,
      lname: fields.get('lname')?.value,
      profileUrls: fields.get('profileUrls')?.value,
      primaryDepartment: fields.get('primaryDepartment')?.value,
      departments: fields.get('departments')?.value,
      rosterSourceUrl: fields.get('departments')?.sourceUrl,
    });
  }
  return people.sort((a, b) => a.key.localeCompare(b.key));
}

// Archived rows count as covered on purpose: an archive is a decision about that person
// (a merge, a retirement, a wrong-person refusal) that a new mint must not undo.
export async function loadRosterBioCoveredIdentities(): Promise<RosterBioCoveredIdentities> {
  const entities = (await ResearchEntity.find({})
    .select('_id slug name websiteUrl sourceUrls archived')
    .lean()) as Array<Record<string, any>>;
  const urls = new Set<string>();
  const slugs = new Set<string>();
  const personNames = new Set<string>();
  const liveIds = new Set<string>();
  for (const entity of entities) {
    slugs.add(entity.slug);
    for (const url of [entity.websiteUrl, ...(entity.sourceUrls || [])]) {
      if (url) urls.add(normalizeRosterBioUrl(url));
    }
    if (entity.archived === true) continue;
    liveIds.add(String(entity._id));
    const nameKey = rosterBioPersonNameKey(entity.name);
    if (nameKey) personNames.add(nameKey);
  }
  const piKeys = (await Observation.find({ field: 'inferredPiUserKey', superseded: false })
    .select('entityKey value')
    .lean()) as Array<{ entityKey?: string; value?: unknown }>;
  const personKeys = new Set<string>();
  for (const row of piKeys) {
    if (row.entityKey && slugs.has(row.entityKey) && typeof row.value === 'string') {
      personKeys.add(row.value);
    }
  }
  const leadEdges = (await RoleAssignment.find({ state: { $ne: 'HISTORICAL' } })
    .select('personId target')
    .lean()) as Array<{ personId?: unknown; target?: { id?: unknown } }>;
  const leading = new Set(
    leadEdges
      .filter((edge) => liveIds.has(String(edge.target?.id)))
      .map((edge) => String(edge.personId)),
  );
  const researchers = (await Researcher.find({ archived: { $ne: true } })
    .select('_id profileLinks displayName')
    .lean()) as Array<Record<string, any>>;
  for (const researcher of researchers) {
    if (!leading.has(String(researcher._id))) continue;
    const nameKey = rosterBioPersonNameKey(researcher.displayName);
    if (nameKey) personNames.add(nameKey);
    for (const link of researcher.profileLinks || []) urls.add(normalizeRosterBioUrl(link.url));
  }
  return { urls, personKeys, personNames, slugs };
}

const configMintsPersonalRows = (config: DeptConfig): boolean =>
  config.emitPersonalResearchEntities !== false &&
  !config.affiliatesOnly &&
  !config.schoolWideDirectory &&
  !config.crossListedProgramme;

const urlHost = (value: unknown): string => normalizeRosterBioUrl(value).split('/')[0];
const MEDICAL_SCHOOL_HOST = 'medicine.yale.edu';

// The key the owning lane would mint, so a later mint from a research section lands on
// the same row: medical school departments are profile-only on the roster because the
// medical school directory lane mints their people.
export function rosterBioDepartmentResolver(
  configs: readonly DeptConfig[] = DEFAULT_DEPT_CONFIGS,
): (person: RosterBioPerson, name: string) => RosterBioDepartment | null {
  return (person, name) => {
    const listed = Array.isArray(person.departments)
      ? person.departments.map(String)
      : [String(person.primaryDepartment || '')];
    const deptName = listed.find(Boolean);
    if (!deptName) return null;
    const named = configs.filter(
      (config) => config.deptName === deptName && configMintsPersonalRows(config),
    );
    const rosterHost = urlHost(person.rosterSourceUrl);
    const onThisRoster = named.filter((config) => rosterHost && urlHost(config.url) === rosterHost);
    const candidates = onThisRoster.length > 0 ? onThisRoster : named;
    const deptKeys = new Set(candidates.map((config) => config.deptKey));
    if (deptKeys.size !== 1) return null;
    const config = candidates[0];
    const profileUrl = rosterBioProfileUrl(person);
    if (config.officialProfileOnly && urlHost(profileUrl) !== MEDICAL_SCHOOL_HOST) return null;
    const slug = config.officialProfileOnly
      ? ysmFacultyResearchEntityKeyForProfileUrl(profileUrl)
      : rosterResearchEntitySlug({ name } as FacultyEntry, config);
    if (!slug) return null;
    return { deptName: config.deptName, schoolName: config.schoolName, slug };
  };
}

/**
 * Mints a faculty-research row for a roster person whose stored profile biography states
 * research they do now, which the roster lane alone does not, because it mints only
 * from a dedicated research section. Manual-only: the owner reviews a sample of the rows
 * a run produces before the lane joins the sweep.
 */
export class RosterBioResearchEvidenceScraper implements IScraper {
  readonly name = ROSTER_BIO_RESEARCH_EVIDENCE_SOURCE;
  readonly displayName = 'Roster biography research evidence';

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const [people, covered] = await Promise.all([
      loadRosterBioPeople(),
      loadRosterBioCoveredIdentities(),
    ]);
    const { planned, skipped } = planRosterBioResearchRows(
      people,
      covered,
      rosterBioDepartmentResolver(),
    );
    const only = ctx.options.only?.length ? new Set(ctx.options.only) : null;
    const scoped = planned
      .filter((row) => !only || only.has(row.slug))
      .slice(0, ctx.options.limit ?? undefined);
    ctx.log(`roster bios ${people.length}; planned ${planned.length}; emitting ${scoped.length}`, {
      skipped,
    });
    const observations: ObservationInput[] = scoped.flatMap(rosterBioResearchObservations);
    if (observations.length) await ctx.emit(observations);
    return {
      observationCount: observations.length,
      entitiesObserved: scoped.length,
      notes: `planned ${planned.length} of ${people.length} roster bios; skipped ${JSON.stringify(skipped)}`,
    };
  }
}
