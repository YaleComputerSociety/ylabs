import { normalizeCitingUrl } from './queueNonOwnerLeadEdgeReviewCore';

export interface NonOwnerPiEdgeRow {
  id: string;
  personId: string;
  entityId: string;
  role: string;
  reviewStatus?: string;
  sourceName?: string;
}

export type NonOwnerPiEdgeRefusal =
  | 'lead-can-host'
  | 'own-evidence-states-owning-appointment'
  | 'edge-carries-provenance'
  | 'edge-already-reviewed';

export type TitleOwnershipPredicate = (title?: string) => boolean;

export interface LeadTitleEvidence {
  storedTitleByPersonId: ReadonlyMap<string, string>;
  ownEvidenceTitlesByPersonId: ReadonlyMap<string, readonly string[]>;
  cannotOwnResearchHome: TitleOwnershipPredicate;
  statesResearchOwningAppointment: TitleOwnershipPredicate;
}

const ownEvidenceStatesOwningAppointment = (personId: string, evidence: LeadTitleEvidence) =>
  (evidence.ownEvidenceTitlesByPersonId.get(personId) ?? []).some((title) =>
    evidence.statesResearchOwningAppointment(title),
  );

export interface OfficialProfileOwner {
  personId: string;
  officialProfileUrls: readonly string[];
}

export interface PersonTitleObservation {
  entityKey?: unknown;
  field?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
}

const profileUrlValues = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }
  return [];
};

/**
 * The titles a person's own official profile states, read from the lane observations about
 * that page rather than from the stored `profile.title`, which a namesake's roster or a stale
 * read can leave wrong with no observation behind it (#5855).
 *
 * An observation subject belongs to the person when a page that subject was read from, or a
 * profile URL it carries, is one of the person's own official profile links. A shared listing
 * page alone never joins, because only the subject's own profile URL names the person.
 */
export function ownEvidenceTitlesByPersonId(
  owners: readonly OfficialProfileOwner[],
  observations: readonly PersonTitleObservation[],
): Map<string, string[]> {
  const profileUrlsBySubject = new Map<string, Set<string>>();
  const titlesBySubject = new Map<string, Set<string>>();
  const add = (index: Map<string, Set<string>>, subject: string, value: string) => {
    if (!index.has(subject)) index.set(subject, new Set());
    index.get(subject)!.add(value);
  };
  for (const observation of observations) {
    const subject = typeof observation.entityKey === 'string' ? observation.entityKey.trim() : '';
    if (!subject) continue;
    if (observation.field === 'profileUrls') {
      for (const url of profileUrlValues(observation.value)) {
        const normalized = normalizeCitingUrl(url);
        if (normalized) add(profileUrlsBySubject, subject, normalized);
      }
    } else if (observation.field === 'title' && typeof observation.value === 'string') {
      const title = observation.value.trim();
      if (!title) continue;
      add(titlesBySubject, subject, title);
      const readFrom = normalizeCitingUrl(observation.sourceUrl);
      if (readFrom) add(profileUrlsBySubject, subject, readFrom);
    }
  }

  const subjectsByProfileUrl = new Map<string, Set<string>>();
  for (const [subject, urls] of profileUrlsBySubject) {
    if (!titlesBySubject.has(subject)) continue;
    for (const url of urls) add(subjectsByProfileUrl, url, subject);
  }

  const titlesByPersonId = new Map<string, string[]>();
  for (const owner of owners) {
    const titles = new Set<string>();
    for (const url of owner.officialProfileUrls) {
      for (const subject of subjectsByProfileUrl.get(normalizeCitingUrl(url)) ?? []) {
        for (const title of titlesBySubject.get(subject) ?? []) titles.add(title);
      }
    }
    if (titles.size > 0) titlesByPersonId.set(owner.personId, [...titles]);
  }
  return titlesByPersonId;
}

export interface NonOwnerPiEdgePlan {
  retire: NonOwnerPiEdgeRow[];
  refused: Array<{ id: string; reason: NonOwnerPiEdgeRefusal }>;
}

/**
 * Selects the lead edges to retire: a PI or DIRECTOR claim on someone whose title
 * says they cannot own a research home, whether because they are a trainee (#2876)
 * or because they hold no research appointment at all (#1897).
 *
 * Fails closed three times. A stored title alone never retires a lead whose own official
 * profile states an appointment that can own the row, since the stored field is the one
 * another lane can get wrong (#5855). An edge citing a source is left alone, because a
 * page that actually names this person as the lead is evidence worth a human read rather
 * than a bulk retirement. An edge an operator has already reviewed is left alone for the
 * same reason: a decision already made is not this lane's to reverse.
 */
