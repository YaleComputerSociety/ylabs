import mongoose from 'mongoose';
import { ContactRoute } from '../models/contactRoute';
import { findReviewLockedRecord, omitReviewLockedFields } from './reviewLockUtils';
import { syncPathwaySearchIndexDocument, syncPathwaySearchIndexDocumentsForEntity } from './pathwaySearchIndexService';
import type {
  ContactPolicy,
  ContactRouteType,
  ContactRouteVisibility,
} from '../models/researchAccessTypes';

export type {
  ContactPolicy,
  ContactRouteType,
  ContactRouteVisibility,
} from '../models/researchAccessTypes';

export interface UpsertContactRouteInput {
  researchEntityId: string;
  routeType: ContactRouteType;
  priority: number;
  visibility: ContactRouteVisibility;
  contactPolicy: ContactPolicy;
  entryPathwayId?: string;
  name?: string;
  email?: string;
  role?: string;
  url?: string;
  rationale?: string;
  sourceEvidenceIds: string[];
  sourceEvidenceId?: string;
  observedAt?: Date;
  sourceName?: string;
  sourceUrl?: string;
  derivationKey?: string;
}

export interface ContactRouteServiceDeps {
  model?: mongoose.Model<any>;
}

export interface ContactRouteUpsertResult {
  contactRouteId?: string;
  doc?: any;
}

function getContactRouteModel(deps: ContactRouteServiceDeps = {}): mongoose.Model<any> {
  return deps.model || ContactRoute;
}

function toStoredId(value: string): unknown {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function toStoredObjectId(value?: string): mongoose.Types.ObjectId | undefined {
  return value && mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Partial<T>;
}

function normalizeEmail(email?: string): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || undefined;
}

export async function upsertContactRoute(
  input: UpsertContactRouteInput,
  deps: ContactRouteServiceDeps = {},
): Promise<ContactRouteUpsertResult> {
  const ContactRoute = getContactRouteModel(deps);
  const researchEntityId = toStoredId(input.researchEntityId);
  const entryPathwayId = input.entryPathwayId ? toStoredId(input.entryPathwayId) : undefined;
  const sourceEvidenceIds = input.sourceEvidenceIds
    .filter(Boolean)
    .map(toStoredObjectId)
    .filter((id): id is mongoose.Types.ObjectId => !!id);
  const sourceEvidenceId =
    toStoredObjectId(input.sourceEvidenceId) || sourceEvidenceIds[0];
  const email = normalizeEmail(input.email);

  const derivationKey =
    input.derivationKey ||
    `access-materializer:${input.routeType}:${email || input.url || input.name || input.role || 'unknown'}`;

  const filter = compactObject({ researchEntityId, derivationKey });
  const existing = await findReviewLockedRecord(ContactRoute, filter);

  const update = {
    $setOnInsert: compactObject({
      researchEntityId,
      routeType: input.routeType,
      derivationKey,
    }),
    $set: omitReviewLockedFields(compactObject({
      entryPathwayId,
      sourceEvidenceId,
      name: input.name?.trim(),
      personName: input.name?.trim(),
      label: input.name?.trim() || input.role?.trim(),
      email,
      role: input.role?.trim(),
      url: input.url?.trim(),
      priority: input.priority,
      visibility: input.visibility,
      contactPolicy: input.contactPolicy,
      rationale: input.rationale,
      observedAt: input.observedAt,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl,
      lastMaterializedAt: new Date(),
    }), existing),
    $addToSet: {
      sourceEvidenceIds: { $each: sourceEvidenceIds },
    },
  };

  const query = ContactRoute.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
  const doc = typeof (query as any).lean === 'function' ? await (query as any).lean() : await query;
  if (!deps.model && process.env.PATHWAY_SEARCH_SYNC === 'true') {
    const sync = doc?.entryPathwayId
      ? syncPathwaySearchIndexDocument(String(doc.entryPathwayId))
      : syncPathwaySearchIndexDocumentsForEntity(String(doc?.researchEntityId || ''));
    await sync.catch((error) => {
      console.error('Failed to sync pathway search index:', error);
    });
  }

  return {
    contactRouteId: doc?._id ? String(doc._id) : undefined,
    doc,
  };
}
