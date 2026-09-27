/**
 * Controller for user operations: favorites, listings, and profile updates.
 */
import { NextFunction, Request, Response } from 'express';
import {
  getSavedResearchEntityList as getSavedResearchEntityListService,
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

const setPrivateAccountResponseHeaders = (response: Response) => {
  response.setHeader('Cache-Control', 'no-store, private, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Surrogate-Control', 'no-store');
  response.setHeader('Expires', '0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
};

export const getSavedResearchEntityIds = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string };
    response.status(200).json({
      savedResearchEntityIds: await getSavedResearchEntitySlugsService(currentUser.netId),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * A saved plan whose target is no longer servable is reported alongside the list
 * rather than dropped from it. `Cache-Control: no-store` because the unavailable ids
 * are the reader's own saved plans, so the response is per-account and must not be
 * cached by a shared hop the way the entity summaries alone could be (#2174).
 */
export const getSavedResearchEntities = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string };
    setPrivateAccountResponseHeaders(response);
    response.status(200).json(await getSavedResearchEntityListService(currentUser.netId));
  } catch (error) {
    next(error);
  }
};

export const addSavedResearchEntities = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
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
    next(error);
  }
};

export const removeSavedResearchEntities = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
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
    next(error);
  }
};

export const getSavedResearchEntityPlans = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string };
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({
      savedResearchEntityPlans: await getSavedResearchEntityPlansService(currentUser.netId),
    });
  } catch (error) {
    setPrivateAccountResponseHeaders(response);
    next(error);
  }
};

export const updateSavedResearchEntityPlan = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
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
    setPrivateAccountResponseHeaders(response);
    next(error);
  }
};

export const getWatchedProgramIds = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string };
    response.status(200).json({
      watchedProgramIds: await getWatchedProgramIdsService(currentUser.netId),
    });
  } catch (error) {
    next(error);
  }
};

export const getWatchedPrograms = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string };
    const programs = await getWatchedProgramsService(currentUser.netId);
    response.status(200).json({ watchedPrograms: programs.map(publicProgramForReader) });
  } catch (error) {
    next(error);
  }
};

export const addWatchedPrograms = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
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
    next(error);
  }
};

export const removeWatchedPrograms = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
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
    next(error);
  }
};

export const getWatchedProgramPlans = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string };
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({
      watchedProgramPlans: await getWatchedProgramPlansService(currentUser.netId),
    });
  } catch (error) {
    setPrivateAccountResponseHeaders(response);
    next(error);
  }
};

export const updateWatchedProgramPlan = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
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
    setPrivateAccountResponseHeaders(response);
    next(error);
  }
};
