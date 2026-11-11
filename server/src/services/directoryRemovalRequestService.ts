import mongoose from 'mongoose';
import {
  DirectoryRemovalRequest,
  directoryRemovalRequestDecisions,
  directoryRemovalRequestStatuses,
  type DirectoryRemovalRequestDecision,
  type DirectoryRemovalRequestStatus,
} from '../models/directoryRemovalRequest';
import { DirectoryRemoval } from '../models/directoryRemoval';
import { Researcher } from '../models/researcher';
import { readDirectoryRemovalKey } from '../utils/directoryRemovalDigest';
import { personDirectoryRemovalDigests } from './directoryRemovalMatcher';
import { researchersByNetid } from './researcherNetidLookup';
import {
  BadRequestError,
  ConflictError,
  IncorrectPermissionsError,
  NotFoundError,
} from '../utils/errors';

const ADMIN_LIST_LIMIT = 200;
const DUPLICATE_KEY_CODE = 11000;
const OPEN_STATUSES: readonly DirectoryRemovalRequestStatus[] = ['pending', 'accepted'];

export interface OwnDirectoryRemovalRequest {
  status: DirectoryRemovalRequestStatus;
  createdAt: string;
}

export interface DirectoryRemovalEligibility {
  eligible: boolean;
  request: OwnDirectoryRemovalRequest | null;
}

export interface AdminDirectoryRemovalRequest {
  _id: string;
  requesterNetid: string;
  researcherId: string;
  researcherDisplayName: string;
  status: DirectoryRemovalRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

const normalizedNetid = (netid: string): string => netid.trim().toLowerCase();

const toIsoString = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

const toOwnRequest = (row: any): OwnDirectoryRemovalRequest => ({
  status: row.status,
  createdAt: toIsoString(row.createdAt),
});

export function assertNoRequestFields(body: unknown): void {
  if (body === undefined || body === null) return;
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
    throw new BadRequestError('A removal request takes no fields.');
  }
}

async function listedResearcherId(netid: string): Promise<mongoose.Types.ObjectId | null> {
  const match = (await researchersByNetid([netid])).get(netid);
  return match?._id ?? null;
}

async function latestRequestFor(netid: string) {
  return DirectoryRemovalRequest.findOne({ requesterNetid: netid })
    .sort({ createdAt: -1, _id: -1 })
    .lean();
}

async function removalWithdrawnSince(
  researcherId: mongoose.Types.ObjectId,
  decidedAt: Date | null | undefined,
): Promise<boolean> {
  const key = readDirectoryRemovalKey();
  if (!key || !decidedAt) return false;
  const researcher = await Researcher.findById(researcherId)
    .select('displayName identifiers profileLinks')
    .lean();
  if (!researcher) return false;
  const entries = await DirectoryRemoval.find({
    digest: { $in: personDirectoryRemovalDigests(key, researcher as any) },
  })
    .select('withdrawnAt -_id')
    .lean<Array<{ withdrawnAt?: Date }>>();
  return (
    entries.every((entry) => entry.withdrawnAt) &&
    entries.some((entry) => entry.withdrawnAt! > decidedAt)
  );
}

async function currentRequestFor(netid: string, researcherId: mongoose.Types.ObjectId) {
  const latest = await latestRequestFor(netid);
  if (
    latest?.status === 'accepted' &&
    (await removalWithdrawnSince(researcherId, latest.decidedAt))
  ) {
    return null;
  }
  return latest;
}

export async function getOwnDirectoryRemovalEligibility(
  sessionNetid: string,
): Promise<DirectoryRemovalEligibility> {
  const netid = normalizedNetid(sessionNetid);
  const researcherId = await listedResearcherId(netid);
  if (!researcherId) return { eligible: false, request: null };
  const current = await currentRequestFor(netid, researcherId);
  return { eligible: true, request: current ? toOwnRequest(current) : null };
}

