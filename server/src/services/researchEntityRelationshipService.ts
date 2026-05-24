import { ResearchEntity } from '../models/researchEntity';
import {
  ResearchEntityRelationship,
  type ResearchEntityRelationshipType,
} from '../models/researchEntityRelationship';
import { toPublicResearchEntityDto, type PublicResearchEntityDto } from './researchEntityDto';

const RELATIONSHIP_LABELS: Record<ResearchEntityRelationshipType, string> = {
  AFFILIATED_LAB: 'Affiliated lab',
  AFFILIATED_RESEARCH_GROUP: 'Related research group',
  MEMBER_RESEARCH_AREA: 'Faculty research area',
  HOSTED_PROGRAM: 'Hosted program',
};

export interface PublicResearchEntityRelationshipDto {
  _id: string;
  sourceResearchEntityId: string;
  targetResearchEntityId: string;
  relationshipType: ResearchEntityRelationshipType;
  label: string;
  evidenceStrength?: string;
  sourceUrl?: string;
  evidenceQuote?: string;
  confidence?: number;
}

export interface RelatedResearchEntitiesPayload {
  relationships: PublicResearchEntityRelationshipDto[];
  relatedResearchEntities: PublicResearchEntityDto[];
}

interface RelationshipServiceDeps {
  relationshipModel?: Pick<typeof ResearchEntityRelationship, 'find'>;
  researchEntityModel?: Pick<typeof ResearchEntity, 'find'>;
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

export function relationshipLabel(type: string): string {
  return RELATIONSHIP_LABELS[type as ResearchEntityRelationshipType] || 'Related research home';
}

function toPublicRelationshipDto(row: any): PublicResearchEntityRelationshipDto {
  const relationshipType = row.relationshipType as ResearchEntityRelationshipType;
  return {
    _id: stringId(row._id),
    sourceResearchEntityId: stringId(row.sourceResearchEntityId),
    targetResearchEntityId: stringId(row.targetResearchEntityId),
    relationshipType,
    label: relationshipLabel(relationshipType),
    evidenceStrength: row.evidenceStrength,
    sourceUrl: row.sourceUrl,
    evidenceQuote: row.evidenceQuote,
    confidence: row.confidence,
  };
}

export async function listRelatedResearchEntitiesForDetail(
  sourceResearchEntityId: string,
  deps: RelationshipServiceDeps = {},
): Promise<RelatedResearchEntitiesPayload> {
  const relationshipModel = deps.relationshipModel || ResearchEntityRelationship;
  const researchEntityModel = deps.researchEntityModel || ResearchEntity;

  const relationshipsRaw: any[] = await relationshipModel
    .find({
      sourceResearchEntityId,
      archived: { $ne: true },
    })
    .sort({ relationshipType: 1, confidence: -1, updatedAt: -1 })
    .lean();

  const targetIds = [
    ...new Set(
      relationshipsRaw
        .map((relationship) => stringId(relationship.targetResearchEntityId))
        .filter(Boolean),
    ),
  ];

  const targets: any[] = targetIds.length
    ? await researchEntityModel
        .find({
          _id: { $in: targetIds },
          archived: { $ne: true },
        })
        .sort({ name: 1 })
        .lean()
    : [];

  const targetById = new Map(targets.map((target) => [stringId(target._id), target]));
  const relatedResearchEntities = targetIds
    .map((id) => targetById.get(id))
    .filter(Boolean)
    .map((target) => toPublicResearchEntityDto(target));

  return {
    relationships: relationshipsRaw.map(toPublicRelationshipDto),
    relatedResearchEntities,
  };
}

export async function listAffiliatedResearchEntitiesForDetail(
  targetResearchEntityId: string,
  deps: RelationshipServiceDeps = {},
): Promise<RelatedResearchEntitiesPayload> {
  const relationshipModel = deps.relationshipModel || ResearchEntityRelationship;
  const researchEntityModel = deps.researchEntityModel || ResearchEntity;

  const relationshipsRaw: any[] = await relationshipModel
    .find({
      targetResearchEntityId,
      archived: { $ne: true },
    })
    .sort({ relationshipType: 1, confidence: -1, updatedAt: -1 })
    .lean();

  const sourceIds = [
    ...new Set(
      relationshipsRaw
        .map((relationship) => stringId(relationship.sourceResearchEntityId))
        .filter(Boolean),
    ),
  ];

  const sources: any[] = sourceIds.length
    ? await researchEntityModel
        .find({
          _id: { $in: sourceIds },
          archived: { $ne: true },
        })
        .sort({ name: 1 })
        .lean()
    : [];

  const sourceById = new Map(sources.map((source) => [stringId(source._id), source]));
  const relatedResearchEntities = sourceIds
    .map((id) => sourceById.get(id))
    .filter(Boolean)
    .map((source) => toPublicResearchEntityDto(source));

  return {
    relationships: relationshipsRaw.map(toPublicRelationshipDto),
    relatedResearchEntities,
  };
}
