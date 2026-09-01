/**
 * Controller for user operations: favorites, listings, and profile updates.
 */
import { Request, Response } from 'express';
import {
  getSavedResearchEntities as getSavedResearchEntitiesService,
  getSavedResearchEntitySlugs as getSavedResearchEntitySlugsService,
  getSavedResearchEntityPlans as getSavedResearchEntityPlansService,
  addSavedResearchEntities as addSavedResearchEntitiesService,
  removeSavedResearchEntities as removeSavedResearchEntitiesService,
  updateSavedResearchEntityPlan as updateSavedResearchEntityPlanService,
  getWatchedPrograms as getWatchedProgramsService,
  getWatchedProgramIds as getWatchedProgramIdsService,
  getWatchedProgramPlans as getWatchedProgramPlansService,
  addWatchedPrograms as addWatchedProgramsService,
  removeWatchedPrograms as removeWatchedProgramsService,
  updateWatchedProgramPlan as updateWatchedProgramPlanService,
} from '../services/researchPlanService';
import { publicProgramForReader } from './programPayload';
import { sanitizeLogValue } from '../utils/logSanitizer';

const setPrivateAccountResponseHeaders = (response: Response) => {
  response.setHeader('Cache-Control', 'no-store, private, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Surrogate-Control', 'no-store');
  response.setHeader('Expires', '0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
};

const publicAccountClientErrorMessage = (status: number): string => {
  if (status === 400) return 'Bad request';
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Not found';
  if (status === 409) return 'Conflict';
  return 'Request failed';
};

const sendAccountMutationError = (response: Response, error: any, fallbackMessage: string) => {
  const status = error?.status ?? error?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return response.status(status).json({ error: publicAccountClientErrorMessage(status) });
  }
  if (error?.name === 'ValidationError') {
    return response.status(400).json({ error: 'Validation error' });
  }
  return response.status(500).json({ error: fallbackMessage });
};

const sendPrivateAccountError = (response: Response, error: any, fallbackMessage: string) => {
  setPrivateAccountResponseHeaders(response);
  return sendAccountMutationError(response, error, fallbackMessage);
};

export const getSavedResearchEntityIds = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    response.status(200).json({
      savedResearchEntityIds: await getSavedResearchEntitySlugsService(currentUser.netId),
    });
  } catch (error) {
    console.error('Saved research entity id fetch failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to fetch saved research entity ids');
  }
};

export const getSavedResearchEntities = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    response.status(200).json({
      savedResearchEntities: await getSavedResearchEntitiesService(currentUser.netId),
    });
  } catch (error) {
    console.error('Saved research entity fetch failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to fetch saved research entities');
  }
};

export const addSavedResearchEntities = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const values = request.body?.data?.savedResearchEntities;
    if (!values) {
      const error: any = new Error('No savedResearchEntities provided');
      error.status = 400;
      throw error;
    }
    const ids = await addSavedResearchEntitiesService(
      currentUser.netId,
      Array.isArray(values) ? values : [values],
    );
    response.status(200).json({ savedResearchEntityIds: ids });
  } catch (error) {
    console.error('Saved research entity mutation failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to save research entities');
  }
};

export const removeSavedResearchEntities = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const values = request.body?.savedResearchEntities;
    if (!values) {
      const error: any = new Error('No savedResearchEntities provided');
      error.status = 400;
      throw error;
    }
    const ids = await removeSavedResearchEntitiesService(
      currentUser.netId,
      Array.isArray(values) ? values : [values],
    );
    response.status(200).json({ savedResearchEntityIds: ids });
  } catch (error) {
    console.error('Saved research entity removal failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to remove saved research entities');
  }
};

export const getSavedResearchEntityPlans = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({
      savedResearchEntityPlans: await getSavedResearchEntityPlansService(currentUser.netId),
    });
  } catch (error) {
    console.error('Saved research entity plan fetch failed:', sanitizeLogValue(error));
    sendPrivateAccountError(response, error, 'Failed to fetch saved research entity plans');
  }
};

export const updateSavedResearchEntityPlan = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const plans = await updateSavedResearchEntityPlanService(
      currentUser.netId,
      request.params.entityId,
      request.body?.data?.plan || request.body?.plan || {},
    );
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({ savedResearchEntityPlans: plans });
  } catch (error) {
    console.error('Saved research entity plan update failed:', sanitizeLogValue(error));
    sendPrivateAccountError(response, error, 'Failed to update saved research entity plan');
  }
};

export const getWatchedProgramIds = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    response.status(200).json({
      watchedProgramIds: await getWatchedProgramIdsService(currentUser.netId),
    });
  } catch (error) {
    console.error('Watched program id fetch failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to fetch watched program ids');
  }
};

export const getWatchedPrograms = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const programs = await getWatchedProgramsService(currentUser.netId);
    response.status(200).json({ watchedPrograms: programs.map(publicProgramForReader) });
  } catch (error) {
    console.error('Watched program fetch failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to fetch watched programs');
  }
};

export const addWatchedPrograms = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const values = request.body?.data?.watchedPrograms;
    if (!values) {
      const error: any = new Error('No watchedPrograms provided');
      error.status = 400;
      throw error;
    }
    const ids = await addWatchedProgramsService(
      currentUser.netId,
      Array.isArray(values) ? values : [values],
    );
    response.status(200).json({ watchedProgramIds: ids });
  } catch (error) {
    console.error('Watched program mutation failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to watch programs');
  }
};

export const removeWatchedPrograms = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const values = request.body?.watchedPrograms;
    if (!values) {
      const error: any = new Error('No watchedPrograms provided');
      error.status = 400;
      throw error;
    }
    const ids = await removeWatchedProgramsService(
      currentUser.netId,
      Array.isArray(values) ? values : [values],
    );
    response.status(200).json({ watchedProgramIds: ids });
  } catch (error) {
    console.error('Watched program removal failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to unwatch programs');
  }
};

export const getWatchedProgramPlans = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({
      watchedProgramPlans: await getWatchedProgramPlansService(currentUser.netId),
    });
  } catch (error) {
    console.error('Watched program plan fetch failed:', sanitizeLogValue(error));
    sendPrivateAccountError(response, error, 'Failed to fetch watched program plans');
  }
};

export const updateWatchedProgramPlan = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const plans = await updateWatchedProgramPlanService(
      currentUser.netId,
      request.params.programId,
      request.body?.data?.plan || request.body?.plan || {},
    );
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({ watchedProgramPlans: plans });
  } catch (error) {
    console.error('Watched program plan update failed:', sanitizeLogValue(error));
    sendPrivateAccountError(response, error, 'Failed to update watched program plan');
  }
};
