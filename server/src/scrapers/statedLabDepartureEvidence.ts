import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import { loadResearchEntityLeadPersonIds } from '../utils/researchHomeNameIdentityRoster';
import {
  invalidatedScrapeRunIds,
  partitionObservationsByInvalidatedRun,
} from './invalidatedScrapeRuns';
import {
  statedLabDepartureVerdict,
  type StatedDepartureRead,
  type StatedLabDepartureVerdict,
} from './statedLabDeparture';
import { RESEARCH_PAGE_TEXT_FIELD, RESEARCH_PAGE_TEXT_SOURCE } from './utils/researchPageText';

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

/**
 * A lead with any stored Yale appointment title, emeritus included, keeps the row: the title is
 * read first-hand from the person's own Yale page (#5578), which outranks the lab page's
 * statement, and emeritus-led research follows the emeritus rule instead.
 */
export async function loadStatedLabDeparture(input: {
  researchEntityId: string;
  slug: string;
}): Promise<StatedLabDepartureVerdict | undefined> {
  if (!input.researchEntityId || !input.slug) return undefined;
  const leadIds =
    (await loadResearchEntityLeadPersonIds([input.researchEntityId])).get(input.researchEntityId) ??
    [];
  const leads = (await Researcher.find(
    { _id: { $in: leadIds }, archived: { $ne: true } },
    { lastName: 1, displayName: 1, 'profile.title': 1 },
  ).lean()) as Array<{ lastName?: unknown; displayName?: unknown; profile?: { title?: unknown } }>;
  const reads = await admittedPageTextReads(input.slug);
  if (reads.length === 0) return undefined;
  const verdict = statedLabDepartureVerdict({
    reads,
    leadSurnames: leads.flatMap(leadSurnameForms),
    leadsHoldYaleAppointment: leads.some((lead) => Boolean(textValue(lead.profile?.title))),
  });
  // A row with no live lead has no person whose move the page could be stating.
  return leads.length === 0 ? { ...verdict, departed: false } : verdict;
}
