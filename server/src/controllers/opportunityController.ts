import { Request, Response } from 'express';
import { getOpportunityDetail } from '../services/opportunityDetailService';
import { sanitizeLogValue } from '../utils/logSanitizer';

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
