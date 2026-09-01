/**
 * Controller handlers for fellowship CRUD routes.
 */
import { Request, Response } from 'express';
import { addView } from '../services/fellowshipService';
import { publicProgramForReader } from './programPayload';

const sendFellowshipError = (response: Response, error: any, fallbackMessage: string) => {
  if (error?.name === 'NotFoundError') {
    return response.status(404).json({ error: 'Fellowship not found' });
  }

  return response.status(500).json({ error: fallbackMessage });
};

export const addViewToFellowship = async (request: Request, response: Response) => {
  try {
    const fellowship = await addView(request.params.id);
    response.status(200).json({ fellowship: publicProgramForReader(fellowship) });
  } catch (error: any) {
    sendFellowshipError(response, error, 'Failed to update fellowship view count');
  }
};
