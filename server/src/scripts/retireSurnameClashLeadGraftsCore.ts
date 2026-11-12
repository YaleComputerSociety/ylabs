import {
  givenNamesAgree,
  givenNamesCouldBeOneTransliteration,
  surnameCoreKey,
} from '../scrapers/utils/piNameMatch';

/**
 * What the corpus records about one lead's person beyond the name, read only to tell
 * whether two clash members are one person stored as two Researcher records (#5941).
 */
export interface SurnameClashLeadIdentity {
  netid?: string;
  email?: string;
  orcid?: string;
  title?: string;
  department?: string;
  /** The live record an archived duplicate was folded into, read from `dedupedIntoResearcherId`. */
  dedupedIntoPersonId?: string;
}

export interface SurnameClashLeadRow {
  assignmentId: string;
  personId: string;
  displayName: string;
  reviewStatus?: string;
  /**
   * Whether the corpus knows this person as a Yale identity rather than as a bare
   * name, as `researcherCarriesIdentityEvidence` reads it (#5592). A title or a
   * department alone is not identity: a name-only duplicate carries both (#5941).
   */
  identityAnchored: boolean;
  identity?: SurnameClashLeadIdentity;
  /**
   * Whether this assignment cites the entity's own official roster page as verified
   * evidence, which is the corroboration a surname graft does not have. It is a
   * property of the assignment rather than of the person, so a second lead row for
   * the same person is judged on its own evidence.
   */
  rosterVerified: boolean;
  /**
   * What the entity's own served website said about this lead: it confirmed them, or it
   * names a same-surname person whose given name cannot be theirs.
   */
  servedSiteVerdict?: 'CONFIRMED' | 'NAMESAKE';
}

export interface SurnameClashEntityRow {
  entityId: string;
  identityTokens: readonly string[];
  leads: readonly SurnameClashLeadRow[];
}

export type SurnameClashRefusal =
  | 'no-surname-clash'
  | 'one-person-recorded-twice'
  | 'identity-names-nobody-in-the-clash'
  | 'identity-names-more-than-one-of-the-clash'
  | 'named-lead-is-an-unanchored-shell'
  | 'candidate-corroborated-by-the-entity-roster'
  | 'assignment-already-reviewed';

export interface SurnameClashDetachment {
  assignmentId: string;
  entityId: string;
  personId: string;
}

export interface SurnameClashPlan {
  detach: SurnameClashDetachment[];
  refused: Array<{ entityId: string; reason: SurnameClashRefusal; assignments: number }>;
}

const personNameTokens = (displayName: unknown): string[] =>
  String(displayName ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2018\u2019\u02bc]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/i)
    .filter(Boolean);

export const leadSurnameKey = (displayName: unknown): string =>
  surnameCoreKey(personNameTokens(displayName).at(-1) || '');

/**
 * The single definition of what a same-surname clash is: the groups of lead rows
 * that share a surname key and cover more than one person. Callers that only need
 * to know whether an entity clashes read the length rather than re-deriving the
 * grouping, so a scoping pre-filter and the plan can never disagree.
 */
export function surnameClashGroups(leads: readonly SurnameClashLeadRow[]): SurnameClashLeadRow[][] {
  const bySurname = new Map<string, SurnameClashLeadRow[]>();
  for (const lead of leads) {
    const key = leadSurnameKey(lead.displayName);
    if (!key) continue;
    bySurname.set(key, [...(bySurname.get(key) || []), lead]);
  }
  return [...bySurname.values()].filter(
    (group) => new Set(group.map((lead) => lead.personId)).size > 1,
  );
}

const givenNamesNameOnePerson = (given: string, token: string): boolean =>
  givenNamesAgree(given, token) || givenNamesCouldBeOneTransliteration(given, token);

const comparableText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, ' ')
    .trim();

const hardIdentityKeys = (lead: SurnameClashLeadRow): string[] =>
  (['netid', 'email', 'orcid'] as const)
    .map((field) => [field, comparableText(lead.identity?.[field])] as const)
    .filter(([, value]) => value)
    .map(([field, value]) => `${field}:${value}`);

