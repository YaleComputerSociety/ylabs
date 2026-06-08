import { Request, Response } from 'express';
import { getOpportunityDetail } from '../services/opportunityDetailService';

export const getOpportunityById = async (request: Request, response: Response) => {
  try {
    const id = request.params.id;
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      return response.status(400).json({ error: 'Missing opportunity id' });
    }

    const detail = await getOpportunityDetail(id);
    if (!detail) {
      return response.status(404).json({ error: 'Opportunity not found' });
    }

    return response.status(200).json(detail);
  } catch (error) {
    console.error('Opportunity detail failed:', error);
    return response.status(500).json({ error: 'Failed to fetch opportunity' });
  }
};
