/**
 * Controller handlers for fellowship CRUD routes.
 */
import { NextFunction, Request, Response } from 'express';
import { addView } from '../services/fellowshipService';
import { publicProgramForReader } from './programPayload';
import { isNotFoundError } from '../utils/errors';

const answerFellowshipError = (error: unknown, response: Response, next: NextFunction) => {
  if (isNotFoundError(error)) {
    return response.status(404).json({ error: 'Fellowship not found' });
  }

  return next(error);
};

export const addViewToFellowship = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const fellowship = await addView(request.params.id);
    response.status(200).json({ fellowship: publicProgramForReader(fellowship) });
  } catch (error: any) {
    answerFellowshipError(error, response, next);
  }
};