const isNameOnlyRecord = (lead: SurnameClashLeadRow): boolean =>
  !lead.identityAnchored && hardIdentityKeys(lead).length === 0;

const textsAgree = (left: unknown, right: unknown): boolean => {
  const a = comparableText(left);
  return Boolean(a) && a === comparableText(right);
};

/**
 * The tight name match that lets a name-only record stand for a record carrying
 * identity evidence: the first given names agree or are two romanisations of one name,
 * the surnames are identical, and the title or the department agrees.
 */
function nameOnlyRecordTightlyMatches(
  nameOnly: SurnameClashLeadRow,
  anchored: SurnameClashLeadRow,
): boolean {
  const left = personNameTokens(nameOnly.displayName);
  const right = personNameTokens(anchored.displayName);
  if (left.length < 2 || right.length < 2 || left.at(-1) !== right.at(-1)) return false;
  if (!givenNamesNameOnePerson(left[0], right[0])) return false;
  return (
    textsAgree(nameOnly.identity?.title, anchored.identity?.title) ||
    textsAgree(nameOnly.identity?.department, anchored.identity?.department)
  );
}

/**
 * Maps every lead of a clash group to the person it is, so one person stored as two
 * Researcher records reads as one person rather than as a clash with themselves (#5941).
 *
 * Records are one person when they share a netid, an email, or an ORCID, when a
 * `dedupedIntoResearcherId` link joins them, or when a name-only record tightly matches
 * exactly one person carrying identity evidence. Two netids never join: a pair that
 * would bring two different netids into one person stays two people, so two
 * same-surname colleagues are never folded together through a shared field.
 */
export function onePersonKeyByAssignment(
  group: readonly SurnameClashLeadRow[],
): Map<string, string> {
  const parent = new Map<string, string>();
  const netidsByRoot = new Map<string, Set<string>>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(key, root);
    return root;
  };
  const add = (key: string, netid?: string) => {
    if (!parent.has(key)) {
      parent.set(key, key);
      netidsByRoot.set(key, new Set());
    }
    if (netid) netidsByRoot.get(find(key))?.add(netid);
  };
  const union = (left: string, right: string): void => {
    const a = find(left);
    const b = find(right);
    if (a === b) return;
    const netids = new Set([...(netidsByRoot.get(a) || []), ...(netidsByRoot.get(b) || [])]);
    if (netids.size > 1) return;
    parent.set(b, a);
    netidsByRoot.set(a, netids);
  };

  const personKey = (lead: SurnameClashLeadRow) => `person:${lead.personId}`;
  for (const lead of group) {
    add(personKey(lead), comparableText(lead.identity?.netid) || undefined);
  }
  for (const lead of group) {
    const dedupedInto = String(lead.identity?.dedupedIntoPersonId || '').trim();
    const linkKeys = [
      ...hardIdentityKeys(lead).filter((key) => !key.startsWith('netid:')),
      ...(dedupedInto ? [`person:${dedupedInto}`] : []),
    ];
    const netid = comparableText(lead.identity?.netid);
    if (netid) linkKeys.push(`netid:${netid}`);
    for (const key of linkKeys) {
      add(key, key.startsWith('netid:') ? netid : undefined);
      union(personKey(lead), key);
    }
  }

  for (const nameOnly of group.filter(isNameOnlyRecord)) {
    const matchedPeople = new Set(
      group
        .filter((lead) => lead.identityAnchored && nameOnlyRecordTightlyMatches(nameOnly, lead))
        .map((lead) => find(personKey(lead))),
    );
    if (matchedPeople.size === 1) union([...matchedPeople][0], personKey(nameOnly));
  }

  return new Map(group.map((lead) => [lead.assignmentId, find(personKey(lead))]));
}

/**
 * Whether the entity's own identity - its name and slug tokens - names this person.
 *
 * Surname equality alone is deliberately not enough: it is exactly the similarity
 * that produced the graft, and a `<Surname> Lab` entity names no one person. A
 * given-name token must agree too, and any of the person's non-surname tokens may
 * supply it, so a middle-name form ("Jung Yun Julie Kang" against a `julie-kang`
 * slug) reads as the same person the entity is about rather than as a stranger. Two
 * romanisations of one given name agree too (#5853): one person stored under both
 * spellings was otherwise read as a graft of themselves and detached.
 */
