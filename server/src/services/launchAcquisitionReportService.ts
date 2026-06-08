import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import {
  VisibilityReleaseQueueItem,
  type VisibilityRepairStage,
} from '../models/visibilityReleaseQueueItem';

type LaunchAcquisitionStage = Extract<
  VisibilityRepairStage,
  'pi_identity' | 'action_evidence' | 'source_description'
>;

export interface LaunchAcquisitionReportOptions {
  stages?: LaunchAcquisitionStage[];
  limit?: number;
  sampleLimit?: number;
}

export interface LaunchAcquisitionReportQueueItem {
  _id?: unknown;
  collection: 'research' | 'programs';
  recordId: string;
  label?: string;
  repairStage: VisibilityRepairStage;
  blockerReasons?: string[];
  sourceNames?: string[];
}

interface AccessRecordCounts {
  accessSignals: number;
  entryPathways: number;
  contactRoutes: number;
}

interface LaunchAcquisitionReportDeps {
  findQueueItems: (options: { stages: LaunchAcquisitionStage[] }) => Promise<LaunchAcquisitionReportQueueItem[]>;
  findResearchEntity: (id: string) => Promise<Record<string, any> | null>;
  findResearchEntityMembers: (id: string) => Promise<Array<Record<string, any>>>;
  countSourceObservations: (entity: Record<string, any>) => Promise<number>;
  findUsersByUrls: (urls: string[]) => Promise<Array<Record<string, any>>>;
  countUndergraduateAccessObservations: (entity: Record<string, any>) => Promise<number>;
  countAccessRecords: (id: string) => Promise<AccessRecordCounts>;
}

interface LaunchAcquisitionSample {
  recordId: string;
  label: string;
  sourceNames: string[];
  blockerReasons: string[];
}

interface LaunchAcquisitionGroup {
  count: number;
  samples: LaunchAcquisitionSample[];
}

interface PiIdentityGroups {
  missingOfficialProfileUrl: LaunchAcquisitionGroup;
  sourceObservationsPresent: LaunchAcquisitionGroup;
  currentMembersPresent: LaunchAcquisitionGroup;
  leadNotRequiredByEntityType: LaunchAcquisitionGroup;
  exactSingleUserMatch: LaunchAcquisitionGroup;
  ambiguousOrMismatchedUserMatch: LaunchAcquisitionGroup;
}

interface ActionEvidenceGroups {
  noSourceObservations: LaunchAcquisitionGroup;
  sourceObservationsWithoutUndergradAccess: LaunchAcquisitionGroup;
  untrustedExternalRouteEvidence: LaunchAcquisitionGroup;
  sourceBackedRouteNotLaunchMaterialized: LaunchAcquisitionGroup;
}

interface SourceDescriptionGroups {
  missingSourceUrl: LaunchAcquisitionGroup;
  rejectedSourceHost: LaunchAcquisitionGroup;
  yaleProfileThinText: LaunchAcquisitionGroup;
  profileFallbackOnly: LaunchAcquisitionGroup;
  cardDescriptionDerivable: LaunchAcquisitionGroup;
  candidateOfficialUrlPresent: LaunchAcquisitionGroup;
}

export interface LaunchAcquisitionReport {
  mode: 'read-only';
  generatedAt: string;
  stages: LaunchAcquisitionStage[];
  scanned: number;
  bySource: Record<string, { piIdentity: number; actionEvidence: number; sourceDescription: number }>;
  piIdentity?: {
    total: number;
    groups: PiIdentityGroups;
  };
  actionEvidence?: {
    total: number;
    groups: ActionEvidenceGroups;
  };
  sourceDescription?: {
    total: number;
    groups: SourceDescriptionGroups;
  };
}

const defaultStages: LaunchAcquisitionStage[] = ['pi_identity', 'action_evidence'];
const yaleHostPattern = /(^|\.)yale\.edu$/i;
const undergradAccessPattern =
  /\b(undergrad|undergraduate|student|students|research assistant|ra\b|internship|apply|application|contact|mentor|summer|work-study|volunteer|opportunit)/i;

const newGroup = (): LaunchAcquisitionGroup => ({ count: 0, samples: [] });

