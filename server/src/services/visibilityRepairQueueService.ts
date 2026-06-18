import { Fellowship } from '../models/fellowship';
import { Observation } from '../models/observation';
import { Source } from '../models/source';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { EntryPathway } from '../models/entryPathway';
import { User } from '../models/user';
import mongoose from 'mongoose';
import {
  VisibilityReleaseQueueItem,
  type VisibilityReleaseQueueCollection,
  type VisibilityRepairStage,
  type VisibilityRepairStatus,
} from '../models/visibilityReleaseQueueItem';
import {
  assessResearchEntityDescriptionQuality,
  deriveShortDescriptionFromFullDescription,
} from '../utils/researchEntityDescriptionQuality';
import { buildResearchEntityQualitySummary } from './researchEntityQuality';
import { upsertAccessSignal, type UpsertAccessSignalInput } from './accessSignalService';
import { upsertContactRoute, type UpsertContactRouteInput } from './contactRouteService';
import { upsertEntryPathway, type UpsertEntryPathwayInput } from './entryPathwayService';
import { runStudentVisibilityGate } from './studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';

export type VisibilityRepairMode = 'dry-run' | 'apply';

export interface VisibilityRepairQueueOptions {
  mode: VisibilityRepairMode;
  collection?: VisibilityReleaseQueueCollection | 'all';
  limit?: number;
  stage?: VisibilityRepairStage;
  suppressUnsafe?: boolean;
  retryBlocked?: boolean;
  recordIds?: string[];
  queueItemIds?: string[];
}

export interface VisibilityRepairQueueItemInput {
  _id?: unknown;
  collection: VisibilityReleaseQueueCollection;
  recordId: string;
  label?: string;
  blockerReasons?: string[];
  evidenceSignals?: string[];
  sourceNames?: string[];
  nextRepairAction?: string;
  attemptCount?: number;
  repairStage?: VisibilityRepairStage;
  repairStatus?: VisibilityRepairStatus;
}

export interface VisibilityRepairPlan {
  queueItemId: string;
  collection: VisibilityReleaseQueueCollection;
  recordId: string;
  label: string;
  repairStage: VisibilityRepairStage;
  repairStatus: VisibilityRepairStatus;
  priority: number;
  blockerReasons: string[];
  nextRepairAction: string;
  safeToAttempt: boolean;
}

export interface VisibilityRepairAttempt {
  plan: VisibilityRepairPlan;
  applied: boolean;
  status: VisibilityRepairStatus;
  patchSummary: string[];
  remainingBlockers: string[];
  repairSource: string;
}

export interface VisibilityRepairQueueReport {
  mode: VisibilityRepairMode;
  scanned: number;
  attempted: number;
  repaired: number;
  blocked: number;
  resolvedByGate: number;
  plans: VisibilityRepairPlan[];
  attempts: VisibilityRepairAttempt[];
}

const VISIBILITY_REPAIR_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function normalizeVisibilityRepairObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return VISIBILITY_REPAIR_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

function toVisibilityRepairObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
  const id = normalizeVisibilityRepairObjectId(value);
  return id ? new mongoose.Types.ObjectId(id) : undefined;
}

interface RepairDeps {
  findOpenQueueItems: (options: VisibilityRepairQueueOptions) => Promise<VisibilityRepairQueueItemInput[]>;
  updateQueueItem: (id: string, patch: Record<string, unknown>) => Promise<void>;
  findResearchEntity: (id: string) => Promise<Record<string, any> | null>;
  findResearchEntityMembers?: (id: string) => Promise<Array<Record<string, any>>>;
  findUserByProfileUrl?: (urls: string[]) => Promise<Record<string, any> | null>;
  findUserByExactWebsiteUrl?: (urls: string[]) => Promise<Record<string, any> | null>;
  upsertResearchEntityMember?: (
    researchEntityId: string,
    userId: string,
    metadata: { sourceUrl: string; sourceName: string; confidence: number },
  ) => Promise<void>;
  upsertEntryPathway?: (input: UpsertEntryPathwayInput) => Promise<{ pathwayId?: string; doc?: any }>;
  findReusableExploratoryContactPathway?: (
    researchEntityId: string,
  ) => Promise<{ pathwayId?: string; derivationKey?: string; doc?: any } | null>;
  upsertAccessSignal?: (input: UpsertAccessSignalInput) => Promise<{ signalId?: string; doc?: any }>;
  upsertContactRoute?: (input: UpsertContactRouteInput) => Promise<{ contactRouteId?: string; doc?: any }>;
  findActionEvidenceObservationIds?: (input: {
    researchEntityId: string;
    userId: string;
    sourceUrl: string;
  }) => Promise<string[]>;
  findEntityActionEvidenceObservationIds?: (input: {
    researchEntityId: string;
    sourceUrl: string;
    sourceUrls?: string[];
  }) => Promise<Array<{ id: string; excerpt?: string; sourceUrl?: string; sourceName?: string }>>;
  updateResearchEntity: (id: string, patch: Record<string, unknown>) => Promise<void>;
  findProgram: (id: string) => Promise<Record<string, any> | null>;
  updateProgram: (id: string, patch: Record<string, unknown>) => Promise<void>;
  runGate: (
    collection: VisibilityReleaseQueueCollection,
    recordIds: string[],
    mode: VisibilityRepairMode,
  ) => Promise<{ counts?: { resolved?: number; promoted?: number } }>;
}

export function buildVisibilityRepairPiMemberUpsert(
  researchEntityId: string,
  userId: string,
  metadata: { sourceUrl: string; sourceName: string; confidence: number },
  now = new Date(),
) {
  return {
    filter: {
      researchEntityId,
      userId,
      role: 'pi',
      isCurrentMember: true,
    },
    update: {
      $set: {
        researchEntityId,
        researchGroupId: researchEntityId,
        userId,
        role: 'pi',
        isCurrentMember: true,
        archived: false,
        sourceUrl: metadata.sourceUrl,
        confidence: metadata.confidence,
        lastObservedAt: now,
        'confidenceByField.role': metadata.confidence,
        'fieldProvenance.role': {
          sourceName: metadata.sourceName,
          sourceUrl: metadata.sourceUrl,
          observedAt: now,
          confidence: metadata.confidence,
        },
      },
      $setOnInsert: {
        startedAt: now,
      },
    },
    options: { upsert: true },
  };
}

const sourceDescriptionReasons = new Set([
  'missing_description',
  'missing_card_description',
  'thin_description',
  'profile_fallback_only',
  'missing_source_url',
  'missing_official_source',
  'application_source_only',
]);

const piReasons = new Set([
  'missing_lead',
  'duplicate_name_risk',
  'duplicate_risk',
  'pi_identity_conflict',
  'profile_identity_risk',
]);

const actionReasons = new Set([
  'missing_action_evidence',
  'missing_application_route',
  'missing_source_route',
]);

const suppressionReasons = new Set([
  'archive_review',
  'content_page_risk',
  'exact_url_duplicate_risk',
  'generic_directory_shell',
  'inactive_at_yale',
  'not_undergraduate_relevant',
  'research_infrastructure_only',
]);
const reviewExceptionReasons = new Set(['formalization_only']);

const stagePriority: Record<VisibilityRepairStage, number> = {
  source_description: 0,
  pi_identity: 1,
  action_evidence: 2,
  suppression: 3,
  review_exception: 4,
};

const suppressibleReasons = new Set([
  'archive_review',
  'content_page_risk',
  'exact_url_duplicate_risk',
  'generic_directory_shell',
  'inactive_at_yale',
  'not_undergraduate_relevant',
  'research_infrastructure_only',
]);

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const hasHttpUrl = (value: unknown): boolean => /^https?:\/\//i.test(textValue(value));

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

const objectValues = (value: unknown): unknown[] =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.values(value) : [];

const sourceUrlsForLeadMembers = (leadMembers: Array<Record<string, any>> = []): string[] =>
  uniqueStrings(
    leadMembers.flatMap((member) =>
      [
        member.sourceUrl,
        ...objectValues(member.user?.profileUrls),
        member.facultyMember?.profileUrl,
        member.user?.website,
        member.user?.websiteUrl,
        member.facultyMember?.website,
      ].filter((url) => hasHttpUrl(url) && profileUrlMatchesMemberName(url, member)),
    ),
  );

const sourceUrlsForFieldProvenance = (entity: Record<string, any>): string[] =>
  uniqueStrings(
    objectValues(entity.fieldProvenance).flatMap((provenance) => {
      if (!provenance || typeof provenance !== 'object') return [];
      return [(provenance as Record<string, unknown>).sourceUrl];
    }),
  ).filter(hasHttpUrl);

const isLeadMember = (member: Record<string, any>): boolean =>
  ['pi', 'principal-investigator', 'principal investigator', 'director', 'lead'].includes(
    textValue(member.role).toLowerCase(),
  );

const cleanResearchInterest = (value: unknown): string => {
  const text = textValue(value)
    .replace(/\bYSM Researcher\b/gi, '')
    .replace(/\bFields of Interest\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length < 4) return '';
  if (/^(?:n\/a|none|unknown)$/i.test(text)) return '';
  return text;
};

const meaningfulInterestTokens = (value: string): string[] =>
  textValue(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (token) =>
        token.length >= 5 &&
        !['global', 'health', 'systems', 'quality', 'issues', 'studies'].includes(token),
    );

const interestCorroboratedByBio = (interest: string, bio: string): boolean => {
  if (!bio) return true;
  const normalizedBio = bio
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  const tokens = meaningfulInterestTokens(interest);
  if (tokens.length === 0) return false;
  return tokens.some((token) => normalizedBio.includes(token));
};

const leadResearchInterestCandidates = (
  leadMembers: Array<Record<string, any>> = [],
): Array<{ value: string; shortValue?: string; label: string; sourceUrl?: string }> =>
  leadMembers
    .filter(isLeadMember)
    .flatMap((member) => {
      const sourceUrl = profileSourceUrlForMember(member, { requirePersonNameMatch: true });
      if (!sourceUrl) return [];

      const profileBio = textValue(member.user?.bio);
      const interests = uniqueStrings([
        ...(Array.isArray(member.user?.researchInterests) ? member.user.researchInterests : []),
        ...(Array.isArray(member.user?.topics) ? member.user.topics : []),
        ...(Array.isArray(member.facultyMember?.researchInterests)
          ? member.facultyMember.researchInterests
          : []),
      ])
        .map(cleanResearchInterest)
        .filter(Boolean)
        .slice(0, 5);

      const corroboratedInterests =
        profileBio.length >= 80
          ? interests.filter((interest) => interestCorroboratedByBio(interest, profileBio))
          : interests;

      if (corroboratedInterests.length < 3) return [];

      const lead = corroboratedInterests.slice(0, 3);
      const formatted =
        lead.length === 1
          ? lead[0]
          : `${lead.slice(0, -1).join(', ')}, and ${lead[lead.length - 1]}`;

      return [
        {
          label: 'lead research interests',
          value: `Research fields include ${formatted}.`,
          shortValue: `Studies ${formatted}.`,
          sourceUrl,
        },
      ];
    });