export function entityIdentityNamesPerson(
  identityTokens: readonly string[],
  displayName: unknown,
): boolean {
  const nameTokens = personNameTokens(displayName);
  if (nameTokens.length < 2) return false;
  const identity = identityTokens.map((token) => String(token).toLowerCase()).filter(Boolean);
  const surname = surnameCoreKey(nameTokens.at(-1) || '');
  if (!surname || !identity.some((token) => surnameCoreKey(token) === surname)) return false;
  return nameTokens
    .slice(0, -1)
    .some((given) => identity.some((token) => givenNamesNameOnePerson(given, token)));
}

/**
 * The one person of a clash the entity's own website names, when the identity names
 * nobody: a `<Surname> Lab` carries only the surname both people share (#2768).
 *
 * The site decides only when it is unanimous: it confirmed exactly one person of the
 * clash and read every other one as a namesake. Anything less, a second confirmation or
 * a lead the site said nothing about, leaves the clash undecided.
 */
function siteNamedPersonIds(
  group: readonly SurnameClashLeadRow[],
  personOf: (lead: SurnameClashLeadRow) => string,
): Set<string> {
  const confirmed = new Set(
    group.filter((lead) => lead.servedSiteVerdict === 'CONFIRMED').map(personOf),
  );
  if (confirmed.size !== 1) return new Set();
  const othersAreNamesakes = group.every(
    (lead) => confirmed.has(personOf(lead)) || lead.servedSiteVerdict === 'NAMESAKE',
  );
  return othersAreNamesakes ? confirmed : new Set();
}

/**
 * Plans which lead assignments to detach from entities whose served lead list holds
 * two or more distinct people sharing a surname (#2768).
 *
 * The arbiter is the entity's own identity, never similarity between the two names
 * and never a stored score. When the identity names nobody, the entity's own website
 * may arbitrate instead, but only unanimously (`siteNamedPersonIds`). Ranking by `confidence` picks the stranger: it is
 * anti-correlated on both rows with ground truth (0.9 wrong against 0.78 right).
 * Mere `rosterProvenance` presence is not a signal either, because 974 of 3,009
 * served sole PIs lack it and are correct.
 *
 * Fails closed seven ways. A clash whose members are all one person stored as two or
 * more records (`onePersonKeyByAssignment`) is refused as needing a merge, because
 * detaching there removes the person the entity is named after (#5941). An entity whose identity names nobody in the clash, or
 * more than one of them, is left alone: naming two is the name-variant case, which
 * is a merge rather than a detach. A bare-name survivor never evicts a
 * netid-backed record, because an unanchored shell beside an anchored record of the
 * same surname is the shape of one person recorded twice rather than of a graft, and
 * detaching there would strip the row's only identity-backed lead. A candidate the
 * entity's own official roster page listed is kept, because a genuine same-surname
 * co-lead is otherwise indistinguishable from a graft and that observation is the
 * corroboration a graft does not have. An assignment a human already reviewed is
 * left alone.
 *
 * Only a lead the identity does not name is ever detached, so the entity keeps the
 * lead it is named after and can never be left with no lead at all. There is
 * deliberately no separate last-lead guard: it could not fire, and a guard that
 * cannot fire reads as protection that is not there.
 */
