import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import { loadResearchEntityLeadPersonIds } from '../utils/researchHomeNameIdentityRoster';
import {
  invalidatedScrapeRunIds,
  partitionObservationsByInvalidatedRun,
} from './invalidatedScrapeRuns';
import {
  statedLabDeparturesInPageText,
  statedLabDepartureVerdict,
  type StatedDepartureRead,
  type StatedLabDepartureVerdict,
} from './statedLabDeparture';
import {
  RESEARCH_PAGE_TEXT_FIELD,
  RESEARCH_PAGE_TEXT_SOURCE,
  type ResearchPageTextEntry,
} from './utils/researchPageText';

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function leadSurnameForms(person: { lastName?: unknown; displayName?: unknown }): string[] {
  const displayLast = textValue(person.displayName).split(/\s+/).pop() ?? '';
  return [...new Set([textValue(person.lastName), displayLast].filter(Boolean))];
}

/**
 * Every admitted read of a row's own page text, one per run, including reads a newer run has
 * since superseded: a past read is the evidence the two-run rule needs (#6324). A rolled-back
 * read or one from an invalidated run was never admitted.
 */
async function admittedPageTextReads(slug: string): Promise<StatedDepartureRead[]> {
  const reads = (await Observation.find(
    {
      entityType: 'researchEntity',
      entityKey: slug,
      sourceName: RESEARCH_PAGE_TEXT_SOURCE,
      field: RESEARCH_PAGE_TEXT_FIELD,
      'rollback.rolledBackAt': { $exists: false },
    },
    { value: 1, scrapeRunId: 1 },
  ).lean()) as Array<{ value?: unknown; scrapeRunId?: unknown }>;
  const kept = partitionObservationsByInvalidatedRun(reads, await invalidatedScrapeRunIds()).kept;
  return kept.map((read) => ({
    runId: String(read.scrapeRunId ?? ''),
    pages: Array.isArray(read.value) ? read.value : [],
  }));
}

async function livePageText(slug: string): Promise<ResearchPageTextEntry[] | undefined> {
  const live = (await Observation.findOne(
    {
      entityType: 'researchEntity',
      entityKey: slug,
      sourceName: RESEARCH_PAGE_TEXT_SOURCE,
      field: RESEARCH_PAGE_TEXT_FIELD,
      superseded: { $ne: true },
      'rollback.rolledBackAt': { $exists: false },
    },
    { value: 1 },
  )
    .sort({ observedAt: -1 })
    .lean()) as { value?: unknown } | null;
  return live && Array.isArray(live.value) ? (live.value as ResearchPageTextEntry[]) : undefined;
}

/**
 * A lead with any stored Yale appointment title, emeritus included, keeps the row: the title is
 * read first-hand from the person's own Yale page (#5578), which outranks the lab page's
 * statement, and emeritus-led research follows the emeritus rule instead. History is read only
 * when the page still states a departure today, so a move the page no longer states never
 * counts, and the rows that state nothing cost one read.
 */
export async function loadStatedLabDeparture(input: {
  researchEntityId: string;
  slug: string;
}): Promise<StatedLabDepartureVerdict | undefined> {
  if (!input.researchEntityId || !input.slug) return undefined;
  const live = await livePageText(input.slug);
  if (!live) return undefined;
  const leads = await leadsOf(input.researchEntityId);
  const leadSurnames = leads.flatMap(leadSurnameForms);
  const liveDepartures = statedLabDeparturesInPageText(live, { leadSurnames });
  if (liveDepartures.length === 0) return { departed: false, completedRuns: 0 };
  const liveStatesCompletedMove = liveDepartures.some(
    (departure) => departure.kind === 'completed',
  );
  const verdict = statedLabDepartureVerdict({
    reads: await admittedPageTextReads(input.slug),
    leadSurnames,
    leadsHoldYaleAppointment: leads.some((lead) => Boolean(textValue(lead.profile?.title))),
  });
  // A row with no live lead has no person whose move the page could be stating.
  return leads.length === 0 || !liveStatesCompletedMove ? { ...verdict, departed: false } : verdict;
}

type LeadRecord = { lastName?: unknown; displayName?: unknown; profile?: { title?: unknown } };

async function leadsOf(researchEntityId: string): Promise<LeadRecord[]> {
  const leadIds =
    (await loadResearchEntityLeadPersonIds([researchEntityId])).get(researchEntityId) ?? [];
  if (leadIds.length === 0) return [];
  return (await Researcher.find(
    { _id: { $in: leadIds }, archived: { $ne: true } },
    { lastName: 1, displayName: 1, 'profile.title': 1 },
  ).lean()) as LeadRecord[];
}
