import { Request, Response } from 'express';
import { getOpportunityDetail } from '../services/opportunityDetailService';
import { NotFoundError } from '../utils/errors';

export const getOpportunityById = async (request: Request, response: Response) => {
  const id = request.params.id;
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return response.status(400).json({ error: 'Missing opportunity id' });
  }

  const detail = await getOpportunityDetail(id);
  if (!detail) {
    throw new NotFoundError(`Opportunity not found with id: ${id}`);
  }

  return response.status(200).json(detail);
};