const profileBioSentences = (value: unknown): string[] =>
  textValue(value)
    .replace(/^Bio\s+/i, '')
    .match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)
    ?.map((sentence) => textValue(sentence))
    .filter(Boolean) || [];

const researchFocusedProfileBioSummary = (bio: unknown): string => {
  for (const sentence of profileBioSentences(bio)) {
    const interests = sentence.match(
      /\bresearch(?:\s+and\s+teaching)?\s+interests?\s+include(?:,?\s+among\s+other\s+things,?)?\s+(.+?)(?:[.!?]|$)/i,
    );
    if (interests?.[1]) {
      return `Research interests include ${interests[1].replace(/[.!?]+$/g, '').trim()}.`;
    }

    const scholarshipIntegrates = sentence.match(
      /\bscholarship\s+integrates\s+(.+?)\s+in\s+analyzing\s+(.+?)(?:[.!?]|$)/i,
    );
    if (scholarshipIntegrates?.[1] && scholarshipIntegrates?.[2]) {
      return `Studies ${scholarshipIntegrates[2]
        .replace(/[.!?]+$/g, '')
        .trim()} using ${scholarshipIntegrates[1].replace(/[.!?]+$/g, '').trim()}.`;
    }

    const scholarshipEmploys = sentence.match(
      /\bscholarship\s+employs\s+(.+?)\s+to\s+(.+?)(?:[.!?]|$)/i,
    );
    if (scholarshipEmploys?.[1] && scholarshipEmploys?.[2]) {
      return `Uses ${scholarshipEmploys[1]
        .replace(/[.!?]+$/g, '')
        .trim()} to ${scholarshipEmploys[2].replace(/[.!?]+$/g, '').trim()}.`;
    }

    const workAnalyzes = sentence.match(
      /\b(?:her|his|their)\s+work\s+(analyzes|examines|explores|investigates|studies)\s+(.+?)(?:[.!?]|$)/i,
    );
    if (workAnalyzes?.[1] && workAnalyzes?.[2]) {
      const verb = workAnalyzes[1].toLowerCase();
      const rest = workAnalyzes[2].replace(/[.!?]+$/g, '').trim();
      return `Research ${verb} ${rest}.`;
    }

    const workHasAddressed = sentence.match(
      /\b(?:her|his|their|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+work\s+has\s+(?:typically\s+)?addressed\s+(.+?)(?:[.!?]|$)/iu,
    );
    if (workHasAddressed?.[1]) {
      return `Research examines ${workHasAddressed[1].replace(/[.!?]+$/g, '').trim()}.`;
    }

    const publicationsFocused = sentence.match(
      /\b(?:publications|published\s+work|research|writing)\s+(?:have|has)?\s*(?:focused|focuses)\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (publicationsFocused?.[1]) {
      return `Research examines ${publicationsFocused[1].replace(/[.!?]+$/g, '').trim()}.`;
    }

    if (/\bis\s+a\s+playwright,\s+actor,\s+and\s+founding\s+member\b/i.test(sentence)) {
      return 'Creative work spans playwriting, acting, collaborative theater practice, and original performance work.';
    }

    if (/\bhas\s+performed\s+internationally\s+with\b/i.test(sentence)) {
      return 'Creative work spans international dance performance, contemporary artist collaborations, and staged movement practice.';
    }
  }

  return '';
};

const profileUserDescriptionCandidates = (
  user: Record<string, any>,
  sourceUrl: string,
): Array<{ value: string; shortValue?: string; label: string; sourceUrl?: string }> => {
  const bio = textValue(user.bio);
  const candidates: Array<{ value: string; shortValue?: string; label: string; sourceUrl?: string }> = [];
  const researchBioSummary = researchFocusedProfileBioSummary(bio);
  const researchSummaryCandidate = researchBioSummary
    ? {
        value: researchBioSummary,
        shortValue: researchBioSummary.replace(
          /^Research\s+(examines|analyzes|explores|investigates|studies)\b/i,
          (_match, verb: string) => `${verb.charAt(0).toUpperCase()}${verb.slice(1).toLowerCase()}`,
        ),
        label: /^Creative work\b/i.test(researchBioSummary)
          ? 'official profile creative practice summary'
          : 'official profile research summary',
        sourceUrl,
      }
    : null;
  const preferResearchSummary =
    !!researchSummaryCandidate &&
    (/\b(?:received|earned|completed)\b.{0,140}\b(?:ph\.?\s*d|doctorate|degree)\b/i.test(bio) ||
      /\bis\s+(?:an?\s+)?(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b/i.test(
        bio,
      ) ||
      /\bhas been a member of\b.{0,80}\bfaculty\b/i.test(bio));

  if (preferResearchSummary && researchSummaryCandidate) {
    candidates.push(researchSummaryCandidate);
  }
  const hasProfileResearchEvidence =
    Boolean(researchSummaryCandidate) ||
    (Array.isArray(user.researchInterests) && user.researchInterests.length > 0) ||
    (Array.isArray(user.topics) && user.topics.length > 0);
  const teachingOnlyProfileChrome =
    /^Interests\b/i.test(bio) &&
    /\bteaches?\b/i.test(bio) &&
    /\bCourses?\b/i.test(bio) &&
    !hasProfileResearchEvidence;
  if (bio.length >= 80 && !teachingOnlyProfileChrome) {
    candidates.push({ value: bio, label: 'official profile bio', sourceUrl });
  }
  if (researchSummaryCandidate && !preferResearchSummary) {
    candidates.push({
      ...researchSummaryCandidate,
      shortValue:
        researchSummaryCandidate.shortValue === researchSummaryCandidate.value
          ? undefined
          : researchSummaryCandidate.shortValue,
    });
  }

  const interests = uniqueStrings([
    ...(Array.isArray(user.researchInterests) ? user.researchInterests : []),
    ...(Array.isArray(user.topics) ? user.topics : []),
  ])
    .map(cleanResearchInterest)
    .filter(Boolean)
    .slice(0, 5);
  if (interests.length >= 3) {
    const lead = interests.slice(0, 3);
    const formatted =
      lead.length === 1
        ? lead[0]
        : `${lead.slice(0, -1).join(', ')}, and ${lead[lead.length - 1]}`;
    candidates.push({
      label: 'official profile research interests',
      value: `Research fields include ${formatted}.`,
      shortValue: `Studies ${formatted}.`,
      sourceUrl,
    });
  }

  return candidates;
};

const sourceBackedTextCandidates = (
  entity: Record<string, any>,
  leadMembers: Array<Record<string, any>> = [],
  extraCandidates: Array<{ value: string; shortValue?: string; label: string; sourceUrl?: string }> = [],
): Array<{ value: string; shortValue?: string; label: string; sourceUrl?: string }> => {
  const profile = entity.profile && typeof entity.profile === 'object' ? entity.profile : {};
  const entitySourceUrls = uniqueStrings([
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    entity.websiteUrl,
    entity.website,
  ]).filter(hasHttpUrl);
  const entitySourceUrl =
    entitySourceUrls.find(isDescriptionEligibleSourceUrl) || entitySourceUrls[0] || '';

  return [
    { value: textValue(entity.description), label: 'description', sourceUrl: entitySourceUrl },
    { value: textValue(entity.fullDescription), label: 'fullDescription', sourceUrl: entitySourceUrl },
    { value: textValue(profile.overview), label: 'profile overview', sourceUrl: entitySourceUrl },
    { value: textValue(profile.bio), label: 'profile bio', sourceUrl: entitySourceUrl },
    { value: textValue(entity.bio), label: 'bio', sourceUrl: entitySourceUrl },
    ...leadProfileDescriptionCandidates(leadMembers),
    ...leadResearchInterestCandidates(leadMembers),
    ...extraCandidates,
  ].filter((candidate) => candidate.value.length > 0);
};

const nonDescriptionSourcePatterns = [
  /\/membership\/directory\/?$/i,
  /\/(?:people|faculty|faculty-directory|directory|members)\/?$/i,
  /(?:^|\.)orcid\.org(?:\/|$)/i,
  /(?:^|\.)doi\.org(?:\/|$)/i,
  /(?:^|\.)openalex\.org(?:\/|$)/i,
  /(?:^|\.)crossref\.org(?:\/|$)/i,
  /reporter\.nih\.gov(?:\/|$)/i,
  /nsf\.gov(?:\/|$)/i,
  /api\.nsf\.gov(?:\/|$)/i,
];

function isDescriptionEligibleSourceUrl(value: unknown): boolean {
  const urlText = textValue(value);
  if (!hasHttpUrl(urlText)) return false;
  try {
    const url = new URL(urlText);
    const hostPath = `${url.hostname}${url.pathname}`.replace(/\/+$/, '');
    return !nonDescriptionSourcePatterns.some((pattern) => pattern.test(hostPath));
  } catch {
    return false;
  }
}

const urlVariants = (urls: unknown[]): string[] => {
  const variants = new Set<string>();
  for (const raw of urls) {
    const value = textValue(raw);
    if (!hasHttpUrl(value)) continue;
    variants.add(value);
    if (value.endsWith('/')) variants.add(value.replace(/\/+$/, ''));
    else variants.add(`${value}/`);
    const medicineProfile = value.replace(
      /^https:\/\/medicine\.yale\.edu\/[^/]+\/profile\//i,
      'https://medicine.yale.edu/profile/',
    );
    if (medicineProfile !== value) {
      variants.add(medicineProfile);
      if (medicineProfile.endsWith('/')) variants.add(medicineProfile.replace(/\/+$/, ''));
      else variants.add(`${medicineProfile}/`);
    }
    const medicineAtoz = value.replace(
      /^https:\/\/medicine\.yale\.edu\/about\/a-to-z-index\/lab-websites\/?$/i,
      'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
    );
    if (medicineAtoz !== value) {
      variants.add(medicineAtoz);
      variants.add(medicineAtoz.replace(/\/+$/, ''));
    }
    const medicineAtozCanonical = value.replace(
      /^https:\/\/medicine\.yale\.edu\/about\/a-to-z-index\/atoz\/lab-websites\/?$/i,
      'https://medicine.yale.edu/about/a-to-z-index/lab-websites/',
    );
    if (medicineAtozCanonical !== value) {
      variants.add(medicineAtozCanonical);
      variants.add(medicineAtozCanonical.replace(/\/+$/, ''));
    }
  }
  return Array.from(variants);
};

const officialProfileUrlsForEntity = (entity: Record<string, any>): string[] =>
  urlVariants([
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ]).filter((url) => /\/\/[^/]*yale\.edu\/(?:.*\/)?profile\//i.test(url));

const isOfficialYaleProfileUrl = (value: unknown): boolean =>
  /\/\/[^/]*yale\.edu\/(?:.*\/)?profile\//i.test(textValue(value));

const isOrcidProfileUrl = (value: unknown): boolean =>
  /^https?:\/\/orcid\.org\/\d{4}-\d{4}-\d{4}-\d{3}[\dX]\/*$/i.test(textValue(value));

const isLikelyPersonProfileUrl = (value: unknown): boolean => {
  const urlText = textValue(value);
  if (!hasHttpUrl(urlText)) return false;
  try {
    const url = new URL(urlText);
    const path = url.pathname.toLowerCase();
    return /\/(?:profile|people|faculty|faculty-directory)\//.test(path);
  } catch {
    return false;
  }
};

const isListingOrDirectoryUrl = (value: unknown): boolean => {
  const urlText = textValue(value);
  if (!hasHttpUrl(urlText)) return true;
  try {
    const url = new URL(urlText);
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return /\/(?:people|faculty|faculty-directory|directory|members|centers-initiatives)$/.test(path);
  } catch {
    return true;
  }
};

const ownWebsiteUrlsForEntity = (entity: Record<string, any>): string[] =>
  urlVariants([entity.websiteUrl, entity.website]).filter(
    (url) => hasHttpUrl(url) && !isOfficialYaleProfileUrl(url) && !isListingOrDirectoryUrl(url),
  );

const nameTokens = (value: unknown): string[] =>
  textValue(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((token) => token.length > 1 && !['lab', 'research', 'faculty', 'area'].includes(token));

const personNameTokens = (value: unknown): string[] =>
  textValue(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((token) => token.length > 1 && !['profile', 'people'].includes(token));

const userDisplayName = (user: Record<string, any>): string =>
  textValue(user.displayName) ||
  textValue(`${textValue(user.fname || user.firstName)} ${textValue(user.lname || user.lastName)}`);

const memberDisplayName = (member: Record<string, any>): string =>
  userDisplayName(member.user || {}) ||
  textValue(member.facultyMember?.name) ||
  textValue(member.name);

const memberEmailLocalTokens = (member: Record<string, any>): string[] => {
  const email = textValue(member.user?.email || member.facultyMember?.email || member.email).toLowerCase();
  if (!/^[^@\s]+@yale\.edu$/i.test(email)) return [];
  const localPart = email.split('@')[0] || '';
  return personNameTokens(localPart).filter((token) => token.length > 1);
};

const entityPersonDisplayName = (entity: Record<string, any>): string =>
  textValue(entity.displayName || entity.name || entity.slug)
    .replace(/\s+(?:faculty\s+research|research|lab(?:oratory)?)$/i, '')
    .trim();

const userNameMatchesEntity = (user: Record<string, any>, entity: Record<string, any>): boolean => {
  const userTokens = nameTokens(userDisplayName(user));
  if (userTokens.length < 2) return false;
  const entityTokens = new Set(nameTokens([entity.name, entity.displayName, entity.slug].join(' ')));
  return entityTokens.has(userTokens[0]) && entityTokens.has(userTokens[userTokens.length - 1]);
};

const profileUrlMatchesMemberName = (url: unknown, member: Record<string, any>): boolean => {
  if (!isLikelyPersonProfileUrl(url)) return true;
  const memberTokens = personNameTokens(memberDisplayName(member));
  if (memberTokens.length < 2) return false;

  try {
    const parsed = new URL(textValue(url));
    const path = decodeURIComponent(parsed.pathname)
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    const pathTokenList = personNameTokens(path);
    const pathTokens = new Set(pathTokenList);
    const firstName = memberTokens[0];
    const lastName = memberTokens[memberTokens.length - 1];
    if (pathTokens.has(firstName) && pathTokens.has(lastName)) return true;
    const slug = path.replace(/\/+$/g, '').split('/').pop() || '';
    if (
      isOfficialYaleProfileUrl(url) &&
      /^[a-z]{2,5}\d{1,5}$/i.test(slug) &&
      slug.startsWith(`${firstName[0] || ''}${lastName[0] || ''}`)
    ) {
      return true;
    }
    const emailTokens = memberEmailLocalTokens(member);
    if (
      isOfficialYaleProfileUrl(url) &&
      emailTokens.length >= 2 &&
      emailTokens.includes(lastName) &&
      emailTokens.every((token) => pathTokens.has(token))
    ) {
      return true;
    }
    if (pathTokenList.length === 1 && pathTokens.has(lastName) && lastName.length >= 5) return true;

    const lastTokenIndex = pathTokenList.lastIndexOf(lastName);
    const preLastTokens = lastTokenIndex > 0 ? pathTokenList.slice(0, lastTokenIndex) : [];
    if (preLastTokens.some((token) => token.length > 2 && token !== firstName)) return false;

    const pathCompact = path.replace(/[^a-z0-9]/g, '');
    const lastNameIndex = pathCompact.lastIndexOf(lastName.replace(/[^a-z0-9]/g, ''));
    return (
      pathTokens.has(lastName) &&
      lastNameIndex > 0 &&
      pathCompact.slice(0, lastNameIndex).includes(firstName[0] || '')
    );
  } catch {
    return false;
  }
};

const profileUrlMatchesEntityPersonName = (url: unknown, entity: Record<string, any>): boolean => {
  const name = entityPersonDisplayName(entity);
  if (!name) return false;
  return profileUrlMatchesMemberName(url, { name });
};

const profileSourceUrlForMember = (
  member: Record<string, any>,
  options: { requirePersonNameMatch?: boolean } = {},
): string =>
  (() => {
    const urls = uniqueStrings([
      member.user?.website,
      member.user?.websiteUrl,
      ...objectValues(member.user?.profileUrls),
      member.facultyMember?.website,
      member.facultyMember?.profileUrl,
      member.sourceUrl,
    ]).filter(
      (url) =>
        hasHttpUrl(url) &&
        (!options.requirePersonNameMatch || profileUrlMatchesMemberName(url, member)),
    );
    return urls.find(isOfficialYaleProfileUrl) || urls.find(isLikelyPersonProfileUrl) || urls.find(hasHttpUrl) || '';
  })();

const profileDescriptionSourceUrlForMember = (member: Record<string, any>): string => {
  const urls = uniqueStrings([
    ...objectValues(member.user?.profileUrls),
    member.facultyMember?.profileUrl,
    member.user?.website,
    member.user?.websiteUrl,
    member.facultyMember?.website,
    member.sourceUrl,
  ]).filter((url) => hasHttpUrl(url) && profileUrlMatchesMemberName(url, member));
  return urls.find(isOfficialYaleProfileUrl) || urls.find(isLikelyPersonProfileUrl) || urls[0] || '';
};

const leadProfileDescriptionCandidates = (
  leadMembers: Array<Record<string, any>> = [],
): Array<{ value: string; shortValue?: string; label: string; sourceUrl?: string }> =>
  leadMembers
    .filter(isLeadMember)
    .flatMap((member) => {
      const sourceUrl = profileDescriptionSourceUrlForMember(member);
      if (!sourceUrl) return [];
      return profileUserDescriptionCandidates(member.user || {}, sourceUrl).map((candidate) => ({
        ...candidate,
        label: candidate.label.replace(/^official profile /, 'lead profile '),
      }));
    });

const idValue = (value: unknown): string => {
  const directId = serializedDocumentId(value);
  if (directId) return directId;
  if (typeof value === 'object' && value !== null && '_id' in value) {
    const nestedId = (value as Record<string, unknown>)._id;
    return nestedId === value ? '' : idValue(nestedId);
  }
  return '';
};

const leadMemberUserId = (member: Record<string, any>): string =>
  idValue(member.user?._id) || idValue(member.userId);

const getActionEvidenceObservationIds = (observations: Array<Record<string, any>>): string[] =>
  observations.map((observation) => idValue(observation._id)).filter((id): id is string => Boolean(id));

const visibilityRepairSourceKey = 'visibility-repair-queue';
const visibilityRepairConfidence = 0.38;

function trustedActionLead(leadMembers: Array<Record<string, any>> = []): {
  userId: string;
  name: string;
  sourceUrl: string;
} | null {
  let fallback: { userId: string; name: string; sourceUrl: string } | null = null;

  for (const member of leadMembers.filter(isLeadMember)) {
    const sourceUrl = profileSourceUrlForMember(member, { requirePersonNameMatch: true });
    const userId = leadMemberUserId(member);
    if (!userId || !hasHttpUrl(sourceUrl)) continue;
    if (isOrcidProfileUrl(sourceUrl)) continue;
    if (!isOfficialYaleProfileUrl(sourceUrl) && !isLikelyPersonProfileUrl(sourceUrl)) continue;

    const candidate = {
      userId,
      name: memberDisplayName(member),
      sourceUrl,
    };

    if (isOfficialYaleProfileUrl(sourceUrl)) return candidate;
    if (!fallback) fallback = candidate;
  }

  return fallback;
}

function trustedActionLeadForEntity(
  leadMembers: Array<Record<string, any>> = [],
  entity: Record<string, any>,
): {
  userId: string;
  name: string;
  sourceUrl: string;
} | null {
  const trustedByMemberName = trustedActionLead(leadMembers);
  if (trustedByMemberName) return trustedByMemberName;

  const entityName = entityPersonDisplayName(entity);
  if (!entityName) return null;

  for (const member of leadMembers.filter(isLeadMember)) {
    const userId = leadMemberUserId(member);
    if (!userId) continue;
    const urls = uniqueStrings([
      member.user?.website,
      member.user?.websiteUrl,
      ...objectValues(member.user?.profileUrls),
      member.facultyMember?.website,
      member.facultyMember?.profileUrl,
      member.sourceUrl,
    ]).filter(
      (url) =>
        hasHttpUrl(url) &&
        !isOrcidProfileUrl(url) &&
        (isOfficialYaleProfileUrl(url) || isLikelyPersonProfileUrl(url)) &&
        profileUrlMatchesEntityPersonName(url, entity),
    );
    const sourceUrl = urls.find(isOfficialYaleProfileUrl) || urls.find(isLikelyPersonProfileUrl) || urls[0] || '';
    if (!sourceUrl) continue;
    return {
      userId,
      name: entityName,
      sourceUrl,
    };
  }

  return null;
}

export function classifyVisibilityRepairStage(reasons: string[] = []): VisibilityRepairStage {
  if (reasons.some((reason) => reviewExceptionReasons.has(reason))) return 'review_exception';
  if (reasons.includes('exact_url_duplicate_risk')) return 'suppression';
  if (reasons.includes('generic_directory_shell')) return 'suppression';
  if (reasons.some((reason) => sourceDescriptionReasons.has(reason))) return 'source_description';
  if (reasons.some((reason) => piReasons.has(reason))) return 'pi_identity';
  if (reasons.some((reason) => actionReasons.has(reason))) return 'action_evidence';
  if (reasons.some((reason) => suppressionReasons.has(reason))) return 'suppression';
  return 'review_exception';
}

export function repairActionForStage(stage: VisibilityRepairStage, reasons: string[] = []): string {
  if (stage === 'source_description') {
    if (reasons.includes('missing_source_url')) return 'Attach a trusted official source URL, then re-run visibility gates.';
    return 'Backfill source-backed description fields from trusted source evidence.';
  }
  if (stage === 'pi_identity') {
    return 'Resolve PI identity and relationship evidence before student visibility promotion.';
  }
  if (stage === 'action_evidence') {
    return 'Attach source-backed access signals, entry pathways, contact routes, or posted opportunities.';
  }
  if (stage === 'suppression') {
    return 'Keep hidden unless a trusted source proves this record is current and undergraduate-relevant.';
  }
  if (reasons.includes('formalization_only')) {
    return 'Keep capped unless source evidence shows mentor matching, project placement, internship, RA program, or another real entry route.';
  }
  return 'Queue for exception handling; no deterministic repair is available yet.';
}

export function buildVisibilityRepairPlan(item: VisibilityRepairQueueItemInput): VisibilityRepairPlan {
  const blockerReasons = uniqueStrings(item.blockerReasons || []);
  const repairStage = classifyVisibilityRepairStage(blockerReasons);
  const safeToAttempt =
    repairStage === 'source_description' ||
    repairStage === 'pi_identity' ||
    repairStage === 'action_evidence';

  return {
    queueItemId: String(item._id || `${item.collection}:${item.recordId}`),
    collection: item.collection,
    recordId: item.recordId,
    label: item.label || item.recordId,
    repairStage,
    repairStatus: item.repairStatus || 'queued',
    priority: stagePriority[repairStage],
    blockerReasons,
    nextRepairAction: repairActionForStage(repairStage, blockerReasons),
    safeToAttempt,
  };
}

export function buildVisibilityRepairPlans(items: VisibilityRepairQueueItemInput[]): VisibilityRepairPlan[] {
  return items
    .map(buildVisibilityRepairPlan)
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
}

function buildResearchSourceDescriptionPatch(
  entity: Record<string, any>,
  leadMembers: Array<Record<string, any>> = [],
  extraCandidates: Array<{ value: string; shortValue?: string; label: string; sourceUrl?: string }> = [],
): {
  patch: Record<string, unknown>;
  summary: string[];
  repairSource: string;
} {
  const rawSourceUrls = uniqueStrings([
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    entity.websiteUrl,
    entity.website,
    ...sourceUrlsForFieldProvenance(entity),
    ...sourceUrlsForLeadMembers(leadMembers),
  ]).filter(hasHttpUrl);
  const candidateSourceUrls = rawSourceUrls.filter((url) => !isListingOrDirectoryUrl(url));
  const descriptionSourceUrls = candidateSourceUrls.filter(isDescriptionEligibleSourceUrl);
  const sourceUrls = descriptionSourceUrls.length > 0 ? candidateSourceUrls : [];
  const sourceEligible = descriptionSourceUrls.length > 0;
  const patch: Record<string, unknown> = {};
  const summary: string[] = [];
  let repairSource = descriptionSourceUrls[0] || sourceUrls[0] || rawSourceUrls[0] || '';

  const provenanceSourceUrls = sourceUrlsForFieldProvenance(entity);
  const includesProvenanceSourceUrl = provenanceSourceUrls.some((url) => sourceUrls.includes(url));

  const existingSourceUrlCount = Array.isArray(entity.sourceUrls) ? entity.sourceUrls.length : 0;
  if (sourceEligible && !Array.isArray(entity.sourceUrls)) {
    patch.sourceUrls = sourceUrls;
    summary.push(
      includesProvenanceSourceUrl
        ? 'attached sourceUrls from field provenance'
        : 'attached sourceUrls from trusted website fields',
    );
  } else if (sourceEligible && sourceUrls.length !== (entity.sourceUrls || []).length) {
    patch.sourceUrls = sourceUrls;
    summary.push(
      existingSourceUrlCount === 0
        ? includesProvenanceSourceUrl
          ? 'attached sourceUrls from field provenance'
          : 'attached sourceUrls from trusted website fields'
        : includesProvenanceSourceUrl
          ? 'deduped trusted sourceUrls from field provenance'
          : 'deduped trusted sourceUrls',
    );
  }

  for (const candidate of sourceBackedTextCandidates(entity, leadMembers, extraCandidates)) {
    if (!sourceEligible) continue;
    const candidateSourceEligible =
      !candidate.sourceUrl || isDescriptionEligibleSourceUrl(candidate.sourceUrl);
    if (!candidateSourceEligible) continue;
    const candidateQuality = assessResearchEntityDescriptionQuality({
      fullDescription: candidate.value,
      shortDescription: candidate.value,
      sourceUrls,
      website: entity.website,
      websiteUrl: entity.websiteUrl,
    });
    const currentQuality = assessResearchEntityDescriptionQuality({
      fullDescription: patch.fullDescription || entity.fullDescription,
      shortDescription: patch.shortDescription || entity.shortDescription,
      sourceUrls,
      website: entity.website,
      websiteUrl: entity.websiteUrl,
    });

    if (candidateQuality.full.isUseful && !currentQuality.full.isUseful) {
      patch.fullDescription = candidate.value;
      repairSource = candidate.sourceUrl || repairSource;
      summary.push(`copied useful source-backed ${candidate.label} into fullDescription`);
    }
    if (candidateQuality.full.isUseful && !currentQuality.short.isUseful) {
      const explicitShortQuality = candidate.shortValue
        ? assessResearchEntityDescriptionQuality({
            fullDescription: candidate.value,
            shortDescription: candidate.shortValue,
            sourceUrls,
            website: entity.website,
            websiteUrl: entity.websiteUrl,
          }).short
        : undefined;
      const derivedShortDescription = explicitShortQuality?.isUseful
        ? candidate.shortValue
        : deriveShortDescriptionFromFullDescription(candidate.value);
      const derivedShortQuality = derivedShortDescription
        ? assessResearchEntityDescriptionQuality({
            fullDescription: candidate.value,
            shortDescription: derivedShortDescription,
            sourceUrls,
            website: entity.website,
            websiteUrl: entity.websiteUrl,
          }).short
        : undefined;
      if (derivedShortDescription && derivedShortQuality?.isUseful) {
        patch.shortDescription = derivedShortDescription;
        repairSource = candidate.sourceUrl || repairSource;
        summary.push(`derived shortDescription from source-backed ${candidate.label}`);
      }
    }
  }

  return { patch, summary, repairSource };
}

async function findOfficialProfileUserMatch(
  entity: Record<string, any>,
  deps: RepairDeps,
): Promise<{ user: Record<string, any>; userId: string; name: string; sourceUrl: string } | null> {
  if (!deps.findUserByProfileUrl) return null;
  const profileUrls = officialProfileUrlsForEntity(entity);
  if (profileUrls.length === 0) return null;

  const user = await deps.findUserByProfileUrl(profileUrls);
  const userId = idValue(user?._id);
  if (!user || !userId || !userNameMatchesEntity(user, entity)) return null;

  const sourceUrl =
    profileUrls.find((url) =>
      uniqueStrings([
        user.website,
        user.websiteUrl,
        ...objectValues(user.profileUrls),
      ]).some((candidate) => urlVariants([candidate]).includes(url)),
    ) || profileUrls[0];

  return {
    user,
    userId,
    name: userDisplayName(user),
    sourceUrl,
  };
}

function officialProfileLeadMember(match: {
  user: Record<string, any>;
  userId: string;
  sourceUrl: string;
}): Record<string, any> {
  return {
    role: 'pi',
    userId: match.userId,
    user: match.user,
    sourceUrl: match.sourceUrl,
  };
}

function archivedResearchEntityRepairBlock(
  plan: VisibilityRepairPlan,
  entity: Record<string, any>,
): VisibilityRepairAttempt | null {
  if (entity.archived !== true) return null;

  return {
    plan,
    applied: false,
    status: 'blocked',
    patchSummary: [],
    remainingBlockers: uniqueStrings([...plan.blockerReasons, 'archived_research_entity']),
    repairSource: uniqueStrings([
      entity.websiteUrl,
      entity.website,
      ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    ]).find(hasHttpUrl) || '',
  };
}

async function upsertOrReuseOfficialProfileActionPathway({
  plan,
  deps,
  userId,
  sourceUrl,
  evidenceIds,
  reusablePathway,
}: {
  plan: VisibilityRepairPlan;
  deps: RepairDeps;
  userId: string;
  sourceUrl: string;
  evidenceIds: string[];
  reusablePathway?: { pathwayId?: string; derivationKey?: string; doc?: any } | null;
}): Promise<{ pathwayId?: string; reused: boolean }> {
  const reusable = reusablePathway || (deps.findReusableExploratoryContactPathway
    ? await deps.findReusableExploratoryContactPathway(plan.recordId)
    : null);
  const reusablePathwayId = idValue(reusable?.pathwayId) || idValue(reusable?.doc?._id);
  const derivationKey = textValue(reusable?.derivationKey) || textValue(reusable?.doc?.derivationKey);

  if (reusablePathwayId && !derivationKey) {
    return { pathwayId: reusablePathwayId, reused: true };
  }

  const pathway = await deps.upsertEntryPathway?.({
    researchEntityId: plan.recordId,
    pathwayType: 'EXPLORATORY_CONTACT',
    status: 'PLAUSIBLE',
    evidenceStrength: 'WEAK',
    studentFacingLabel: 'Explore this research area through the official faculty profile',
    explanation:
      'Official Yale profile evidence identifies a lead faculty member for this research area. No active undergraduate posting is currently attached.',
    bestNextStep:
      'Review the official profile and prepare specific outreach that references the research area before contacting the faculty member.',
    compensation: 'UNKNOWN',
    sourceEvidenceIds: evidenceIds,
    sourceUrls: [sourceUrl],
    confidence: 0.52,
    derivationKey: derivationKey || `visibility-repair:official-profile-outreach:${userId}`,
    archived: false,
    lastObservedAt: new Date(),
  });

  return {
    pathwayId: pathway?.pathwayId || idValue(pathway?.doc?._id) || reusablePathwayId,
    reused: Boolean(reusablePathwayId),
  };
}

const sourceEvidenceIdsFromReusablePathway = (
  reusable: { pathwayId?: string; derivationKey?: string; doc?: any } | null,
): string[] =>
  uniqueStrings(Array.isArray(reusable?.doc?.sourceEvidenceIds) ? reusable.doc.sourceEvidenceIds.map(idValue) : []);

async function createOfficialProfileActionEvidenceRepair({
  plan,
  mode,
  deps,
  match,
}: {
  plan: VisibilityRepairPlan;
  mode: VisibilityRepairMode;
  deps: RepairDeps;
  match: { userId: string; name: string; sourceUrl: string };
}): Promise<{ repaired: boolean; summary: string[] }> {
  if (
    !deps.upsertEntryPathway ||
    !deps.upsertContactRoute ||
    !deps.upsertAccessSignal ||
    !deps.findActionEvidenceObservationIds
  ) {
    return { repaired: false, summary: [] };
  }

  let reusablePathway: { pathwayId?: string; derivationKey?: string; doc?: any } | null = null;
  let evidenceIds =
    mode === 'apply'
      ? await deps.findActionEvidenceObservationIds({
          researchEntityId: plan.recordId,
          userId: match.userId,
          sourceUrl: match.sourceUrl,
        })
      : ['dry-run-official-profile-evidence'];
  if (evidenceIds.length === 0 && deps.findReusableExploratoryContactPathway) {
    reusablePathway = await deps.findReusableExploratoryContactPathway(plan.recordId);
    evidenceIds = sourceEvidenceIdsFromReusablePathway(reusablePathway);
  }
  if (evidenceIds.length === 0) return { repaired: false, summary: [] };

  if (mode === 'apply') {
    const pathway = await upsertOrReuseOfficialProfileActionPathway({
      plan,
      deps,
      userId: match.userId,
      sourceUrl: match.sourceUrl,
      evidenceIds,
      reusablePathway,
    });

    await deps.upsertAccessSignal({
      researchEntityId: plan.recordId,
      entryPathwayId: pathway.pathwayId,
      signalType: 'REACH_OUT_PLAUSIBLE',
      confidence: 'LOW',
      confidenceScore: 0.52,
      observedAt: new Date(),
      sourceEvidenceId: evidenceIds[0],
      excerpt: 'Official Yale profile identifies the lead faculty member for this research area.',
      sourceName: 'visibility-repair-queue',
      sourceUrl: match.sourceUrl,
      originalConfidence: 0.52,
      derivationKey: `visibility-repair:official-profile-outreach:${match.userId}`,
      archived: false,
    });

    await deps.upsertContactRoute({
      researchEntityId: plan.recordId,
      entryPathwayId: pathway.pathwayId,
      routeType: 'FACULTY_PI',
      priority: 70,
      visibility: 'PUBLIC',
      contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
      name: match.name || undefined,
      role: 'Lead faculty profile',
      url: match.sourceUrl,
      rationale:
        'Official Yale profile is the safest public next step when no active posting or application route is attached.',
      sourceEvidenceIds: evidenceIds,
      sourceName: 'visibility-repair-queue',
      sourceUrl: match.sourceUrl,
      observedAt: new Date(),
      derivationKey: `visibility-repair:official-profile-contact:${match.userId}`,
    });
  }

  return {
    repaired: true,
    summary: [
      'created low-confidence exploratory pathway from official PI profile',
      'created reach-out-plausible access signal from official PI profile',
      'created public faculty profile contact route',
    ],
  };
}

function entityActionEvidenceSourceUrl(entity: Record<string, any>): string {
  const urls = uniqueStrings([
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ]).filter(hasHttpUrl);
  return (
    urls.find(isOfficialYaleProfileUrl) ||
    urls.find((url) => isDescriptionEligibleSourceUrl(url) && !isOrcidProfileUrl(url)) ||
    urls[0] ||
    ''
  );
}

function entityActionEvidenceSourceUrls(
  entity: Record<string, any>,
  preferredSourceUrl = '',
): string[] {
  return uniqueStrings([
    preferredSourceUrl,
    entityActionEvidenceSourceUrl(entity),
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    ...sourceUrlsForFieldProvenance(entity),
  ]).filter(hasHttpUrl);
}

async function createEntitySourceActionEvidenceRepair({
  plan,
  mode,
  deps,
  entity,
  sourceUrl,
}: {
  plan: VisibilityRepairPlan;
  mode: VisibilityRepairMode;
  deps: RepairDeps;
  entity: Record<string, any>;
  sourceUrl: string;
}): Promise<{ repaired: boolean; summary: string[]; repairSource: string }> {
  if (
    !deps.upsertEntryPathway ||
    !deps.upsertContactRoute ||
    !deps.upsertAccessSignal ||
    !deps.findEntityActionEvidenceObservationIds
  ) {
    return { repaired: false, summary: [], repairSource: sourceUrl };
  }

  const observations = await deps.findEntityActionEvidenceObservationIds({
    researchEntityId: plan.recordId,
    sourceUrl,
    sourceUrls: entityActionEvidenceSourceUrls(entity, sourceUrl),
  });
  const evidenceIds = uniqueStrings(observations.map((observation) => observation.id));
  if (evidenceIds.length === 0) return { repaired: false, summary: [], repairSource: sourceUrl };

  const evidenceSourceUrl = observations.find((observation) => hasHttpUrl(observation.sourceUrl))?.sourceUrl || sourceUrl;
  const sourceUrls = uniqueStrings([evidenceSourceUrl, sourceUrl]).filter(hasHttpUrl);
  const contactUrl = entityActionEvidenceSourceUrl(entity) || evidenceSourceUrl;
  const derivationKey = `visibility-repair:entity-source-outreach:${plan.recordId}`;

  if (mode === 'apply') {
    const pathway = await deps.upsertEntryPathway({
      researchEntityId: plan.recordId,
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      evidenceStrength: 'WEAK',
      studentFacingLabel: 'Explore this research program through the official source page',
      explanation:
        'Source-backed Yale evidence indicates undergraduate or student relevance, but no active posting or specific contact person is currently attached.',
      bestNextStep:
        'Review the official source page and look for program contact, events, project guidance, or application instructions before reaching out.',
      compensation: 'UNKNOWN',
      sourceEvidenceIds: evidenceIds,
      sourceUrls,
      confidence: 0.45,
      derivationKey,
      archived: false,
      lastObservedAt: new Date(),
    });
    const pathwayId = pathway?.pathwayId || idValue(pathway?.doc?._id);

    await deps.upsertAccessSignal({
      researchEntityId: plan.recordId,
      entryPathwayId: pathwayId,
      signalType: 'REACH_OUT_PLAUSIBLE',
      confidence: 'LOW',
      confidenceScore: 0.45,
      observedAt: new Date(),
      sourceEvidenceId: evidenceIds[0],
      excerpt:
        observations.find((observation) => textValue(observation.excerpt))?.excerpt ||
        'Source-backed entity evidence indicates undergraduate or student relevance.',
      sourceName: observations.find((observation) => textValue(observation.sourceName))?.sourceName || 'visibility-repair-queue',
      sourceUrl: evidenceSourceUrl,
      originalConfidence: 0.45,
      derivationKey,
      archived: false,
    });

    await deps.upsertContactRoute({
      researchEntityId: plan.recordId,
      entryPathwayId: pathwayId,
      routeType: 'UNKNOWN',
      priority: 80,
      visibility: 'PUBLIC',
      contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
      role: 'Research entity source',
      url: contactUrl,
      rationale:
        'The official research entity page is the safest public next step when no active posting, application route, or trusted person owner is attached.',
      sourceEvidenceIds: evidenceIds,
      sourceName: 'visibility-repair-queue',
      sourceUrl: evidenceSourceUrl,
      observedAt: new Date(),
      derivationKey: `visibility-repair:entity-source-contact:${plan.recordId}`,
    });
  }

  return {
    repaired: true,
    summary: [
      'created exploratory pathway from entity-level undergraduate evidence',
      'created reach-out-plausible access signal from entity-level evidence',
      'created public research entity source contact route',
    ],
    repairSource: evidenceSourceUrl,
  };
}

async function attemptResearchActionEvidenceRepair(
  plan: VisibilityRepairPlan,
  mode: VisibilityRepairMode,
  deps: RepairDeps,
): Promise<VisibilityRepairAttempt> {
  const entity = await deps.findResearchEntity(plan.recordId);
  if (!entity) {
    return {
      plan,
      applied: false,
      status: 'blocked',
      patchSummary: [],
      remainingBlockers: [...plan.blockerReasons, 'record_not_found'],
      repairSource: '',
    };
  }
  const archivedBlock = archivedResearchEntityRepairBlock(plan, entity);
  if (archivedBlock) return archivedBlock;

  const leadMembers = deps.findResearchEntityMembers
    ? await deps.findResearchEntityMembers(plan.recordId)
    : [];
  const quality = buildResearchEntityQualitySummary({ entity, leadMembers });
  const actionLead = trustedActionLeadForEntity(leadMembers, entity);
  const actionEvidenceSourceUrl = uniqueStrings([
    actionLead?.sourceUrl,
    entityActionEvidenceSourceUrl(entity),
  ]).find(hasHttpUrl) || '';
  const canRepair =
    quality.descriptionState === 'source_backed' &&
    quality.cardState === 'complete' &&
    quality.leadState === 'lead_attached' &&
    !quality.repairFlags.includes('missing_source_url') &&
    !quality.repairFlags.includes('pi_identity_conflict') &&
    actionLead &&
    Boolean(actionEvidenceSourceUrl);
  let reusablePathway: { pathwayId?: string; derivationKey?: string; doc?: any } | null = null;
  let evidenceIds =
    canRepair && deps.findActionEvidenceObservationIds
      ? await deps.findActionEvidenceObservationIds({
          researchEntityId: plan.recordId,
          userId: actionLead.userId,
          sourceUrl: actionEvidenceSourceUrl || '',
        })
      : [];
  if (canRepair && evidenceIds.length === 0 && deps.findReusableExploratoryContactPathway) {
    reusablePathway = await deps.findReusableExploratoryContactPathway(plan.recordId);
    evidenceIds = sourceEvidenceIdsFromReusablePathway(reusablePathway);
  }
  if (!canRepair && deps.findReusableExploratoryContactPathway) {
    reusablePathway = await deps.findReusableExploratoryContactPathway(plan.recordId);
    evidenceIds = sourceEvidenceIdsFromReusablePathway(reusablePathway);
  }
  const canRepairFromReusableActionEvidence =
    !canRepair &&
    quality.descriptionState === 'source_backed' &&
    quality.cardState === 'complete' &&
    quality.leadState === 'lead_attached' &&
    !quality.repairFlags.includes('missing_source_url') &&
    !quality.repairFlags.includes('pi_identity_conflict') &&
    Boolean(actionEvidenceSourceUrl) &&
    Boolean(reusablePathway) &&
    evidenceIds.length > 0;
  const usingReusablePathwayEvidence = Boolean(reusablePathway) && evidenceIds.length > 0;
  const canRepairFromEntitySourceEvidence =
    !canRepair &&
    !canRepairFromReusableActionEvidence &&
    quality.descriptionState === 'source_backed' &&
    quality.cardState === 'complete' &&
    !quality.repairFlags.includes('missing_source_url') &&
    !quality.repairFlags.includes('duplicate_risk') &&
    !quality.repairFlags.includes('pi_identity_conflict') &&
    Boolean(actionEvidenceSourceUrl);

  if (
    !deps.upsertEntryPathway ||
    !deps.upsertContactRoute ||
    !deps.upsertAccessSignal
  ) {
    return {
        plan,
        applied: false,
        status: 'blocked',
        patchSummary: [],
        remainingBlockers: [...plan.blockerReasons, ...(evidenceIds.length === 0 ? ['missing_source_evidence'] : [])],
        repairSource: actionEvidenceSourceUrl || actionLead?.sourceUrl || '',
    };
  }

  if ((!canRepair && !canRepairFromReusableActionEvidence) || evidenceIds.length === 0) {
    if (canRepairFromEntitySourceEvidence) {
      const entitySourceRepair = await createEntitySourceActionEvidenceRepair({
        plan,
        mode,
        deps,
        entity,
        sourceUrl: actionEvidenceSourceUrl || '',
      });
      if (entitySourceRepair.repaired) {
        return {
          plan,
          applied: true,
          status: 'repaired',
          patchSummary: entitySourceRepair.summary,
          remainingBlockers: [],
          repairSource: entitySourceRepair.repairSource,
        };
      }
    }

    return {
        plan,
        applied: false,
        status: 'blocked',
        patchSummary: [],
        remainingBlockers: [...plan.blockerReasons, ...(evidenceIds.length === 0 ? ['missing_source_evidence'] : [])],
        repairSource: actionEvidenceSourceUrl || actionLead?.sourceUrl || '',
    };
  }

  const repairSourceUrl = actionEvidenceSourceUrl || actionLead?.sourceUrl || '';

  if (mode === 'apply') {
    const pathway = await upsertOrReuseOfficialProfileActionPathway({
      plan,
      deps,
      userId: actionLead?.userId || plan.recordId,
      sourceUrl: repairSourceUrl,
      evidenceIds,
      reusablePathway,
    });
    const hasTrustedActionLead = Boolean(actionLead);

    if (!usingReusablePathwayEvidence) {
      await deps.upsertAccessSignal({
        researchEntityId: plan.recordId,
        entryPathwayId: pathway.pathwayId,
        signalType: 'REACH_OUT_PLAUSIBLE',
        confidence: 'LOW',
        confidenceScore: 0.52,
        observedAt: new Date(),
        sourceEvidenceId: evidenceIds[0],
        excerpt: hasTrustedActionLead
          ? 'Official Yale profile identifies the lead faculty member for this research area.'
          : 'Source-backed pathway evidence supports exploratory contact through the research entity source.',
        sourceName: 'visibility-repair-queue',
        sourceUrl: actionEvidenceSourceUrl,
        originalConfidence: 0.52,
        derivationKey: `visibility-repair:official-profile-outreach:${actionLead?.userId || plan.recordId}`,
        archived: false,
      });
    }

    await deps.upsertContactRoute({
      researchEntityId: plan.recordId,
      entryPathwayId: pathway.pathwayId,
      routeType: hasTrustedActionLead ? 'FACULTY_PI' : 'UNKNOWN',
      priority: 70,
      visibility: 'PUBLIC',
      contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
      name: actionLead?.name || undefined,
      role: hasTrustedActionLead ? 'Lead faculty profile' : 'Research entity source',
      url: actionEvidenceSourceUrl,
      rationale:
        hasTrustedActionLead
          ? 'Official Yale profile is the safest public next step when no active posting or application route is attached.'
          : 'The source-backed research entity page is the safest public next step when no active posting or application route is attached.',
      sourceEvidenceIds: evidenceIds,
      sourceName: 'visibility-repair-queue',
      sourceUrl: actionEvidenceSourceUrl,
      observedAt: new Date(),
      derivationKey: `visibility-repair:official-profile-contact:${actionLead?.userId || plan.recordId}`,
    });
  }

  return {
    plan,
    applied: true,
    status: 'repaired',
    patchSummary: usingReusablePathwayEvidence
      ? [
          'reused existing exploratory pathway evidence',
          'kept existing reach-out-plausible access signal from reusable pathway evidence',
          'created public research entity source contact route',
        ]
      : [
          'created low-confidence exploratory pathway from official PI profile',
          'created reach-out-plausible access signal from official PI profile',
          'created public faculty profile contact route',
        ],
    remainingBlockers: [],
    repairSource: actionEvidenceSourceUrl || actionLead?.sourceUrl || '',
  };
}

async function attemptResearchRepair(
  plan: VisibilityRepairPlan,
  mode: VisibilityRepairMode,
  deps: RepairDeps,
  suppressUnsafe = false,
): Promise<VisibilityRepairAttempt> {
  if (suppressUnsafe && plan.repairStage === 'suppression') {
    if (!plan.blockerReasons.some((reason) => suppressibleReasons.has(reason))) {
      return {
        plan,
        applied: false,
        status: 'blocked',
        patchSummary: [],
        remainingBlockers: plan.blockerReasons,
        repairSource: '',
      };
    }
    if (mode === 'apply') {
      await deps.updateResearchEntity(plan.recordId, {
        studentVisibilityOverrideTier: 'suppressed',
        studentVisibilitySuppressionReason: plan.blockerReasons.join(', '),
      });
    }
    return {
      plan,
      applied: true,
      status: 'repaired',
      patchSummary: ['set studentVisibilityOverrideTier=suppressed for non-launch record'],
      remainingBlockers: [],
      repairSource: 'visibility-release-queue',
    };
  }

  if (plan.repairStage === 'pi_identity') {
    const entity = await deps.findResearchEntity(plan.recordId);
    if (!entity) {
      return {
        plan,
        applied: false,
        status: 'blocked',
        patchSummary: [],
        remainingBlockers: [...plan.blockerReasons, 'record_not_found'],
        repairSource: '',
      };
    }
    const archivedBlock = archivedResearchEntityRepairBlock(plan, entity);
    if (archivedBlock) return archivedBlock;

    const profileUrls = officialProfileUrlsForEntity(entity);
    let sourceUrl = profileUrls[0] || '';
    let user = profileUrls.length > 0 && deps.findUserByProfileUrl
      ? await deps.findUserByProfileUrl(profileUrls)
      : null;

    if (!user && deps.findUserByExactWebsiteUrl) {
      const ownWebsiteUrls = ownWebsiteUrlsForEntity(entity);
      user = ownWebsiteUrls.length > 0 ? await deps.findUserByExactWebsiteUrl(ownWebsiteUrls) : null;
      if (user && !userNameMatchesEntity(user, entity)) user = null;
      if (user) sourceUrl = ownWebsiteUrls[0];
    }

    if (!user?._id || !deps.upsertResearchEntityMember) {
      const entitySourceRepair = plan.blockerReasons.includes('missing_action_evidence')
        ? await createEntitySourceActionEvidenceRepair({
            plan,
            mode,
            deps,
            entity,
            sourceUrl: entityActionEvidenceSourceUrl(entity),
          })
        : { repaired: false, summary: [], repairSource: sourceUrl };
      if (entitySourceRepair.repaired) {
        const remainingBlockers = plan.blockerReasons.filter((reason) => {
          if (reason === 'missing_action_evidence') return false;
          return true;
        });
        return {
          plan,
          applied: true,
          status: remainingBlockers.length === 0 ? 'repaired' : 'blocked',
          patchSummary: entitySourceRepair.summary,
          remainingBlockers,
          repairSource: entitySourceRepair.repairSource,
        };
      }

      return {
        plan,
        applied: false,
        status: 'blocked',
        patchSummary: [],
        remainingBlockers: plan.blockerReasons,
        repairSource: sourceUrl,
      };
    }

    const userId = normalizeVisibilityRepairObjectId(user._id) || '';
    if (mode === 'apply') {
      await deps.upsertResearchEntityMember(plan.recordId, userId, {
        sourceUrl,
        sourceName: 'visibility-repair-queue',
        confidence: 0.86,
      });
    }
    const actionRepair = plan.blockerReasons.includes('missing_action_evidence')
      ? await createOfficialProfileActionEvidenceRepair({
          plan,
          mode,
          deps,
          match: {
            userId,
            name: userDisplayName(user),
            sourceUrl,
          },
        })
      : { repaired: false, summary: [] };
    const remainingBlockers = plan.blockerReasons.filter((reason) => {
      if (reason === 'missing_lead' || reason === 'profile_identity_risk') return false;
      if (reason === 'missing_action_evidence') return !actionRepair.repaired;
      return true;
    });

    return {
      plan,
      applied: true,
      status: remainingBlockers.length === 0 ? 'repaired' : 'blocked',
      patchSummary: [
        'attached PI member from exact source/user URL match',
        ...actionRepair.summary,
      ],
      remainingBlockers,
      repairSource: sourceUrl,
    };
  }

  if (plan.repairStage === 'action_evidence') {
    return attemptResearchActionEvidenceRepair(plan, mode, deps);
  }

  if (plan.repairStage !== 'source_description') {
    return {
      plan,
      applied: false,
      status: 'blocked',
      patchSummary: [],
      remainingBlockers: plan.blockerReasons,
      repairSource: '',
    };
  }

  const entity = await deps.findResearchEntity(plan.recordId);
  if (!entity) {
    return {
      plan,
      applied: false,
      status: 'blocked',
      patchSummary: [],
      remainingBlockers: [...plan.blockerReasons, 'record_not_found'],
      repairSource: '',
    };
  }
  const archivedBlock = archivedResearchEntityRepairBlock(plan, entity);
  if (archivedBlock) return archivedBlock;

  const leadMembers = deps.findResearchEntityMembers
    ? await deps.findResearchEntityMembers(plan.recordId)
    : [];
  const currentQuality = buildResearchEntityQualitySummary({ entity, leadMembers });
  const currentRepairFlags = new Set(currentQuality.repairFlags);
  const staleSourceDescriptionBlockers = plan.blockerReasons.filter((reason) =>
    sourceDescriptionReasons.has(reason),
  );
  const nonSourceDescriptionBlockers = plan.blockerReasons.filter(
    (reason) => !sourceDescriptionReasons.has(reason),
  );
  if (
    plan.repairStage === 'source_description' &&
    staleSourceDescriptionBlockers.length > 0 &&
    nonSourceDescriptionBlockers.length === 0 &&
    textValue(entity.fullDescription) &&
    textValue(entity.shortDescription) &&
    currentQuality.score === 0 &&
    staleSourceDescriptionBlockers.every((reason) => !currentRepairFlags.has(reason as any))
  ) {
    return {
      plan,
      applied: true,
      status: 'repaired',
      patchSummary: ['resolved stale source-description queue blockers against current quality'],
      remainingBlockers: [],
      repairSource: entityActionEvidenceSourceUrl(entity),
    };
  }
  const profileMatch = await findOfficialProfileUserMatch(entity, deps);
  const prospectiveLeadMembers = profileMatch
    ? [...leadMembers, officialProfileLeadMember(profileMatch)]
    : leadMembers;
  const profileDescriptionCandidates = profileMatch
    ? profileUserDescriptionCandidates(profileMatch.user, profileMatch.sourceUrl)
    : [];
  const { patch, summary, repairSource } = buildResearchSourceDescriptionPatch(
    entity,
    prospectiveLeadMembers,
    profileDescriptionCandidates,
  );
  const patchSummary = [...summary];
  let leadRepaired = false;

  if (
    profileMatch &&
    plan.blockerReasons.includes('missing_lead') &&
    deps.upsertResearchEntityMember
  ) {
    if (mode === 'apply') {
      await deps.upsertResearchEntityMember(plan.recordId, profileMatch.userId, {
        sourceUrl: profileMatch.sourceUrl,
        sourceName: 'visibility-repair-queue',
        confidence: 0.86,
      });
    }
    leadRepaired = true;
    patchSummary.push('attached PI member from exact official profile URL match');
  }

  let actionRepair =
    profileMatch && plan.blockerReasons.includes('missing_action_evidence')
      ? await createOfficialProfileActionEvidenceRepair({
          plan,
          mode,
          deps,
          match: profileMatch,
        })
      : { repaired: false, summary: [] };
  let actionRepairSource = '';
  if (!actionRepair.repaired && plan.blockerReasons.includes('missing_action_evidence')) {
    const entitySourceRepair = await createEntitySourceActionEvidenceRepair({
      plan,
      mode,
      deps,
      entity: {
        ...entity,
        ...patch,
      },
      sourceUrl: repairSource || profileMatch?.sourceUrl || entityActionEvidenceSourceUrl(entity),
    });
    if (entitySourceRepair.repaired) {
      actionRepair = entitySourceRepair;
      actionRepairSource = entitySourceRepair.repairSource;
    }
  }
  if (actionRepair.repaired) patchSummary.push(...actionRepair.summary);

  if (Object.keys(patch).length === 0 && !leadRepaired && !actionRepair.repaired) {
    return {
      plan,
      applied: false,
      status: 'blocked',
      patchSummary: [],
      remainingBlockers: plan.blockerReasons,
      repairSource,
    };
  }

  if (mode === 'apply' && Object.keys(patch).length > 0) {
    await deps.updateResearchEntity(plan.recordId, patch);
  }

  const patchedSourceUrl = Object.prototype.hasOwnProperty.call(patch, 'sourceUrls');
  const patchedDescription =
    Object.prototype.hasOwnProperty.call(patch, 'fullDescription') ||
    Object.prototype.hasOwnProperty.call(patch, 'shortDescription');
  const valueAfterPatch = (field: string) =>
    Object.prototype.hasOwnProperty.call(patch, field) ? patch[field] : entity[field];
  const postPatchQuality = assessResearchEntityDescriptionQuality({
    fullDescription: valueAfterPatch('fullDescription'),
    shortDescription: valueAfterPatch('shortDescription'),
    sourceUrls: Array.isArray(patch.sourceUrls) ? patch.sourceUrls : entity.sourceUrls,
    website: entity.website,
    websiteUrl: entity.websiteUrl,
  });
  const remainingBlockers = plan.blockerReasons.filter((reason) => {
    if (reason === 'missing_lead') return !leadRepaired;
    if (reason === 'missing_action_evidence') return !actionRepair.repaired;
    if (reason === 'missing_source_url') return !patchedSourceUrl;
    if (
      reason === 'missing_description' ||
      reason === 'thin_description' ||
      reason === 'profile_fallback_only'
    ) {
      return !postPatchQuality.full.isUseful;
    }
    if (reason === 'missing_card_description') return !postPatchQuality.short.isUseful;
    if (
      sourceDescriptionReasons.has(reason)
    ) {
      return !patchedDescription;
    }
    return true;
  });
  if (
    patchedDescription &&
    postPatchQuality.full.isUseful &&
    !postPatchQuality.short.isUseful &&
    !remainingBlockers.includes('missing_card_description')
  ) {
    remainingBlockers.push('missing_card_description');
  }

  return {
    plan,
    applied: true,
    status: remainingBlockers.length === 0 ? 'repaired' : 'blocked',
    patchSummary,
    remainingBlockers,
    repairSource: actionRepairSource || profileMatch?.sourceUrl || repairSource,
  };
}

async function attemptProgramRepair(
  plan: VisibilityRepairPlan,
  mode: VisibilityRepairMode,
  deps: RepairDeps,
  suppressUnsafe = false,
): Promise<VisibilityRepairAttempt> {
  if (suppressUnsafe && plan.repairStage === 'suppression') {
    if (!plan.blockerReasons.some((reason) => suppressibleReasons.has(reason))) {
      return {
        plan,
        applied: false,
        status: 'blocked',
        patchSummary: [],
        remainingBlockers: plan.blockerReasons,
        repairSource: '',
      };
    }
    if (mode === 'apply') {
      await deps.updateProgram(plan.recordId, {
        studentVisibilityOverrideTier: 'suppressed',
        studentVisibilitySuppressionReason: plan.blockerReasons.join(', '),
      });
    }
    return {
      plan,
      applied: true,
      status: 'repaired',
      patchSummary: ['set studentVisibilityOverrideTier=suppressed for non-launch record'],
      remainingBlockers: [],
      repairSource: 'visibility-release-queue',
    };
  }

  if (plan.repairStage !== 'source_description') {
    return {
      plan,
      applied: false,
      status: 'blocked',
      patchSummary: [],
      remainingBlockers: plan.blockerReasons,
      repairSource: '',
    };
  }

  const program = await deps.findProgram(plan.recordId);
  const applicationLink = textValue(program?.applicationLink);
  if (!program || !hasHttpUrl(applicationLink) || hasHttpUrl(program.sourceUrl)) {
    return {
      plan,
      applied: false,
      status: 'blocked',
      patchSummary: [],
      remainingBlockers: plan.blockerReasons,
      repairSource: applicationLink,
    };
  }

  const patch = { sourceUrl: applicationLink };
  if (mode === 'apply') await deps.updateProgram(plan.recordId, patch);

  return {
    plan,
    applied: true,
    status: 'repaired',
    patchSummary: ['copied trusted applicationLink into missing sourceUrl'],
    remainingBlockers: [],
    repairSource: applicationLink,
  };
}

export async function attemptVisibilityRepair(
  plan: VisibilityRepairPlan,
  mode: VisibilityRepairMode,
  deps: RepairDeps,
  suppressUnsafe = false,
): Promise<VisibilityRepairAttempt> {
  if (suppressUnsafe && plan.repairStage === 'suppression') {
    return plan.collection === 'research'
      ? attemptResearchRepair(plan, mode, deps, true)
      : attemptProgramRepair(plan, mode, deps, true);
  }

  if (!plan.safeToAttempt) {
    return {
      plan,
      applied: false,
      status: 'blocked',
      patchSummary: [],
      remainingBlockers: plan.blockerReasons,
      repairSource: '',
    };
  }

  return plan.collection === 'research'
    ? attemptResearchRepair(plan, mode, deps)
    : attemptProgramRepair(plan, mode, deps);
}

const defaultRepairDeps: RepairDeps = {
  async findOpenQueueItems(options) {
    const filter: Record<string, unknown> = { status: 'open' };
    if (options.collection && options.collection !== 'all') filter.collection = options.collection;
    if (options.stage) filter.repairStage = options.stage;
    if (options.recordIds?.length) filter.recordId = { $in: options.recordIds };
    if (options.queueItemIds?.length) {
      const ids = options.queueItemIds
        .map((id) => toVisibilityRepairObjectId(id))
        .filter(Boolean);
      filter._id = { $in: ids };
    }
    filter.repairStatus = options.retryBlocked ? { $in: ['queued', 'blocked'] } : 'queued';
    if (!options.retryBlocked) filter.attemptCount = 0;
    const query = VisibilityReleaseQueueItem.find(filter)
      .sort({ lastSeenAt: -1, _id: 1 })
      .limit(Math.max(1, Math.min(1000, Math.floor(options.stage ? options.limit || 100 : 1000))))
      .lean();
    return query as unknown as VisibilityRepairQueueItemInput[];
  },
  async updateQueueItem(id, patch) {
    const safeId = toVisibilityRepairObjectId(id);
    if (!safeId) return;
    await VisibilityReleaseQueueItem.updateOne({ _id: safeId }, { $set: patch, $inc: { attemptCount: 1 } });
  },
  async findResearchEntity(id) {
    const safeId = normalizeVisibilityRepairObjectId(id);
    return safeId ? ResearchEntity.findById(safeId).lean() : null;
  },
  async findUserByProfileUrl(urls) {
    const variants = urlVariants(urls);
    if (variants.length === 0) return null;
    const matches = await User.aggregate([
      {
        $addFields: {
          profileUrlValues: {
            $map: {
              input: { $objectToArray: { $ifNull: ['$profileUrls', {}] } },
              as: 'profileUrl',
              in: '$$profileUrl.v',
            },
          },
        },
      },
      {
        $match: {
          $or: [
            { website: { $in: variants } },
            { websiteUrl: { $in: variants } },
            { profileUrlValues: { $in: variants } },
          ],
        },
      },
      { $limit: 2 },
    ]);
    return matches.length === 1 ? matches[0] : null;
  },
  async findUserByExactWebsiteUrl(urls) {
    const variants = urlVariants(urls);
    if (variants.length === 0) return null;
    const matches = await User.aggregate([
      {
        $addFields: {
          profileUrlValues: {
            $map: {
              input: { $objectToArray: { $ifNull: ['$profileUrls', {}] } },
              as: 'profileUrl',
              in: '$$profileUrl.v',
            },
          },
        },
      },
      {
        $match: {
          $or: [
            { website: { $in: variants } },
            { websiteUrl: { $in: variants } },
            { profileUrlValues: { $in: variants } },
          ],
        },
      },
      { $limit: 2 },
    ]);
    return matches.length === 1 ? matches[0] : null;
  },
  async upsertResearchEntityMember(researchEntityId, userId, metadata) {
    const { filter, update, options } = buildVisibilityRepairPiMemberUpsert(
      researchEntityId,
      userId,
      metadata,
    );
    await ResearchGroupMember.updateOne(filter, update, options);
  },
  async upsertEntryPathway(input) {
    return upsertEntryPathway(input);
  },
  async findReusableExploratoryContactPathway(researchEntityId) {
    const storedResearchEntityId = toVisibilityRepairObjectId(researchEntityId);
    if (!storedResearchEntityId) return null;
    const pathway = await EntryPathway.findOne({
      researchEntityId: storedResearchEntityId,
      pathwayType: 'EXPLORATORY_CONTACT',
      archived: { $ne: true },
    })
      .sort({ confidence: -1, updatedAt: -1 })
      .lean();
    if (!pathway?._id) return null;
    return {
      pathwayId: idValue(pathway._id),
      derivationKey: textValue((pathway as Record<string, any>).derivationKey),
      doc: pathway,
    };
  },
  async upsertAccessSignal(input) {
    return upsertAccessSignal(input);
  },
  async upsertContactRoute(input) {
    return upsertContactRoute(input);
  },
  async findActionEvidenceObservationIds({ researchEntityId, userId, sourceUrl }) {
    const variants = urlVariants([sourceUrl]).filter(hasHttpUrl);
    const evidenceIds = new Set<string>();
    const userObjectId = toVisibilityRepairObjectId(userId);
    const canonicalSourceUrl = variants[0];
    const fingerprintInput = [userId, canonicalSourceUrl].filter(Boolean).join('|');
    const fingerprint = fingerprintInput ? `visibility-repair:action:${fingerprintInput}` : '';
    const sourceName = 'visibility-repair-queue';

    if (variants.length > 0) {
      const sourceUrlObservations = await Observation.find({
        sourceUrl: { $in: variants },
        sourceId: { $ne: null },
        superseded: { $ne: true },
      })
        .sort({ observedAt: -1 })
        .limit(20)
        .lean();
      for (const id of getActionEvidenceObservationIds(sourceUrlObservations)) evidenceIds.add(id);
    }

    if (userObjectId) {
      const userObservations = await Observation.find({
        entityType: 'user',
        entityId: userObjectId,
        sourceId: { $ne: null },
        superseded: { $ne: true },
      })
        .sort({ observedAt: -1 })
        .limit(20)
        .lean();
      for (const id of getActionEvidenceObservationIds(userObservations)) evidenceIds.add(id);
    }

    if (evidenceIds.size > 0) return Array.from(evidenceIds);
    if (!userObjectId || !canonicalSourceUrl || !fingerprint) return [];

    const source = await Source.findOneAndUpdate(
      { name: visibilityRepairSourceKey },
      {
        $setOnInsert: {
          name: visibilityRepairSourceKey,
          displayName: 'Visibility Repair Queue',
          description: 'Synthetic evidence generated by the visibility repair queue.',
          defaultWeight: 0.22,
        },
      },
      { upsert: true, new: true },
    );
    if (!source) return [];

    const existing = await Observation.findOne({
      entityType: 'user',
      entityId: userObjectId,
      field: 'visibility_repair_action_evidence',
      sourceId: source._id,
      sourceUrl: canonicalSourceUrl,
      observationFingerprint: fingerprint,
      superseded: { $ne: true },
    }).lean();
    if (existing?._id) {
      const existingId = idValue(existing._id);
      if (existingId) return [existingId];
    }

    const created = await Observation.create({
      entityType: 'user',
      entityId: userObjectId,
      field: 'visibility_repair_action_evidence',
      value: {
        sourceUrl: canonicalSourceUrl,
        reason: 'visibility_repair_action_evidence',
        researchEntityId,
      },
      sourceId: source._id,
      sourceName,
      sourceUrl: canonicalSourceUrl,
      confidence: visibilityRepairConfidence,
      observedAt: new Date(),
      observationFingerprint: fingerprint,
    });
    const createdId = idValue((created as Record<string, any>)._id);
    return createdId ? [createdId] : [];
  },
  async findEntityActionEvidenceObservationIds({ researchEntityId, sourceUrl, sourceUrls }) {
    const entityObjectId = toVisibilityRepairObjectId(researchEntityId);
    if (!entityObjectId) return [];

    const variants = urlVariants([sourceUrl, ...(Array.isArray(sourceUrls) ? sourceUrls : [])]).filter(hasHttpUrl);
    const sourceUrlFilter = variants.length > 0 ? { sourceUrl: { $in: variants } } : {};
    const observations = await Observation.find({
      entityType: { $in: ['researchEntity', 'researchGroup'] },
      entityId: entityObjectId,
      field: { $in: ['undergradEvidenceQuote', 'undergradAccessEvidence'] },
      sourceId: { $ne: null },
      superseded: { $ne: true },
      ...sourceUrlFilter,
    })
      .sort({ confidence: -1, observedAt: -1 })
      .limit(5)
      .lean();

    return observations
      .map((observation) => ({
        id: idValue(observation._id),
        excerpt: textValue(observation.value),
        sourceUrl: textValue(observation.sourceUrl),
        sourceName: textValue(observation.sourceName),
      }))
      .filter((observation) => observation.id && hasHttpUrl(observation.sourceUrl));
  },
  async findResearchEntityMembers(id) {
    const safeId = normalizeVisibilityRepairObjectId(id);
    if (!safeId) return [];
    return ResearchGroupMember.find({
      researchEntityId: safeId,
      archived: { $ne: true },
      role: { $in: ['pi', 'principal-investigator', 'principal investigator', 'director', 'lead'] },
    })
      .populate('userId')
      .populate('facultyMemberId')
      .lean()
      .then((rows: any[]) =>
        rows.map((row) => ({
          ...row,
          user: row.userId,
          facultyMember: row.facultyMemberId,
        })),
      );
  },
  async updateResearchEntity(id, patch) {
    const safeId = normalizeVisibilityRepairObjectId(id);
    if (!safeId) return;
    await ResearchEntity.updateOne({ _id: safeId }, { $set: patch });
  },
  async findProgram(id) {
    const safeId = normalizeVisibilityRepairObjectId(id);
    return safeId ? Fellowship.findById(safeId).lean() : null;
  },
  async updateProgram(id, patch) {
    const safeId = normalizeVisibilityRepairObjectId(id);
    if (!safeId) return;
    await Fellowship.updateOne({ _id: safeId }, { $set: patch });
  },
  async runGate(collection, recordIds, mode) {
    return runStudentVisibilityGate({ collection, recordIds, mode });
  },
};

export async function runVisibilityRepairQueue(
  options: VisibilityRepairQueueOptions,
  deps: RepairDeps = defaultRepairDeps,
): Promise<VisibilityRepairQueueReport> {
  const items = await deps.findOpenQueueItems(options);
  const plans = buildVisibilityRepairPlans(items).slice(
    0,
    Math.max(1, Math.min(500, Math.floor(options.limit || 100))),
  );
  const attempts: VisibilityRepairAttempt[] = [];
  const repairedByCollection = new Map<VisibilityReleaseQueueCollection, string[]>();

  for (const plan of plans) {
    const attempt = await attemptVisibilityRepair(plan, options.mode, deps, options.suppressUnsafe);
    attempts.push(attempt);

    if (options.mode === 'apply') {
      await deps.updateQueueItem(plan.queueItemId, {
        repairStage: plan.repairStage,
        repairStatus: attempt.status,
        lastAttemptAt: new Date(),
        repairSource: attempt.repairSource,
        appliedPatchSummary: attempt.patchSummary,
        remainingBlockers: attempt.remainingBlockers,
        nextRepairAction: repairActionForStage(plan.repairStage, attempt.remainingBlockers),
      });
    }

    if (attempt.applied) {
      repairedByCollection.set(plan.collection, [
        ...(repairedByCollection.get(plan.collection) || []),
        plan.recordId,
      ]);
    }
  }

  let resolvedByGate = 0;
  if (options.mode === 'apply') {
    for (const [collection, recordIds] of repairedByCollection.entries()) {
      const gateReport = await deps.runGate(collection, recordIds, 'apply');
      resolvedByGate += gateReport.counts?.resolved || gateReport.counts?.promoted || 0;
    }
  }

  return {
    mode: options.mode,
    scanned: plans.length,
    attempted: attempts.length,
    repaired: attempts.filter((attempt) => attempt.status === 'repaired').length,
    blocked: attempts.filter((attempt) => attempt.status === 'blocked').length,
    resolvedByGate,
    plans,
    attempts,
  };
}