export function planNonOwnerPiEdgeRetirement(
  edges: readonly NonOwnerPiEdgeRow[],
  evidence: LeadTitleEvidence,
): NonOwnerPiEdgePlan {
  const retire: NonOwnerPiEdgeRow[] = [];
  const refused: Array<{ id: string; reason: NonOwnerPiEdgeRefusal }> = [];

  for (const edge of edges) {
    if (!evidence.cannotOwnResearchHome(evidence.storedTitleByPersonId.get(edge.personId))) {
      refused.push({ id: edge.id, reason: 'lead-can-host' });
      continue;
    }
    if (ownEvidenceStatesOwningAppointment(edge.personId, evidence)) {
      refused.push({ id: edge.id, reason: 'own-evidence-states-owning-appointment' });
      continue;
    }
    if ((edge.sourceName || '').trim()) {
      refused.push({ id: edge.id, reason: 'edge-carries-provenance' });
      continue;
    }
    if ((edge.reviewStatus || 'UNREVIEWED') !== 'UNREVIEWED') {
      refused.push({ id: edge.id, reason: 'edge-already-reviewed' });
      continue;
    }
    retire.push(edge);
  }

  return { retire, refused };
}

export interface RetiredNonOwnerPiEdgeRow {
  id: string;
  personId: string;
  entityId: string;
  reviewStatus?: string;
  reviewNotes?: string;
}

export type NonOwnerPiEdgeRestorationGround =
  'stored-title-no-longer-refuses' | 'own-evidence-states-owning-appointment';

export interface RestorableNonOwnerPiEdgeRow extends RetiredNonOwnerPiEdgeRow {
  ground: NonOwnerPiEdgeRestorationGround;
}

/**
 * The edges this lane retired whose ground no longer holds: the person's current title
 * no longer refuses a research home, or the person's own official profile states an
 * appointment that can own one, so the verdict it stamped is stale. Running the lane
 * twice must re-derive the same answer, and without this half a title corrected after
 * the retirement (a page heading stored as the title, #5323) left the edge retired
 * forever, because the `DISPUTED` stamp blocks every scrape from re-attaching it. A
 * stored title that stays wrong had the same effect until the evidence ground (#5855).
 *
 * Only this lane's own verdict is reversed: an edge another lane or an operator
 * disputed, or one on a person no longer live, is left alone.
 */
export function planNonOwnerPiEdgeRestoration(
  retired: readonly RetiredNonOwnerPiEdgeRow[],
  retirementNote: string,
  evidence: LeadTitleEvidence,
): RestorableNonOwnerPiEdgeRow[] {
  return retired.flatMap((edge): RestorableNonOwnerPiEdgeRow[] => {
    if (edge.reviewNotes !== retirementNote || edge.reviewStatus !== 'DISPUTED') return [];
    if (!evidence.storedTitleByPersonId.has(edge.personId)) return [];
    if (!evidence.cannotOwnResearchHome(evidence.storedTitleByPersonId.get(edge.personId))) {
      return [{ ...edge, ground: 'stored-title-no-longer-refuses' }];
    }
    if (ownEvidenceStatesOwningAppointment(edge.personId, evidence)) {
      return [{ ...edge, ground: 'own-evidence-states-owning-appointment' }];
    }
    return [];
  });
}

export function summarizeNonOwnerPiEdgeRefusals(
  refused: ReadonlyArray<{ reason: NonOwnerPiEdgeRefusal }>,
): Record<NonOwnerPiEdgeRefusal, number> {
  const counts: Record<NonOwnerPiEdgeRefusal, number> = {
    'lead-can-host': 0,
    'own-evidence-states-owning-appointment': 0,
    'edge-carries-provenance': 0,
    'edge-already-reviewed': 0,
  };
  for (const entry of refused) counts[entry.reason] += 1;
  return counts;
}

export interface TraineeRosterRow {
  id: string;
  title: string;
  holdsDirectoryIdentity: boolean;
  hasAnyRoleEdge: boolean;
}

/**
 * The trainee rows that can be archived: no Yale directory identity behind them and no role
 * edge anywhere, ever.
 *
 * Deliberately narrow. 230 of 398 trainee-titled researchers back a real account, so
 * archiving them would break those people's own access, and 95 appear on a served
 * page as ordinary lab members, which is information a student wants - a postdoc
 * belongs on a lab's member list, they just cannot be its lead (#2880).
 */
export function planTraineeRosterArchive(
  rows: readonly TraineeRosterRow[],
  isTraineeLevelTitle: (title?: string) => boolean,
): { archive: string[]; keptBecause: Record<string, number> } {
  const archive: string[] = [];
  const keptBecause: Record<string, number> = {
    'lead can host': 0,
    'holds a yale directory identity': 0,
    'holds a role edge': 0,
  };
  for (const row of rows) {
    if (!isTraineeLevelTitle(row.title)) keptBecause['lead can host'] += 1;
    else if (row.holdsDirectoryIdentity) keptBecause['holds a yale directory identity'] += 1;
    else if (row.hasAnyRoleEdge) keptBecause['holds a role edge'] += 1;
    else archive.push(row.id);
  }
  return { archive, keptBecause };
}
