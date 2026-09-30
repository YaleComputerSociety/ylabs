import type { Request, Response } from 'express';
import type { CorpusFingerprint } from './journeyEvalMetrics';
import type {
  ProgramBrowseRequest,
  ProgramBrowseResult,
  ProgramJourneyContext,
} from './journeyEvalProgramCases';

export const studentProgramSearchQuery = (
  request: ProgramBrowseRequest,
  defaultPageSize: number,
): Record<string, string> => {
  const query: Record<string, string> = {
    query: request.query ?? '',
    page: String(request.page ?? 1),
    pageSize: String(request.pageSize ?? defaultPageSize),
  };
  if (request.sortBy) {
    query.sortBy = request.sortBy;
    query.sortOrder = String(request.sortOrder ?? 1);
  }
  for (const [field, values] of Object.entries(request.filters ?? {})) {
    if (values.length > 0) query[field] = values.join(',');
  }
  return query;
};

export async function buildProgramJourneyContext(settings: {
  window: number;
  pagesChecked: number;
  facetValuesChecked: number;
}): Promise<ProgramJourneyContext> {
  const { searchProgramsController } = await import('../../controllers/programController');
  const { getProgramFilterOptions } = await import('../../services/programService');
  const { Fellowship } = await import('../../models/fellowship');

  const browseAsStudent = async (request: ProgramBrowseRequest): Promise<ProgramBrowseResult> => {
    let body: ProgramBrowseResult = {};
    const response = {
      json: (payload: ProgramBrowseResult) => {
        body = payload;
        return response;
      },
    };
    await searchProgramsController(
      { query: studentProgramSearchQuery(request, settings.window) } as unknown as Request,
      response as unknown as Response,
    );
    return body;
  };

  return {
    ...settings,
    browseAsStudent,
    readFilterOptions: async () =>
      (await getProgramFilterOptions()) as unknown as Record<string, string[]>,
    readStoredPrograms: async (ids: string[]) => {
      const rows = await Fellowship.find({ _id: { $in: ids } }).lean();
      return new Map(
        rows.map((row) => [String(row._id), row as unknown as Record<string, unknown>]),
      );
    },
    readCorpusFingerprint: async (): Promise<CorpusFingerprint> => {
      const [rowCount, latest] = await Promise.all([
        Fellowship.countDocuments({}),
        Fellowship.find({}, { updatedAt: 1 }).sort({ updatedAt: -1 }).limit(1).lean(),
      ]);
      const latestUpdatedAt = (latest[0] as { updatedAt?: Date } | undefined)?.updatedAt;
      return {
        rowCount,
        latestUpdatedAt: latestUpdatedAt ? new Date(latestUpdatedAt).toISOString() : null,
      };
    },
  };
}