export async function createOwnDirectoryRemovalRequest(
  sessionNetid: string,
): Promise<{ created: boolean; request: OwnDirectoryRemovalRequest }> {
  const netid = normalizedNetid(sessionNetid);
  const researcherId = await listedResearcherId(netid);
  if (!researcherId) {
    throw new IncorrectPermissionsError('Only a person y/labs lists can ask to be removed.');
  }

  const current = await currentRequestFor(netid, researcherId);
  if (current && OPEN_STATUSES.includes(current.status as DirectoryRemovalRequestStatus)) {
    return { created: false, request: toOwnRequest(current) };
  }

  try {
    const created = await DirectoryRemovalRequest.create({
      requesterNetid: netid,
      researcherId,
      status: 'pending',
    });
    return { created: true, request: toOwnRequest(created.toObject()) };
  } catch (error) {
    if ((error as { code?: unknown })?.code !== DUPLICATE_KEY_CODE) throw error;
    const pending = await DirectoryRemovalRequest.findOne({
      requesterNetid: netid,
      status: 'pending',
    }).lean();
    if (!pending) throw error;
    return { created: false, request: toOwnRequest(pending) };
  }
}

const parseStatusFilter = (value: unknown): DirectoryRemovalRequestStatus | undefined => {
  if (value === undefined || value === '') return undefined;
  if (
    typeof value === 'string' &&
    (directoryRemovalRequestStatuses as readonly string[]).includes(value)
  ) {
    return value as DirectoryRemovalRequestStatus;
  }
  throw new BadRequestError('status must be pending, accepted or declined.');
};

export async function listDirectoryRemovalRequests(params: {
  status?: unknown;
}): Promise<{ requests: AdminDirectoryRemovalRequest[]; total: number }> {
  const status = parseStatusFilter(params.status);
  const filter = status ? { status } : {};
  const [rows, total] = await Promise.all([
    DirectoryRemovalRequest.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(ADMIN_LIST_LIMIT)
      .lean(),
    DirectoryRemovalRequest.countDocuments(filter),
  ]);

  const researchers = await Researcher.find({
    _id: { $in: rows.map((row: any) => row.researcherId) },
  })
    .select('_id displayName')
    .lean();
  const displayNameById = new Map(
    researchers.map((researcher: any) => [String(researcher._id), researcher.displayName ?? '']),
  );

  return {
    total,
    requests: rows.map((row: any) => ({
      _id: String(row._id),
      requesterNetid: row.requesterNetid,
      researcherId: String(row.researcherId),
      researcherDisplayName: displayNameById.get(String(row.researcherId)) ?? '',
      status: row.status,
      createdAt: toIsoString(row.createdAt),
      decidedAt: row.decidedAt ? toIsoString(row.decidedAt) : null,
      decidedBy: row.decidedBy ?? null,
    })),
  };
}

const parseDecision = (body: unknown): DirectoryRemovalRequestDecision => {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const keys = Object.keys(source);
  const status = (source as { status?: unknown }).status;
  if (
    keys.length !== 1 ||
    keys[0] !== 'status' ||
    typeof status !== 'string' ||
    !(directoryRemovalRequestDecisions as readonly string[]).includes(status)
  ) {
    throw new BadRequestError('A decision takes only a status of accepted or declined.');
  }
  return status as DirectoryRemovalRequestDecision;
};

export async function decideDirectoryRemovalRequest(
  requestId: string,
  adminNetid: string,
  body: unknown,
): Promise<{ _id: string; status: DirectoryRemovalRequestDecision; decidedAt: string }> {
  const decision = parseDecision(body);
  const decidedAt = new Date();
  const updated = await DirectoryRemovalRequest.findOneAndUpdate(
    { _id: requestId, status: 'pending' },
    { $set: { status: decision, decidedAt, decidedBy: normalizedNetid(adminNetid) } },
    { returnDocument: 'after' },
  ).lean();
  if (updated) {
    return { _id: String(updated._id), status: decision, decidedAt: decidedAt.toISOString() };
  }
  if (await DirectoryRemovalRequest.exists({ _id: requestId })) {
    throw new ConflictError('This request has already been decided.');
  }
  throw new NotFoundError('Removal request not found.');
}
