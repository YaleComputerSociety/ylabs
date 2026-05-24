export interface PersonalHomepageResearchEntity {
  id: string;
  slug: string;
  name: string;
  kind?: string;
  entityType?: string;
  websiteUrl?: string;
  website?: string;
  sourceUrls?: string[];
  shortDescription?: string;
  fullDescription?: string;
  description?: string;
  manuallyLockedFields?: string[];
}

export interface PersonalHomepageObservation {
  id: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  sourceName?: string;
  value?: unknown;
}

export interface PersonalHomepageTextArtifact {
  id: string;
  researchEntityId: string;
  explanation?: string;
  bestNextStep?: string;
  rationale?: string;
  excerpt?: string;
}

export interface PersonalHomepageArtifactTextUpdate {
  artifactType: 'EntryPathway' | 'ContactRoute' | 'AccessSignal';
  id: string;
  set: Record<string, string>;
}

export interface PersonalHomepageResearchEntityRepair {
  researchEntityId: string;
  slug: string;
  oldName: string;
  newName: string;
  websiteUrl: string;
  entitySet: Record<string, string>;
  entityUnset: string[];
  staleObservationIds: string[];
  artifactTextUpdates: PersonalHomepageArtifactTextUpdate[];
}

export interface PersonalHomepageResearchEntityReview {
  researchEntityId: string;
  slug: string;
  reason: 'non-generated-lab-name';
  name: string;
  websiteUrl: string;
}

export interface PersonalHomepageResearchEntitySkipped {
  researchEntityId: string;
  slug: string;
  reason:
    | 'not-currently-lab'
    | 'missing-website-url'
    | 'not-personal-homepage-url'
    | 'manually-locked-classification';
}

export interface PersonalHomepageResearchEntityRepairPlan {
  repairs: PersonalHomepageResearchEntityRepair[];
  reviewNeeded: PersonalHomepageResearchEntityReview[];
  skipped: PersonalHomepageResearchEntitySkipped[];
}

const REPAIRABLE_FIELDS = new Set([
  'name',
  'kind',
  'entityType',
  'shortDescription',
  'fullDescription',
  'description',
]);

function normalizeUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isCurrentlyLab(entity: PersonalHomepageResearchEntity): boolean {
  return entity.kind === 'lab' || entity.entityType === 'LAB';
}

export function hasExplicitLabUrlEvidence(url: string): boolean {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return (
      host.includes('lab') ||
      /\blab(oratory)?\b/i.test(host) ||
      /(?:^|[-.])lab(?:[-.]|$)/i.test(host) ||
      /\/(?:lab|labs|laboratory|research-group|group)(?:\/|$|-)/i.test(path)
    );
  } catch {
    return /\blab(oratory)?\b/i.test(normalized);
  }
}

