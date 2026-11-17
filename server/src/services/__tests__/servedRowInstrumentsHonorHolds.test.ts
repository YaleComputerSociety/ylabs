import { describe, expect, it, vi } from 'vitest';
import {
  holdingStudentVisibilityOverrideTiers,
  servedResearchEntityRowFilter,
} from '../../models/studentVisibility';

const aggregate = vi.fn(async () => [{}]);

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: { aggregate },
}));

describe('instruments that count served rows honor an operator hold', () => {
  it('excludes a held row and an archived row from the served-row filter', () => {
    expect(servedResearchEntityRowFilter()).toEqual({
      studentVisibilityTier: { $in: ['student_ready'] },
      studentVisibilityOverrideTier: { $nin: [...holdingStudentVisibilityOverrideTiers] },
      archived: { $ne: true },
    });
  });

  it('matches served rows in the live Corpus Quality read through the shared filter', async () => {
    const { readCorpusQualityLiveMetrics } = await import('../corpusQualityLiveMetrics');
    await readCorpusQualityLiveMetrics(new Date('2026-11-16T00:00:00.000Z'));
    expect(JSON.stringify(aggregate.mock.calls[0])).toContain(
      JSON.stringify(servedResearchEntityRowFilter()),
    );
  });

  it('audits public descriptions over the same served rows', async () => {
    const { STUDENT_READY_PUBLIC_DESCRIPTION_AUDIT_FILTER } =
      await import('../researchEntityPublicDescriptionAuditService');
    expect(STUDENT_READY_PUBLIC_DESCRIPTION_AUDIT_FILTER).toEqual(servedResearchEntityRowFilter());
  });
});
