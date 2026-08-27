/**
 * Controller handlers for ResearchEntity correction report workflows.
 */
import { Request, Response, NextFunction } from 'express';
import {
  createEntityCorrectionReport,
  listEntityCorrectionReports,
  readEntityCorrectionReport,
  reviewEntityCorrectionReport,
} from '../services/entityCorrectionReportService';

export const submitEntityCorrectionReport = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string; netid?: string; isAdmin?: boolean };
    const netId = currentUser?.netId || currentUser?.netid;
    if (!netId) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const report = await createEntityCorrectionReport(request.params.slug, request.body, {
      netId,
      userType: currentUser.isAdmin ? 'admin' : undefined,
    });

    response.status(201).json({ report });
  } catch (error) {
    next(error);
  }
};

export const listMyEntityCorrectionReports = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string; netid?: string };
    const netId = currentUser?.netId || currentUser?.netid;
    if (!netId) return response.status(401).json({ error: 'Unauthorized' });

    const result = await listEntityCorrectionReports({
      reporterNetId: netId,
      entitySlug: request.params.slug,
      status: request.query.status as string | undefined,
      page: request.query.page as string | undefined,
      pageSize: request.query.pageSize as string | undefined,
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
};

export const listAdminEntityCorrectionReports = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const result = await listEntityCorrectionReports({
      status: request.query.status as string | undefined,
      researchEntityId: request.query.researchEntityId as string | undefined,
      page: request.query.page as string | undefined,
      pageSize: request.query.pageSize as string | undefined,
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
};

export const getAdminEntityCorrectionReport = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const report = await readEntityCorrectionReport(request.params.id);
    response.json({ report });
  } catch (error) {
    next(error);
  }
};

export const reviewAdminEntityCorrectionReport = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string; netid?: string };
    const report = await reviewEntityCorrectionReport(
      request.params.id,
      currentUser?.netId || currentUser?.netid || '',
      request.body,
    );

    response.json({ report });
  } catch (error) {
    next(error);
  }
};