export function isPersonalHomepageUrl(url: string): boolean {
  const normalized = normalizeUrl(url);
  if (!normalized || hasExplicitLabUrlEvidence(normalized)) return false;
  try {
    const parsed = new URL(normalized);
    return /\/(?:homes?|~[^/]+)(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return /\/(?:homes?|~[^/]+)(?:\/|$)/i.test(normalized);
  }
}

export function transformGeneratedLabName(name: string): string | null {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  const match = trimmed.match(/^(.+?)\s+Lab$/i);
  if (!match?.[1]?.trim()) return null;
  return `${match[1].trim()} — Research`;
}

function baseNameFromGeneratedNames(oldName: string, newName: string): string | null {
  const oldMatch = oldName.replace(/\s+/g, ' ').trim().match(/^(.+?)\s+Lab$/i);
  if (oldMatch?.[1]?.trim()) return oldMatch[1].trim();
  const newMatch = newName.replace(/\s+/g, ' ').trim().match(/^(.+?)\s+—\s+Research$/i);
  return newMatch?.[1]?.trim() || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rewriteGeneratedLabDescription(
  value: unknown,
  oldName: string,
  newName: string,
): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return '';
  const baseName = baseNameFromGeneratedNames(oldName, newName);
  if (!baseName) return text;
  const oldNamePattern = escapeRegExp(oldName.replace(/\s+/g, ' ').trim());
  const baseNamePattern = escapeRegExp(baseName);
  return text
    .replace(new RegExp(`\\bThe\\s+${oldNamePattern}\\b`, 'g'), baseName)
    .replace(new RegExp(`\\b${oldNamePattern}\\b`, 'g'), baseName)
    .replace(new RegExp(`\\bthe\\s+${oldNamePattern}\\b`, 'g'), baseName)
    .replace(/\bThe lab's\b/g, `${baseName}'s`)
    .replace(/\bthe lab's\b/g, `${baseName}'s`)
    .replace(/\bThe lab\b/g, baseName)
    .replace(/\bthe lab\b/g, baseName)
    .replace(/\s+/g, ' ')
    .trim();
}

function currentWebsiteUrl(entity: PersonalHomepageResearchEntity): string {
  return normalizeUrl(entity.websiteUrl) || normalizeUrl(entity.website);
}

function entityHasPersonalHomepageCandidate(entity: PersonalHomepageResearchEntity): boolean {
  const websiteUrl = currentWebsiteUrl(entity);
  if (!websiteUrl || !isPersonalHomepageUrl(websiteUrl)) return false;
  return ![...(entity.sourceUrls || []), websiteUrl].some((url) => hasExplicitLabUrlEvidence(url));
}

function manuallyLockedClassification(entity: PersonalHomepageResearchEntity): boolean {
  const locked = new Set(entity.manuallyLockedFields || []);
  return locked.has('kind') || locked.has('entityType') || locked.has('name');
}

function changedDescriptionSet(
  entity: PersonalHomepageResearchEntity,
  newName: string,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const field of ['shortDescription', 'fullDescription'] as const) {
    const rewritten = rewriteGeneratedLabDescription(entity[field], entity.name, newName);
    if (rewritten && rewritten !== (entity[field] || '').replace(/\s+/g, ' ').trim()) {
      next[field] = rewritten;
    }
  }
  const rewrittenDescription = rewriteGeneratedLabDescription(entity.description, entity.name, newName);
  if (rewrittenDescription && rewrittenDescription !== (entity.description || '').replace(/\s+/g, ' ').trim()) {
    next.description = rewrittenDescription;
  }
  return next;
}

function artifactTextSet(
  artifact: PersonalHomepageTextArtifact,
): Record<string, string> {
  const set: Record<string, string> = {};
  for (const field of ['explanation', 'bestNextStep', 'rationale', 'excerpt'] as const) {
    const value = artifact[field];
    if (typeof value !== 'string' || !value.includes('lab site')) continue;
    set[field] = value.replace(/\blab site\b/g, 'research site');
  }
  return set;
}

function artifactUpdates(
  entityId: string,
  artifacts: {
    pathways: PersonalHomepageTextArtifact[];
    contactRoutes: PersonalHomepageTextArtifact[];
    accessSignals: PersonalHomepageTextArtifact[];
  },
): PersonalHomepageArtifactTextUpdate[] {
  const updates: PersonalHomepageArtifactTextUpdate[] = [];
  const specs: Array<{
    artifactType: PersonalHomepageArtifactTextUpdate['artifactType'];
    rows: PersonalHomepageTextArtifact[];
  }> = [
    { artifactType: 'EntryPathway', rows: artifacts.pathways },
    { artifactType: 'ContactRoute', rows: artifacts.contactRoutes },
    { artifactType: 'AccessSignal', rows: artifacts.accessSignals },
  ];

  for (const spec of specs) {
    for (const row of spec.rows) {
      if (row.researchEntityId !== entityId) continue;
      const set = artifactTextSet(row);
      if (Object.keys(set).length === 0) continue;
      updates.push({ artifactType: spec.artifactType, id: row.id, set });
    }
  }
  return updates;
}

function staleObservationIdsForEntity(args: {
  entity: PersonalHomepageResearchEntity;
  observations: PersonalHomepageObservation[];
  changedFields: Set<string>;
}): string[] {
  return args.observations
    .filter((observation) => {
      if (!REPAIRABLE_FIELDS.has(observation.field) || !args.changedFields.has(observation.field)) {
        return false;
      }
      if (observation.sourceName !== 'dept-faculty-roster') return false;
      return (
        observation.entityId === args.entity.id ||
        (!!observation.entityKey && observation.entityKey === args.entity.slug)
      );
    })
    .map((observation) => observation.id);
}

export function buildPersonalHomepageResearchEntityRepairPlan(args: {
  entities: PersonalHomepageResearchEntity[];
  observations: PersonalHomepageObservation[];
  pathways: PersonalHomepageTextArtifact[];
  contactRoutes: PersonalHomepageTextArtifact[];
  accessSignals: PersonalHomepageTextArtifact[];
}): PersonalHomepageResearchEntityRepairPlan {
  const plan: PersonalHomepageResearchEntityRepairPlan = {
    repairs: [],
    reviewNeeded: [],
    skipped: [],
  };

  for (const entity of args.entities) {
    const websiteUrl = currentWebsiteUrl(entity);
    if (!isCurrentlyLab(entity)) {
      plan.skipped.push({
        researchEntityId: entity.id,
        slug: entity.slug,
        reason: 'not-currently-lab',
      });
      continue;
    }
    if (!websiteUrl) {
      plan.skipped.push({
        researchEntityId: entity.id,
        slug: entity.slug,
        reason: 'missing-website-url',
      });
      continue;
    }
    if (!entityHasPersonalHomepageCandidate(entity)) {
      plan.skipped.push({
        researchEntityId: entity.id,
        slug: entity.slug,
        reason: 'not-personal-homepage-url',
      });
      continue;
    }
    if (manuallyLockedClassification(entity)) {
      plan.skipped.push({
        researchEntityId: entity.id,
        slug: entity.slug,
        reason: 'manually-locked-classification',
      });
      continue;
    }

    const newName = transformGeneratedLabName(entity.name);
    if (!newName) {
      plan.reviewNeeded.push({
        researchEntityId: entity.id,
        slug: entity.slug,
        reason: 'non-generated-lab-name',
        name: entity.name,
        websiteUrl,
      });
      continue;
    }

    const entitySet: Record<string, string> = {
      name: newName,
      kind: 'individual',
      entityType: 'INDIVIDUAL_RESEARCH',
      ...changedDescriptionSet(entity, newName),
    };
    const entityUnset: string[] = [];
    if (entity.description && !entitySet.description) {
      entityUnset.push('description');
    }
    const changedFields = new Set([...Object.keys(entitySet), ...entityUnset]);

    plan.repairs.push({
      researchEntityId: entity.id,
      slug: entity.slug,
      oldName: entity.name,
      newName,
      websiteUrl,
      entitySet,
      entityUnset,
      staleObservationIds: staleObservationIdsForEntity({
        entity,
        observations: args.observations,
        changedFields,
      }),
      artifactTextUpdates: artifactUpdates(entity.id, {
        pathways: args.pathways,
        contactRoutes: args.contactRoutes,
        accessSignals: args.accessSignals,
      }),
    });
  }

  return plan;
}
