import {
  assessResearchEntityDescriptionQuality,
  type ResearchEntityDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import {
  sanitizeFacultyResearchEntityCopyFields,
  sanitizeResearchEntityPublicDescriptionFields,
  sanitizeResearchHomeSelfReferenceCopyFields,
} from '../utils/researchEntityDescriptionText';
import { researchEntityHasDeceasedLead } from '../utils/researchEntityDeceasedLead';

export interface ResearchEntityPublicDescriptionRepresentation {
  entity: Record<string, any>;
  leadMemberNames: string[];
  quality: ResearchEntityDescriptionQuality;
  fullDescription: string;
  cardDescription: string;
  invariant: {
    pass: boolean;
    fullDescriptionUseful: boolean;
    cardDescriptionUseful: boolean;
    reasons: Array<'missing_public_full_description' | 'missing_public_card_description'>;
  };
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function memberDisplayName(member: Record<string, any>): string {
  const candidates = [
    member.user?.displayName,
    member.user?.name,
    [member.user?.fname, member.user?.lname].filter(Boolean).join(' '),
    member.facultyMember?.displayName,
    member.facultyMember?.name,
    [member.facultyMember?.firstName, member.facultyMember?.lastName].filter(Boolean).join(' '),
    member.displayName,
    member.name,
  ];
  return candidates.map(textValue).find(Boolean) || '';
}

export function publicDescriptionLeadMemberNames(
  leadMembers: Array<Record<string, any>> = [],
): string[] {
  return Array.from(new Set(leadMembers.map(memberDisplayName).filter(Boolean)));
}

export function buildResearchEntityPublicDescriptionRepresentation({
  entity,
  leadMembers = [],
  leadMemberNames,
}: {
  entity: Record<string, any>;
  leadMembers?: Array<Record<string, any>>;
  leadMemberNames?: readonly string[];
}): ResearchEntityPublicDescriptionRepresentation {
  const resolvedLeadMemberNames = Array.from(
    new Set(
      (leadMemberNames || publicDescriptionLeadMemberNames(leadMembers))
        .map(textValue)
        .filter(Boolean),
    ),
  );
  const sanitizedEntity = sanitizeResearchHomeSelfReferenceCopyFields(
    sanitizeFacultyResearchEntityCopyFields(
      sanitizeResearchEntityPublicDescriptionFields(entity, resolvedLeadMemberNames),
      resolvedLeadMemberNames,
    ),
  );
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription: sanitizedEntity.fullDescription,
    shortDescription: sanitizedEntity.shortDescription,
    sourceUrls: sanitizedEntity.sourceUrls,
    website: sanitizedEntity.website,
    websiteUrl: sanitizedEntity.websiteUrl,
  });
  const reasons: ResearchEntityPublicDescriptionRepresentation['invariant']['reasons'] = [];
  if (!quality.full.isUseful) reasons.push('missing_public_full_description');
  if (!quality.short.isUseful) reasons.push('missing_public_card_description');

  return {
    entity: sanitizedEntity,
    leadMemberNames: resolvedLeadMemberNames,
    quality,
    fullDescription: quality.full.text,
    cardDescription: quality.short.text,
    invariant: {
      pass: reasons.length === 0,
      fullDescriptionUseful: quality.full.isUseful,
      cardDescriptionUseful: quality.short.isUseful,
      reasons,
    },
  };
}

// The stored `studentVisibilityTier` is a materialized snapshot, but every
// public serve path recomputes the servable gate live: the detail resolver
// returns null (-> 404) when it fails, and the browse hydration path drops the
// card. A stored `student_ready` tier can go stale relative to that live gate
// (e.g. after a hygiene change that empties a person-bio description, or a lead
// later confirmed deceased), so any surface that lists entities by stored tier
// alone must run this predicate to stay consistent with the detail gate. Running
// it without the roster-derived lead names the detail path uses is safe: lead-name
// self-reference stripping only ever removes more text, so an entity that fails
// this name-agnostic invariant necessarily also fails the detail path's stricter
// invariant, and dropping it can never hide a card the detail page would serve.
// The deceased-lead check (#982) is likewise name-agnostic (entity name and
// description signals only) and mirrors the detail resolver's own guard.
export const researchEntityServesPublicDetail = (entity: Record<string, any>): boolean =>
  buildResearchEntityPublicDescriptionRepresentation({ entity }).invariant.pass &&
  !researchEntityHasDeceasedLead(entity);
