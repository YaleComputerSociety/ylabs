import type { Document } from 'mongodb';

/**
 * The single allow-list of account fields that may cross an environment
 * boundary, shared by the Beta-to-Development mirror and the Beta-to-Production
 * promotion (#4244).
 *
 * An allow-list rather than a delete-list: account state and student PII live
 * under `profile` on the current model, so a top-level field blocklist silently
 * stops covering them the moment a field moves or a new one is added. Both
 * boundaries must read the same list, because a second copy would reinstate
 * exactly that failure on whichever side was not updated.
 */
export const MIRRORED_ACCOUNT_FIELDS = [
  '_id',
  'schemaVersion',
  'netid',
  'email',
  'status',
  'createdAt',
  'updatedAt',
] as const;

export const MIRRORED_ACCOUNT_PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'userType',
  'title',
  'department',
] as const;

function pickDefinedFields(source: Document, fields: readonly string[]): Document {
  const picked: Document = {};
  for (const field of fields) {
    if (source[field] !== undefined) picked[field] = source[field];
  }
  return picked;
}

export function mirroredAccountProfile(profile: unknown): Document | undefined {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return undefined;
  const picked = pickDefinedFields(profile as Document, MIRRORED_ACCOUNT_PROFILE_FIELDS);
  return Object.keys(picked).length > 0 ? picked : undefined;
}

export function reduceAccountToMirroredFields(document: Document): Document {
  const reduced: Document = pickDefinedFields(document, MIRRORED_ACCOUNT_FIELDS);
  reduced.archived = document.archived === true;
  const profile = mirroredAccountProfile(document.profile);
  if (profile) reduced.profile = profile;
  return reduced;
}
