import type { AnyBulkWriteOperation } from 'mongoose';
import type { FacultyEntry } from '../scrapers/sources/departmentRosterScraper';
import { profileEnrichmentFromHtml } from '../scrapers/sources/departmentRosterScraper';
import { isOfficialYaleProfileUrl } from '../scrapers/sources/officialProfileEnrichmentScraper';
import { buildObservationFingerprint } from '../scrapers/observationStore';
import { isMaterializableUserBioCandidate } from '../utils/profileBioQuality';

export interface TargetedProfessorBioRepairArgs {
  apply: boolean;
  netid: string;
  url: string;
}

export interface TargetedProfessorBioRepairUser {
  _id: unknown;
  netid: string;
  fname?: string | null;
  lname?: string | null;
  bio?: string | null;
  profileUrls?: Record<string, unknown> | null;
  confidenceByField?: Record<string, number> | null;
  dataSources?: string[] | null;
  manuallyLockedFields?: string[] | null;
}

export interface TargetedProfessorBioRepairSource {
  _id: unknown;
  name: string;
  defaultWeight: number;
}

export interface TargetedProfessorBioRepairObservation {
  entityType: 'user';
  entityId: unknown;
  entityKey: string;
  field: string;
  value: unknown;
  sourceId: unknown;
  sourceName: string;
  sourceUrl: string;
  confidence: number;
  observedAt: Date;
  superseded: false;
  observationFingerprint?: string;
}

export type TargetedProfessorBioRepairResult =
  | {
      ok: true;
      bio: string;
      sourceUrl: string;
      enrichment: Partial<FacultyEntry>;
      observations: TargetedProfessorBioRepairObservation[];
      userUpdate: {
        $set: Record<string, unknown>;
        $addToSet: Record<string, unknown>;
      };
    }
  | {
      ok: false;
      reason:
        | 'bio-field-locked'
        | 'not-official-yale-profile-url'
        | 'no-quality-bio'
        | 'profile-name-mismatch';
    };

export function parseTargetedProfessorBioRepairArgs(
  argv: string[],
): TargetedProfessorBioRepairArgs {
  const args: TargetedProfessorBioRepairArgs = { apply: false, netid: '', url: '' };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--netid') {
      args.netid = requiredNext(argv, index, '--netid').trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg.startsWith('--netid=')) {
      args.netid = arg.slice('--netid='.length).trim().toLowerCase();
      continue;
    }
    if (arg === '--url') {
      args.url = requiredNext(argv, index, '--url').trim();
      index += 1;
      continue;
    }
    if (arg.startsWith('--url=')) {
      args.url = arg.slice('--url='.length).trim();
      continue;
    }
    throw new Error(`Unknown targetedProfessorBioRepair option: ${arg}`);
  }

  if (!args.netid) throw new Error('--netid is required');
  if (!args.url) throw new Error('--url is required');
  return args;
}

function requiredNext(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function cleanText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizedNameTokens(value: unknown): string[] {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function profileNameMatchesUser(enrichment: Partial<FacultyEntry>, user: TargetedProfessorBioRepairUser): boolean {
  const profileName = cleanText(enrichment.name);
  if (!profileName) return true;
  const profileTokens = new Set(normalizedNameTokens(profileName));
  const first = normalizedNameTokens(user.fname)[0];
  const last = normalizedNameTokens(user.lname).at(-1);
  if (last && !profileTokens.has(last)) return false;
  if (first && !profileTokens.has(first)) {
    const profileCompact = Array.from(profileTokens).join('');
    return profileCompact.includes(first) || first.includes(profileCompact);
  }
  return true;
}

function profileUrlStorageKey(profileUrl: string, user: TargetedProfessorBioRepairUser): string {
  const existing = user.profileUrls || {};
  if (!Object.prototype.hasOwnProperty.call(existing, 'official')) return 'official';
  try {
    const hostname = new URL(profileUrl).hostname.toLowerCase().replace(/\.yale\.edu$/, '');
    const key = hostname.replace(/[^a-z0-9]+/g, '') || 'official';
    return key;
  } catch {
    return 'official';
  }
}

function observationFor({
  user,
  field,
  value,
  source,
  sourceUrl,
  now,
}: {
  user: TargetedProfessorBioRepairUser;
  field: string;
  value: unknown;
  source: TargetedProfessorBioRepairSource;
  sourceUrl: string;
  now: Date;
}): TargetedProfessorBioRepairObservation {
  const entityKey = `netid:${user.netid}`;
  return {
    entityType: 'user',
    entityId: user._id,
    entityKey,
    field,
    value,
    sourceId: source._id,
    sourceName: source.name,
    sourceUrl,
    confidence: source.defaultWeight,
    observedAt: now,
    superseded: false,
    observationFingerprint: buildObservationFingerprint({
      sourceName: source.name,
      entityType: 'user',
      entityId: user._id,
      entityKey,
      field,
      value,
    }),
  };
}

export function buildTargetedProfessorBioRepair({
  user,
  profileUrl,
  html,
  source,
  now = new Date(),
}: {
  user: TargetedProfessorBioRepairUser;
  profileUrl: string;
  html: string;
  source: TargetedProfessorBioRepairSource;
  now?: Date;
}): TargetedProfessorBioRepairResult {
  if ((user.manuallyLockedFields || []).includes('bio')) {
    return { ok: false, reason: 'bio-field-locked' };
  }
  if (!isOfficialYaleProfileUrl(profileUrl)) {
    return { ok: false, reason: 'not-official-yale-profile-url' };
  }

  const enrichment = profileEnrichmentFromHtml(html, profileUrl);
  if (!profileNameMatchesUser(enrichment, user)) {
    return { ok: false, reason: 'profile-name-mismatch' };
  }

  const bio = cleanText(enrichment.bio);
  if (!isMaterializableUserBioCandidate(bio)) {
    return { ok: false, reason: 'no-quality-bio' };
  }

  const sourceUrl = enrichment.profileSourceUrl || enrichment.profileUrl || profileUrl;
  const profileUrlValue = enrichment.profileUrl || profileUrl;
  const profileUrlKey = profileUrlStorageKey(profileUrlValue, user);
  const profileUrls = {
    ...(user.profileUrls || {}),
    [profileUrlKey]: profileUrlValue,
  };
  const observations = [
    observationFor({ user, field: 'bio', value: bio, source, sourceUrl, now }),
    observationFor({ user, field: 'profileUrls', value: profileUrls, source, sourceUrl, now }),
  ];

  const $set: Record<string, unknown> = {
    bio,
    'confidenceByField.bio': source.defaultWeight,
    [`profileUrls.${profileUrlKey}`]: profileUrlValue,
    lastObservedAt: now,
  };

  return {
    ok: true,
    bio,
    sourceUrl,
    enrichment,
    observations,
    userUpdate: {
      $set,
      $addToSet: {
        dataSources: source.name,
      },
    },
  };
}

export function dedupeObservationBulkOps(
  observations: TargetedProfessorBioRepairObservation[],
): AnyBulkWriteOperation[] {
  return observations.map((observation) => ({
    updateOne: {
      filter: {
        observationFingerprint: observation.observationFingerprint,
        superseded: false,
      },
      update: {
        $setOnInsert: observation,
      },
      upsert: true,
    },
  }));
}
