import type { UndergradInvitation, UndergradInvitationLevel } from '../types/researchGroup';
import { safeHttpUrl } from './url';

export const ACTIVELY_HIRING_LABEL = 'Actively hiring';
export const WELCOMES_UNDERGRADS_LABEL = 'Welcomes undergrads';

export const UNDERGRAD_INVITATION_LABELS: Record<UndergradInvitationLevel, string> = {
  actively_hiring: ACTIVELY_HIRING_LABEL,
  welcomes_undergrads: WELCOMES_UNDERGRADS_LABEL,
};

export interface UndergradInvitationEvidence {
  level: UndergradInvitationLevel;
  label: string;
  quote: string;
  sourceUrl: string;
  sourceHost: string;
}

export const undergradInvitationFromEntity = (
  entity: { undergradInvitation?: UndergradInvitation } | undefined,
): UndergradInvitationEvidence | undefined => {
  const invitation = entity?.undergradInvitation;
  const label = invitation ? UNDERGRAD_INVITATION_LABELS[invitation.level] : undefined;
  const quote = (invitation?.quote || '').replace(/\s+/g, ' ').trim();
  const sourceUrl = safeHttpUrl(invitation?.sourceUrl);
  if (!invitation || !label || !quote || !sourceUrl) return undefined;
  return {
    level: invitation.level,
    label,
    quote,
    sourceUrl,
    sourceHost: new URL(sourceUrl).hostname.replace(/^www\./, ''),
  };
};