const sampleFor = (
  item: LaunchAcquisitionReportQueueItem,
  fallbackLabel: string,
): LaunchAcquisitionSample => ({
  recordId: item.recordId,
  label: item.label || fallbackLabel || item.recordId,
  sourceNames: cleanStrings(item.sourceNames),
  blockerReasons: cleanStrings(item.blockerReasons),
});

const addGroup = (
  group: LaunchAcquisitionGroup,
  item: LaunchAcquisitionReportQueueItem,
  fallbackLabel: string,
  sampleLimit: number,
): void => {
  group.count += 1;
  if (group.samples.length < sampleLimit) group.samples.push(sampleFor(item, fallbackLabel));
};

const cleanStrings = (values: unknown): string[] =>
  Array.isArray(values)
    ? Array.from(
        new Set(
          values
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      )
    : [];

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const idValue = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof (value as any).toHexString === 'function') return (value as any).toHexString();
  if (typeof value === 'object' && '_id' in value) return idValue((value as Record<string, unknown>)._id);
  return String(value).trim();
};

const hasHttpUrl = (value: unknown): boolean => /^https?:\/\//i.test(textValue(value));

const urlVariants = (urls: unknown[]): string[] => {
  const variants = new Set<string>();
  for (const raw of urls) {
    const value = textValue(raw);
    if (!hasHttpUrl(value)) continue;
    variants.add(value);
    variants.add(value.endsWith('/') ? value.replace(/\/+$/, '') : `${value}/`);
    const medicineProfile = value.replace(
      /^https:\/\/medicine\.yale\.edu\/[^/]+\/profile\//i,
      'https://medicine.yale.edu/profile/',
    );
    if (medicineProfile !== value) {
      variants.add(medicineProfile);
      variants.add(
        medicineProfile.endsWith('/') ? medicineProfile.replace(/\/+$/, '') : `${medicineProfile}/`,
      );
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

const candidateIdentityUrlsForEntity = (entity: Record<string, any>): string[] =>
  urlVariants([
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ]).filter(hasHttpUrl);

const nameTokens = (value: unknown): string[] =>
  textValue(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((token) => token.length > 1 && !['lab', 'research', 'faculty', 'area'].includes(token));

const userDisplayName = (user: Record<string, any>): string =>
  textValue(user.displayName) ||
  textValue(`${textValue(user.fname || user.firstName)} ${textValue(user.lname || user.lastName)}`);

const userNameMatchesEntity = (user: Record<string, any>, entity: Record<string, any>): boolean => {
  const userTokens = nameTokens(userDisplayName(user));
  if (userTokens.length < 2) return false;
  const entityTokens = new Set(nameTokens([entity.name, entity.displayName, entity.slug].join(' ')));
  return entityTokens.has(userTokens[0]) && entityTokens.has(userTokens[userTokens.length - 1]);
};

const leadRequiredForEntity = (entity: Record<string, any>): boolean => {
  const type = textValue(entity.type || entity.entityType || entity.category).toLowerCase();
  const label = textValue(`${entity.name || ''} ${entity.displayName || ''}`).toLowerCase();
  if (/(collection|archive|library|museum|course|resource|database|funding|fellowship)/.test(type)) {
    return false;
  }
  if (/\b(collection|archive|archives|library|museum)\b/.test(label)) return false;
  return true;
};

const isYaleUrl = (value: unknown): boolean => {
  try {
    const url = new URL(textValue(value));
    return yaleHostPattern.test(url.hostname);
  } catch {
    return false;
  }
};

const hasUntrustedExternalRouteEvidence = (entity: Record<string, any>): boolean => {
  const urls = cleanStrings([entity.websiteUrl, entity.website, ...(entity.sourceUrls || [])]);
  return urls.length > 0 && urls.some((url) => hasHttpUrl(url) && !isYaleUrl(url));
};

const rejectedDescriptionSourcePatterns = [
  /\/membership\/directory\/?$/i,
  /\/(?:people|faculty|directory|members)\/?$/i,
  /(?:^|\.)orcid\.org$/i,
  /(?:^|\.)doi\.org$/i,
  /(?:^|\.)openalex\.org$/i,
  /(?:^|\.)crossref\.org$/i,
  /reporter\.nih\.gov/i,
  /nsf\.gov/i,
  /api\.nsf\.gov/i,
];

const isRejectedDescriptionSourceUrl = (value: unknown): boolean => {
  const urlText = textValue(value);
  if (!hasHttpUrl(urlText)) return false;
  try {
    const url = new URL(urlText);
    const hostPath = `${url.hostname}${url.pathname}`.replace(/\/+$/, '');
    return rejectedDescriptionSourcePatterns.some((pattern) => pattern.test(hostPath));
  } catch {
    return false;
  }
};

const sourceUrlsForEntity = (entity: Record<string, any>): string[] =>
  cleanStrings([
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ]).filter(hasHttpUrl);

const isYaleProfileUrl = (value: unknown): boolean =>
  /\/\/[^/]*yale\.edu\/(?:.*\/)?profile\//i.test(textValue(value));

const isOfficialCandidateUrl = (value: unknown): boolean =>
  hasHttpUrl(value) && !isRejectedDescriptionSourceUrl(value) && isYaleUrl(value);

const usefulDescriptionText = (value: unknown): boolean => textValue(value).length >= 80;

const incrementSource = (
  bySource: LaunchAcquisitionReport['bySource'],
  item: LaunchAcquisitionReportQueueItem,
  stage: LaunchAcquisitionStage,
): void => {
  const sourceNames = cleanStrings(item.sourceNames);
  for (const sourceName of sourceNames.length ? sourceNames : ['unattributed']) {
    bySource[sourceName] = bySource[sourceName] || {
      piIdentity: 0,
      actionEvidence: 0,
      sourceDescription: 0,
    };
    if (stage === 'pi_identity') bySource[sourceName].piIdentity += 1;
    else if (stage === 'action_evidence') bySource[sourceName].actionEvidence += 1;
    else bySource[sourceName].sourceDescription += 1;
  }
};

const buildPiGroups = (): PiIdentityGroups => ({
  missingOfficialProfileUrl: newGroup(),
  sourceObservationsPresent: newGroup(),
  currentMembersPresent: newGroup(),
  leadNotRequiredByEntityType: newGroup(),
  exactSingleUserMatch: newGroup(),
  ambiguousOrMismatchedUserMatch: newGroup(),
});

const buildActionGroups = (): ActionEvidenceGroups => ({
  noSourceObservations: newGroup(),
  sourceObservationsWithoutUndergradAccess: newGroup(),
  untrustedExternalRouteEvidence: newGroup(),
  sourceBackedRouteNotLaunchMaterialized: newGroup(),
});

const buildSourceDescriptionGroups = (): SourceDescriptionGroups => ({
  missingSourceUrl: newGroup(),
  rejectedSourceHost: newGroup(),
  yaleProfileThinText: newGroup(),
  profileFallbackOnly: newGroup(),
  cardDescriptionDerivable: newGroup(),
  candidateOfficialUrlPresent: newGroup(),
});

async function classifyPiItem(
  item: LaunchAcquisitionReportQueueItem,
  entity: Record<string, any>,
  deps: LaunchAcquisitionReportDeps,
  groups: PiIdentityGroups,
  sampleLimit: number,
): Promise<void> {
  const label = textValue(entity.displayName || entity.name || item.label);
  const officialProfileUrls = officialProfileUrlsForEntity(entity);
  if (officialProfileUrls.length === 0) {
    addGroup(groups.missingOfficialProfileUrl, item, label, sampleLimit);
  }

  const [observationCount, members, users] = await Promise.all([
    deps.countSourceObservations(entity),
    deps.findResearchEntityMembers(item.recordId),
    deps.findUsersByUrls(candidateIdentityUrlsForEntity(entity)),
  ]);

  if (observationCount > 0) addGroup(groups.sourceObservationsPresent, item, label, sampleLimit);
  if (members.length > 0) addGroup(groups.currentMembersPresent, item, label, sampleLimit);
  if (!leadRequiredForEntity(entity)) addGroup(groups.leadNotRequiredByEntityType, item, label, sampleLimit);

  const matchingUsers = users.filter((user) => userNameMatchesEntity(user, entity));
  if (matchingUsers.length === 1 && users.length === 1) {
    addGroup(groups.exactSingleUserMatch, item, label, sampleLimit);
  } else if (users.length > 0) {
    addGroup(groups.ambiguousOrMismatchedUserMatch, item, label, sampleLimit);
  }
}

async function classifyActionItem(
  item: LaunchAcquisitionReportQueueItem,
  entity: Record<string, any>,
  deps: LaunchAcquisitionReportDeps,
  groups: ActionEvidenceGroups,
  sampleLimit: number,
): Promise<void> {
  const label = textValue(entity.displayName || entity.name || item.label);
  const [sourceObservationCount, undergraduateObservationCount, accessCounts] = await Promise.all([
    deps.countSourceObservations(entity),
    deps.countUndergraduateAccessObservations(entity),
    deps.countAccessRecords(item.recordId),
  ]);

  if (sourceObservationCount === 0) {
    addGroup(groups.noSourceObservations, item, label, sampleLimit);
    return;
  }

  if (undergraduateObservationCount === 0 && accessCounts.accessSignals === 0) {
    addGroup(groups.sourceObservationsWithoutUndergradAccess, item, label, sampleLimit);
  }
  if (hasUntrustedExternalRouteEvidence(entity)) {
    addGroup(groups.untrustedExternalRouteEvidence, item, label, sampleLimit);
  }
  if (accessCounts.accessSignals + accessCounts.entryPathways + accessCounts.contactRoutes > 0) {
    addGroup(groups.sourceBackedRouteNotLaunchMaterialized, item, label, sampleLimit);
  }
}

async function classifySourceDescriptionItem(
  item: LaunchAcquisitionReportQueueItem,
  entity: Record<string, any>,
  groups: SourceDescriptionGroups,
  sampleLimit: number,
): Promise<void> {
  const label = textValue(entity.displayName || entity.name || item.label);
  const urls = sourceUrlsForEntity(entity);
  const reasons = cleanStrings(item.blockerReasons);

  if (urls.length === 0 || reasons.includes('missing_source_url')) {
    addGroup(groups.missingSourceUrl, item, label, sampleLimit);
  }
  if (urls.some(isRejectedDescriptionSourceUrl)) {
    addGroup(groups.rejectedSourceHost, item, label, sampleLimit);
  }
  if (
    urls.some(isYaleProfileUrl) &&
    reasons.includes('thin_description') &&
    !usefulDescriptionText(entity.fullDescription || entity.description)
  ) {
    addGroup(groups.yaleProfileThinText, item, label, sampleLimit);
  }
  if (reasons.includes('profile_fallback_only')) {
    addGroup(groups.profileFallbackOnly, item, label, sampleLimit);
  }
  if (
    reasons.includes('missing_card_description') &&
    usefulDescriptionText(entity.fullDescription || entity.description)
  ) {
    addGroup(groups.cardDescriptionDerivable, item, label, sampleLimit);
  }
  if (urls.some(isOfficialCandidateUrl)) {
    addGroup(groups.candidateOfficialUrlPresent, item, label, sampleLimit);
  }
}

const defaultDeps: LaunchAcquisitionReportDeps = {
  async findQueueItems(options) {
    return VisibilityReleaseQueueItem.find({
      status: 'open',
      collection: 'research',
      repairStage: { $in: options.stages },
      repairStatus: { $in: ['queued', 'blocked', 'attempted'] },
    })
      .sort({ repairStage: 1, lastSeenAt: -1, _id: 1 })
      .lean() as unknown as LaunchAcquisitionReportQueueItem[];
  },
  async findResearchEntity(id) {
    return ResearchEntity.findById(id)
      .select('name displayName slug type category entityType website websiteUrl sourceUrls description fullDescription shortDescription')
      .lean();
  },
  async findResearchEntityMembers(id) {
    return ResearchGroupMember.find({
      researchEntityId: id,
      isCurrentMember: { $ne: false },
      archived: { $ne: true },
    })
      .select('researchEntityId userId facultyMemberId name role sourceUrl')
      .lean();
  },
  async countSourceObservations(entity) {
    const id = idValue(entity._id);
    const clauses: Record<string, unknown>[] = [];
    if (id) clauses.push({ entityId: id });
    if (entity.slug) clauses.push({ entityKey: entity.slug });
    if (clauses.length === 0) return 0;
    return Observation.countDocuments({
      entityType: { $in: ['researchEntity', 'researchGroup'] },
      superseded: false,
      $or: clauses,
    });
  },
  async findUsersByUrls(urls) {
    const variants = urlVariants(urls);
    if (variants.length === 0) return [];
    return User.aggregate([
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
      { $limit: 3 },
      {
        $project: {
          fname: 1,
          lname: 1,
          firstName: 1,
          lastName: 1,
          displayName: 1,
        },
      },
    ]);
  },
  async countUndergraduateAccessObservations(entity) {
    const id = idValue(entity._id);
    const clauses: Record<string, unknown>[] = [];
    if (id) clauses.push({ entityId: id });
    if (entity.slug) clauses.push({ entityKey: entity.slug });
    if (clauses.length === 0) return 0;
    return Observation.countDocuments({
      entityType: { $in: ['researchEntity', 'researchGroup'] },
      superseded: false,
      $and: [
        { $or: clauses },
        {
          $or: [
            { field: undergradAccessPattern },
            { value: undergradAccessPattern },
            { sourceUrl: undergradAccessPattern },
          ],
        },
      ],
    });
  },
  async countAccessRecords(id) {
    const [accessSignals, entryPathways, contactRoutes] = await Promise.all([
      AccessSignal.countDocuments({ researchEntityId: id, archived: { $ne: true } }),
      EntryPathway.countDocuments({ researchEntityId: id, archived: { $ne: true } }),
      ContactRoute.countDocuments({ researchEntityId: id, archived: { $ne: true } }),
    ]);
    return { accessSignals, entryPathways, contactRoutes };
  },
};

function normalizeReportLimit(limit: number | undefined): number {
  if (limit === undefined) return 500;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('--limit must be a safe positive integer');
  }
  return limit;
}

function normalizeReportSampleLimit(sampleLimit: number | undefined): number {
  if (sampleLimit === undefined) return 10;
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1) {
    throw new Error('--sample-limit must be a safe positive integer');
  }
  return Math.min(50, sampleLimit);
}

export async function buildLaunchAcquisitionReport(
  options: LaunchAcquisitionReportOptions = {},
  deps: LaunchAcquisitionReportDeps = defaultDeps,
): Promise<LaunchAcquisitionReport> {
  const stages = options.stages?.length ? options.stages : defaultStages;
  const sampleLimit = normalizeReportSampleLimit(options.sampleLimit);
  const limit = normalizeReportLimit(options.limit);
  const items = (await deps.findQueueItems({ stages })).slice(0, limit);
  const bySource: LaunchAcquisitionReport['bySource'] = {};
  const piGroups = stages.includes('pi_identity') ? buildPiGroups() : undefined;
  const actionGroups = stages.includes('action_evidence') ? buildActionGroups() : undefined;
  const sourceDescriptionGroups = stages.includes('source_description')
    ? buildSourceDescriptionGroups()
    : undefined;
  let piTotal = 0;
  let actionTotal = 0;
  let sourceDescriptionTotal = 0;

  for (const item of items) {
    if (item.collection !== 'research') continue;
    if (
      item.repairStage !== 'pi_identity' &&
      item.repairStage !== 'action_evidence' &&
      item.repairStage !== 'source_description'
    ) continue;
    const entity = await deps.findResearchEntity(item.recordId);
    if (!entity) continue;

    incrementSource(bySource, item, item.repairStage);
    if (item.repairStage === 'pi_identity' && piGroups) {
      piTotal += 1;
      await classifyPiItem(item, entity, deps, piGroups, sampleLimit);
    }
    if (item.repairStage === 'action_evidence' && actionGroups) {
      actionTotal += 1;
      await classifyActionItem(item, entity, deps, actionGroups, sampleLimit);
    }
    if (item.repairStage === 'source_description' && sourceDescriptionGroups) {
      sourceDescriptionTotal += 1;
      await classifySourceDescriptionItem(item, entity, sourceDescriptionGroups, sampleLimit);
    }
  }

  return {
    mode: 'read-only',
    generatedAt: new Date().toISOString(),
    stages,
    scanned: items.length,
    bySource,
    ...(piGroups ? { piIdentity: { total: piTotal, groups: piGroups } } : {}),
    ...(actionGroups ? { actionEvidence: { total: actionTotal, groups: actionGroups } } : {}),
    ...(sourceDescriptionGroups
      ? { sourceDescription: { total: sourceDescriptionTotal, groups: sourceDescriptionGroups } }
      : {}),
  };
}
