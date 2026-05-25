import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminOperatorBoard from '../AdminOperatorBoard';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminOperatorBoard', () => {
  it('keeps repair queues ahead of evidence signals without changing the board layout', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        generatedAt: '2026-05-25T15:00:00.000Z',
        trustTiers: {
          research: [
            { tier: 'student_ready', count: 4 },
            { tier: 'limited_but_safe', count: 3 },
            { tier: 'operator_review', count: 2 },
            { tier: 'suppressed', count: 1 },
          ],
          programs: [
            { tier: 'student_ready', count: 2 },
            { tier: 'limited_but_safe', count: 1 },
            { tier: 'operator_review', count: 0 },
            { tier: 'suppressed', count: 1 },
          ],
        },
        reasonCounts: {
          research: [],
          programs: [],
        },
        queues: [
          {
            collection: 'research',
            reason: 'source_backed_description',
            kind: 'evidence',
            count: 25,
            nextAction: 'Review for possible promotion.',
            samples: [
              {
                id: 'sample-evidence',
                label: 'Source Backed Lab',
                tier: 'limited_but_safe',
                reasons: ['source_backed_description', 'missing_action_evidence'],
              },
            ],
          },
          {
            collection: 'research',
            reason: 'missing_action_evidence',
            kind: 'blocking',
            count: 5,
            nextAction: 'Add source-backed action evidence.',
            samples: [
              {
                id: 'sample-blocker',
                label: 'Repair Candidate Lab',
                tier: 'operator_review',
                reasons: ['missing_action_evidence', 'source_backed_description'],
              },
            ],
          },
        ],
        gates: {
          dataQuality: {
            status: 'manual',
            command: 'yarn --cwd server beta:data-quality --include-samples',
            note: 'Run before promotion.',
          },
          scraperIntegrity: {
            status: 'watch',
            command: 'yarn --cwd server scraper:integrity-gate --include-samples',
            latestRuns: [],
          },
        },
        sourceFreshness: {
          windowDays: 30,
          riskCounts: { ok: 1, warn: 0, error: 0 },
          rows: [],
        },
      },
    });

    render(<AdminOperatorBoard />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Data Quality Operator Board' })).toBeTruthy();
    });

    const repairBadge = screen.getByText('Repair queue');
    const evidenceBadge = screen.getByText('Evidence signal');
    expect(repairBadge.compareDocumentPosition(evidenceBadge)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText('Likely blockers')).toBeTruthy();
    expect(screen.getByText('Evidence signals')).toBeTruthy();
    expect(screen.getByText('Repair Candidate Lab')).toBeTruthy();
    expect(screen.getByText('Source Backed Lab')).toBeTruthy();
  });
});
