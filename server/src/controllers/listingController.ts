/**
 * Controller handlers for listing CRUD routes.
 */
import { Request, Response } from 'express';
import { readPublicListing, addView } from '../services/listingService';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/analytics';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { isPublicHttpUrl } from '../utils/urlSafety';
import { serializedDocumentId } from '../utils/idSerialization';

const MAX_PUBLIC_LISTING_URLS = 20;

const publicHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    if (!isPublicHttpUrl(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
};

const publicHttpUrls = (values: unknown): string[] =>
  Array.isArray(values)
    ? values.slice(0, MAX_PUBLIC_LISTING_URLS).flatMap((value) => publicHttpUrl(value) ?? [])
    : [];

const publicListingText = (value: unknown): string | undefined =>
  typeof value === 'string' ? redactDirectContactInfo(value) : undefined;

const publicListingTextArray = (values: unknown): string[] =>
  Array.isArray(values) ? values.flatMap((value) => publicListingText(value) ?? []) : [];

const PUBLIC_EVIDENCE_SOURCE_LIMIT = 8;

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const toIsoString = (value: unknown): string | undefined => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const sanitizePublicSourceUrl = (value: unknown): string | undefined => {
  const raw = toOptionalString(value);
  if (!raw) return undefined;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(withScheme);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
};

export const sanitizePublicEvidence = (evidence: any) => {
  if (!evidence || typeof evidence !== 'object') {
    return {
      status: 'unavailable',
      sources: [],
    };
  }

  const sources = Array.isArray(evidence.sources)
    ? evidence.sources
        .map((source: any) => {
          const url = sanitizePublicSourceUrl(source?.url);
          const label =
            toOptionalString(source?.label) ||
            toOptionalString(source?.title) ||
            (url ? new URL(url).hostname.replace(/^www\./, '') : undefined);
          if (!url && !label) return null;

          return {
            label,
            url,
            sourceType: toOptionalString(source?.sourceType),
            description: toOptionalString(source?.description),
            lastCheckedAt: toIsoString(source?.lastCheckedAt),
          };
        })
        .filter(Boolean)
        .slice(0, PUBLIC_EVIDENCE_SOURCE_LIMIT)
    : [];

  return {
    status: toOptionalString(evidence.status) || (sources.length > 0 ? 'available' : 'unavailable'),
    summary: toOptionalString(evidence.summary),
    confidence:
      typeof evidence.confidence === 'number' &&
      Number.isFinite(evidence.confidence) &&
      evidence.confidence >= 0 &&
      evidence.confidence <= 1
        ? evidence.confidence
        : undefined,
    generatedAt: toIsoString(evidence.generatedAt),
    lastVerifiedAt: toIsoString(evidence.lastVerifiedAt),
    sources,
  };
};

const publicListingForAuthenticatedReader = (listing: any) => {
  const id = serializedDocumentId(listing._id) || serializedDocumentId(listing.id) || '';
  return {
    _id: id,
    id,
    title: publicListingText(listing.title),
    hiringStatus: publicListingText(listing.hiringStatus),
    websites: publicHttpUrls(listing.websites),
    description: publicListingText(listing.description),
    applicantDescription: publicListingText(listing.applicantDescription),
    researchAreas: publicListingTextArray(listing.researchAreas),
    keywords: publicListingTextArray(listing.keywords),
    established: listing.established,
    departments: publicListingTextArray(listing.departments),
    type: publicListingText(listing.type),
    commitment: publicListingText(listing.commitment),
    compensationType: publicListingText(listing.compensationType),
    expiresAt: listing.expiresAt,
    evidence: sanitizePublicEvidence(listing.evidence),
  };
};

const LISTING_OUTREACH_OUTCOMES = new Set(['emailed', 'will_contact_later', 'not_a_fit']);
const LISTING_OUTREACH_ACTIONS = new Set(['email_click', 'outcome']);

export const buildListingOutreachEvent = (params: {
  action?: unknown;
  outcome?: unknown;
  source?: unknown;
  contactCount?: number;
}) => {
  const action = typeof params.action === 'string' ? params.action : '';
  if (!LISTING_OUTREACH_ACTIONS.has(action)) {
    return null;
  }

  const source = typeof params.source === 'string' ? params.source.slice(0, 80) : 'listing_detail';
  const baseMetadata = {
    channel: 'email',
    source,
    contactCount: params.contactCount || 0,
  };

  if (action === 'email_click') {
    return {
      eventType: AnalyticsEventType.OUTREACH_CONTACT_ATTEMPT,
      metadata: {
        ...baseMetadata,
        action,
      },
    };
  }

  const outcome = typeof params.outcome === 'string' ? params.outcome : '';
  if (!LISTING_OUTREACH_OUTCOMES.has(outcome)) {
    return null;
  }

  return {
    eventType: AnalyticsEventType.OUTREACH_OUTCOME,
    metadata: {
      ...baseMetadata,
      action,
      outcome,
    },
  };
};

const sendListingError = (response: Response, error: any, fallbackMessage: string) => {
  const status = error?.status ?? error?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    const body =
      status === 403
        ? { error: 'Incorrect permissions', incorrectPermissions: true }
        : { error: 'Listing not found' };
    return response.status(status).json(body);
  }
  if (error?.name === 'ValidationError') {
    return response.status(400).json({ error: 'Validation error' });
  }

  return response.status(500).json({ error: fallbackMessage });
};

export const recordListingOutreach = async (request: Request, response: Response) => {
  try {
    const listing = await readPublicListing(request.params.id);
    const contactCount = [listing.ownerEmail, ...(listing.emails || [])].filter(Boolean).length;
    const event = buildListingOutreachEvent({
      action: request.body?.action,
      outcome: request.body?.outcome,
      source: request.body?.source,
      contactCount,
    });

    if (!event) {
      return response.status(400).json({ error: 'Invalid outreach event' });
    }

    const currentUser = request.user as { netId?: string; userType: string };
    if (!currentUser?.netId) {
      return response.status(401).json({ error: 'Authentication required' });
    }

    await logEvent({
      eventType: event.eventType,
      netid: currentUser.netId,
      userType: currentUser.userType,
      listingId: request.params.id,
      metadata: event.metadata,
    });

    return response.status(204).send();
  } catch (error: any) {
    sendListingError(response, error, 'Failed to record outreach');
  }
};

export const getListingById = async (request: Request, response: Response) => {
  try {
    const listing = await readPublicListing(request.params.id);
    response.status(200).json({ listing: publicListingForAuthenticatedReader(listing) });
  } catch (error: any) {
    sendListingError(response, error, 'Failed to fetch listing');
  }
};

export const addViewToListing = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

    const listing = await addView(request.params.id, currentUser.netId!);
    response.status(200).json({ listing: publicListingForAuthenticatedReader(listing) });
  } catch (error: any) {
    sendListingError(response, error, 'Failed to update listing view count');
  }
};

