import type { UndergradInvitation, UndergradInvitationLevel } from '../types/researchGroup';
import { HOSTED_UNDERGRADUATES_LABEL, MENTORS_UNDERGRADUATES_LABEL } from './researchEntityCopy';
import { UNDERGRAD_INVITATION_LABELS, WELCOMES_UNDERGRADS_LABEL } from './undergradInvitation';

export interface UndergraduateAccessFields {
  undergradInvitation?: Pick<UndergradInvitation, 'level'> | null;
  undergradInvitationLevel?: UndergradInvitationLevel | null;
  welcomesUndergrads?: boolean | null;
  hasUndergradHostingEvidence?: boolean | null;
  mentorsUndergrads?: boolean | null;
  wayInWithheld?: boolean | null;
}

export type UndergraduateAccessTone = 'invitation' | 'evidence';

export interface UndergraduateAccessStatus {
  tone: UndergraduateAccessTone;
  label: string;
}

const invitationLabel = (fields: UndergraduateAccessFields): string | null => {
  if (fields.wayInWithheld) return null;
  const level = fields.undergradInvitationLevel ?? fields.undergradInvitation?.level;
  if (level && UNDERGRAD_INVITATION_LABELS[level]) return UNDERGRAD_INVITATION_LABELS[level];
  return fields.welcomesUndergrads ? WELCOMES_UNDERGRADS_LABEL : null;
};

// The browse card's badges in the browse card's order, so a saved card or a Compare
// column never shows a weaker signal than the card the student saved it from (#6088).
export const deriveUndergraduateAccessStatuses = (
  fields: UndergraduateAccessFields,
): UndergraduateAccessStatus[] => {
  const statuses: UndergraduateAccessStatus[] = [];
  const invitation = invitationLabel(fields);
  if (invitation) statuses.push({ tone: 'invitation', label: invitation });
  if (fields.hasUndergradHostingEvidence) {
    statuses.push({ tone: 'evidence', label: HOSTED_UNDERGRADUATES_LABEL });
  }
  if (fields.mentorsUndergrads && !fields.wayInWithheld) {
    statuses.push({ tone: 'evidence', label: MENTORS_UNDERGRADUATES_LABEL });
  }
  return statuses;
};

const TONE_SORT_RANK: Record<UndergraduateAccessTone, number> = { invitation: 0, evidence: 1 };

export const undergraduateAccessSortRank = (
  statuses: readonly UndergraduateAccessStatus[],
): number =>
  statuses.length > 0 ? TONE_SORT_RANK[statuses[0].tone] : Object.keys(TONE_SORT_RANK).length;