export function planSurnameClashLeadDetachment(
  entities: readonly SurnameClashEntityRow[],
): SurnameClashPlan {
  const detach: SurnameClashDetachment[] = [];
  const refused: SurnameClashPlan['refused'] = [];

  for (const entity of entities) {
    const groups = surnameClashGroups(entity.leads);
    if (groups.length === 0) {
      refused.push({ entityId: entity.entityId, reason: 'no-surname-clash', assignments: 0 });
      continue;
    }

    for (const group of groups) {
      const personKeys = onePersonKeyByAssignment(group);
      const personOf = (lead: SurnameClashLeadRow) =>
        personKeys.get(lead.assignmentId) || `person:${lead.personId}`;
      if (new Set(group.map(personOf)).size === 1) {
        refused.push({
          entityId: entity.entityId,
          reason: 'one-person-recorded-twice',
          assignments: group.length,
        });
        continue;
      }
      const identityNamedPersonIds = new Set(
        group
          .filter((lead) => entityIdentityNamesPerson(entity.identityTokens, lead.displayName))
          .map(personOf),
      );
      const namedPersonIds =
        identityNamedPersonIds.size > 0
          ? identityNamedPersonIds
          : siteNamedPersonIds(group, personOf);
      if (namedPersonIds.size === 0) {
        refused.push({
          entityId: entity.entityId,
          reason: 'identity-names-nobody-in-the-clash',
          assignments: group.length,
        });
        continue;
      }
      if (namedPersonIds.size > 1) {
        refused.push({
          entityId: entity.entityId,
          reason: 'identity-names-more-than-one-of-the-clash',
          assignments: group.length,
        });
        continue;
      }

      const unnamed = group.filter((lead) => !namedPersonIds.has(personOf(lead)));
      const corroborated = unnamed.filter((lead) => lead.rosterVerified);
      if (corroborated.length > 0) {
        refused.push({
          entityId: entity.entityId,
          reason: 'candidate-corroborated-by-the-entity-roster',
          assignments: corroborated.length,
        });
      }
      const candidates = unnamed.filter((lead) => !lead.rosterVerified);
      if (candidates.length === 0) continue;

      const namedIsAnchored = group.some(
        (lead) => namedPersonIds.has(personOf(lead)) && lead.identityAnchored,
      );
      if (!namedIsAnchored && candidates.some((lead) => lead.identityAnchored)) {
        refused.push({
          entityId: entity.entityId,
          reason: 'named-lead-is-an-unanchored-shell',
          assignments: candidates.length,
        });
        continue;
      }
      const reviewed = candidates.filter(
        (lead) => (lead.reviewStatus || 'UNREVIEWED') !== 'UNREVIEWED',
      );
      if (reviewed.length > 0) {
        refused.push({
          entityId: entity.entityId,
          reason: 'assignment-already-reviewed',
          assignments: reviewed.length,
        });
      }
      for (const lead of candidates) {
        if ((lead.reviewStatus || 'UNREVIEWED') !== 'UNREVIEWED') continue;
        detach.push({
          assignmentId: lead.assignmentId,
          entityId: entity.entityId,
          personId: lead.personId,
        });
      }
    }
  }

  return { detach, refused };
}

export function summarizeSurnameClashRefusals(
  refused: SurnameClashPlan['refused'],
): Record<SurnameClashRefusal, number> {
  const counts: Record<SurnameClashRefusal, number> = {
    'no-surname-clash': 0,
    'one-person-recorded-twice': 0,
    'identity-names-nobody-in-the-clash': 0,
    'identity-names-more-than-one-of-the-clash': 0,
    'named-lead-is-an-unanchored-shell': 0,
    'candidate-corroborated-by-the-entity-roster': 0,
    'assignment-already-reviewed': 0,
  };
  for (const entry of refused) counts[entry.reason] += 1;
  return counts;
}

export interface PastSurnameClashDetachment {
  assignmentId: string;
  entityId: string;
  personId: string;
  displayName: string;
  identityTokens: readonly string[];
  /**
   * Whether an archived duplicate that led the same entity now resolves, through
   * `dedupedIntoResearcherId`, to the detached person: the duplicate was the lead the
   * repair kept, so the detached person was the lead the entity is named after (#5941).
   */
  entityLeadDuplicateResolvesToPerson?: boolean;
}

/**
 * The detachments this repair already made of the person the entity is named after:
 * the entity's identity now names the detached person (#5853), or an archived
 * duplicate that led the entity now resolves to them (#5941). It only lists them:
 * restoring an edge is a review verdict on that row, not a bulk write.
 */
export function pastDetachmentsOfTheNamedPerson(
  detachments: readonly PastSurnameClashDetachment[],
): PastSurnameClashDetachment[] {
  return detachments.filter(
    (detachment) =>
      detachment.entityLeadDuplicateResolvesToPerson === true ||
      entityIdentityNamesPerson(detachment.identityTokens, detachment.displayName),
  );
}
