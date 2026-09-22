import { givenNamesAgree, surnameCoreKey } from '../scrapers/utils/piNameMatch';

export interface SurnameClashLeadRow {
  assignmentId: string;
  personId: string;
  displayName: string;
  reviewStatus?: string;
  /**
   * Whether the corpus knows this person as a Yale identity rather than as a bare
   * name: a netid, an account, a title, or a department.
   */
  identityAnchored: boolean;
  /**
   * Whether this assignment cites the entity's own official roster page as verified
   * evidence, which is the corroboration a surname graft does not have. It is a
   * property of the assignment rather than of the person, so a second lead row for
   * the same person is judged on its own evidence.
   */
  rosterVerified: boolean;
}

export interface SurnameClashEntityRow {
  entityId: string;
  identityTokens: readonly string[];
  leads: readonly SurnameClashLeadRow[];
}

export type SurnameClashRefusal =
  | 'no-surname-clash'
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

/**
 * Whether the entity's own identity - its name and slug tokens - names this person.
 *
 * Surname equality alone is deliberately not enough: it is exactly the similarity
 * that produced the graft, and a `<Surname> Lab` entity names no one person. A
 * given-name token must agree too, and any of the person's non-surname tokens may
 * supply it, so a middle-name form ("Jung Yun Julie Kang" against a `julie-kang`
 * slug) reads as the same person the entity is about rather than as a stranger.
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
    .some((given) => identity.some((token) => givenNamesAgree(given, token)));
}

/**
 * Plans which lead assignments to detach from entities whose served lead list holds
 * two or more distinct people sharing a surname (#2768).
 *
 * The arbiter is the entity's own identity, never similarity between the two names
 * and never a stored score. Ranking by `confidence` picks the stranger: it is
 * anti-correlated on both rows with ground truth (0.9 wrong against 0.78 right).
 * Mere `rosterProvenance` presence is not a signal either, because 974 of 3,009
 * served sole PIs lack it and are correct.
 *
 * Fails closed six ways. An entity whose identity names nobody in the clash, or
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
      const namedPersonIds = new Set(
        group
          .filter((lead) => entityIdentityNamesPerson(entity.identityTokens, lead.displayName))
          .map((lead) => lead.personId),
      );
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

      const unnamed = group.filter((lead) => !namedPersonIds.has(lead.personId));
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
        (lead) => namedPersonIds.has(lead.personId) && lead.identityAnchored,
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
    'identity-names-nobody-in-the-clash': 0,
    'identity-names-more-than-one-of-the-clash': 0,
    'named-lead-is-an-unanchored-shell': 0,
    'candidate-corroborated-by-the-entity-roster': 0,
    'assignment-already-reviewed': 0,
  };
  for (const entry of refused) counts[entry.reason] += 1;
  return counts;
}
