import { Request, Response } from 'express';
import { getOpportunityDetail } from '../services/opportunityDetailService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  archiveFacultyOpportunity,
  closeFacultyOpportunity,
  createFacultyOpportunityDraft,
  FacultyOpportunityError,
  listFacultyOpportunities,
  listOwnedResearchEntities,
  previewFacultyOpportunityDraft,
  submitFacultyOpportunity,
  updateFacultyOpportunityDraft,
} from '../services/facultyOpportunityService';

const MAX_OPPORTUNITY_ID_LENGTH = 24;
const OPPORTUNITY_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

const normalizeOpportunityIdParam = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length !== MAX_OPPORTUNITY_ID_LENGTH) return undefined;
  return OPPORTUNITY_ID_PATTERN.test(trimmed) ? trimmed : undefined;
};

export const getOpportunityById = async (request: Request, response: Response) => {
  try {
    const rawId = request.params.id;
    if (!rawId || typeof rawId !== 'string' || rawId.trim().length === 0) {
      return response.status(400).json({ error: 'Missing opportunity id' });
    }

    const id = normalizeOpportunityIdParam(rawId);
    if (!id) {
      return response.status(400).json({ error: 'Invalid opportunity id' });
    }

    const detail = await getOpportunityDetail(id);
    if (!detail) {
      return response.status(404).json({ error: 'Opportunity not found' });
    }

    return response.status(200).json(detail);
  } catch (error) {
    console.error('Opportunity detail failed:', sanitizeLogValue(error));
    return response.status(500).json({ error: 'Failed to fetch opportunity' });
  }
};

const currentNetid = (request: Request): string =>
  String((request.user as any)?.netId || (request.user as any)?.netid || '').trim();

const sendFacultyOpportunityError = (response: Response, error: unknown): boolean => {
  if (!(error instanceof FacultyOpportunityError)) return false;
  response.status(error.status).json({
    error: error.message,
    code: error.code,
    ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
  });
  return true;
};

const facultyOpportunityHandler =
  (handler: (request: Request, response: Response) => Promise<unknown>) =>
  async (request: Request, response: Response) => {
    try {
      await handler(request, response);
    } catch (error) {
      if (sendFacultyOpportunityError(response, error)) return;
      console.error('Faculty opportunity request failed:', sanitizeLogValue(error));
      response.status(500).json({
        error:
          'The opportunity service is temporarily unavailable. Your last confirmed save is unchanged.',
        code: 'RETRYABLE_SERVER_FAILURE',
      });
    }
  };

export const listMyFacultyOpportunities = facultyOpportunityHandler(async (request, response) => {
  const opportunities = await listFacultyOpportunities(currentNetid(request));
  response.status(200).json({ opportunities });
});

export const listMyOwnedResearchEntities = facultyOpportunityHandler(async (request, response) => {
  const researchEntities = await listOwnedResearchEntities(currentNetid(request));
  response.status(200).json({ researchEntities });
});

export const previewMyFacultyOpportunity = facultyOpportunityHandler(async (request, response) => {
  const preview = await previewFacultyOpportunityDraft(
    currentNetid(request),
    request.body?.opportunity ?? request.body,
  );
  response.status(200).json({ preview });
});

export const createMyFacultyOpportunity = facultyOpportunityHandler(async (request, response) => {
  const result = await createFacultyOpportunityDraft(
    currentNetid(request),
    request.body?.opportunity ?? request.body,
    request.get('Idempotency-Key'),
  );
  response.status(result.created ? 201 : 200).json({ opportunity: result.opportunity });
});

export const updateMyFacultyOpportunity = facultyOpportunityHandler(async (request, response) => {
  const opportunity = await updateFacultyOpportunityDraft(
    currentNetid(request),
    request.params.id,
    request.body?.opportunity ?? request.body,
    request.body?.revision,
  );
  response.status(200).json({ opportunity });
});

export const submitMyFacultyOpportunity = facultyOpportunityHandler(async (request, response) => {
  const opportunity = await submitFacultyOpportunity(
    currentNetid(request),
    request.params.id,
    request.body?.revision,
  );
  response.status(200).json({ opportunity });
});

export const closeMyFacultyOpportunity = facultyOpportunityHandler(async (request, response) => {
  const opportunity = await closeFacultyOpportunity(
    currentNetid(request),
    request.params.id,
    request.body?.revision,
  );
  response.status(200).json({ opportunity });
});

export const archiveMyFacultyOpportunity = facultyOpportunityHandler(async (request, response) => {
  const opportunity = await archiveFacultyOpportunity(
    currentNetid(request),
    request.params.id,
    request.body?.revision,
  );
  response.status(200).json({ opportunity });
});
