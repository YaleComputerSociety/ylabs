import { givenNameTokensAgree } from './verifyOfficialProfileLinksCore';
import { givenNamesEquivalent, surnameCoreKey } from '../scrapers/utils/piNameMatch';

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
    .replace(/['’ʼ]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/i)
    .filter(Boolean);

export const leadSurnameKey = (displayName: unknown): string =>
  surnameCoreKey(personNameTokens(displayName).at(-1) || '');

/**
 * Both nickname maps are consulted and either one is enough, because in this lane
 * every agreement is conservative: agreement is what keeps a name variant attached
 * and what makes an entity read as naming two of the clashing people, which refuses
 * the detach. A missing short form can only cost a removal, never cause one.
 */
const givenNamesAgree = (a: string, b: string): boolean =>
  givenNameTokensAgree(a, b) || givenNamesEquivalent(a, b);

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
 * `rosterProvenance` presence is not a signal either, because 974 of 3,009 served
 * sole PIs lack it and are correct.
 *
 * Fails closed five ways. An entity whose identity names nobody in the clash, or
 * more than one of them, is left alone: naming two is the name-variant case, which
 * is a merge rather than a detach. A bare-name survivor never evicts a
 * netid-backed record, because an unanchored shell beside an anchored record of the
 * same surname is the shape of one person recorded twice rather than of a graft, and
 * detaching there would strip the row's only identity-backed lead. An assignment a
 * human already reviewed is left alone.
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
    const bySurname = new Map<string, SurnameClashLeadRow[]>();
    for (const lead of entity.leads) {
      const key = leadSurnameKey(lead.displayName);
      if (!key) continue;
      bySurname.set(key, [...(bySurname.get(key) || []), lead]);
    }

    const entityDetach: SurnameClashDetachment[] = [];
    const entityRefusals: SurnameClashPlan['refused'] = [];
    let clashFound = false;

    for (const group of bySurname.values()) {
      const distinctPersonIds = new Set(group.map((lead) => lead.personId));
      if (distinctPersonIds.size < 2) continue;
      clashFound = true;

      const namedPersonIds = new Set(
        group
          .filter((lead) => entityIdentityNamesPerson(entity.identityTokens, lead.displayName))
          .map((lead) => lead.personId),
      );
      if (namedPersonIds.size === 0) {
        entityRefusals.push({
          entityId: entity.entityId,
          reason: 'identity-names-nobody-in-the-clash',
          assignments: group.length,
        });
        continue;
      }
      if (namedPersonIds.size > 1) {
        entityRefusals.push({
          entityId: entity.entityId,
          reason: 'identity-names-more-than-one-of-the-clash',
          assignments: group.length,
        });
        continue;
      }

      const candidates = group.filter((lead) => !namedPersonIds.has(lead.personId));
      const namedIsAnchored = group.some(
        (lead) => namedPersonIds.has(lead.personId) && lead.identityAnchored,
      );
      if (!namedIsAnchored && candidates.some((lead) => lead.identityAnchored)) {
        entityRefusals.push({
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
        entityRefusals.push({
          entityId: entity.entityId,
          reason: 'assignment-already-reviewed',
          assignments: reviewed.length,
        });
      }
      for (const lead of candidates) {
        if ((lead.reviewStatus || 'UNREVIEWED') !== 'UNREVIEWED') continue;
        entityDetach.push({
          assignmentId: lead.assignmentId,
          entityId: entity.entityId,
          personId: lead.personId,
        });
      }
    }

    if (!clashFound) {
      refused.push({ entityId: entity.entityId, reason: 'no-surname-clash', assignments: 0 });
      continue;
    }

    detach.push(...entityDetach);
    refused.push(...entityRefusals);
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
    'assignment-already-reviewed': 0,
  };
  for (const entry of refused) counts[entry.reason] += 1;
  return counts;
}
