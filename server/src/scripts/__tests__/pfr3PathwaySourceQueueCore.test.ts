import { describe, expect, it } from 'vitest';
import { buildPathwaySourceQueue } from '../pfr3PathwaySourceQueueCore';

const salt = 'test-only-queue-handle-salt';

describe('buildPathwaySourceQueue', () => {
  it('builds mutually exclusive deterministic remediation buckets', () => {
    const candidates = [
      {
        id: 'status',
        status: 'UNKNOWN',
        evidenceStrength: 'STRONG',
        confidence: 0.8,
        sourceUrls: ['https://yale.edu/a'],
        sourceEvidenceIds: ['e1'],
      },
      {
        id: 'url',
        status: 'ACTIVE',
        evidenceStrength: 'STRONG',
        confidence: 0.8,
        sourceUrls: ['mailto:person@yale.edu'],
        sourceEvidenceIds: ['e2'],
      },
      {
        id: 'weak',
        status: 'ACTIVE',
        evidenceStrength: 'WEAK',
        confidence: 0.5,
        sourceUrls: ['https://yale.edu/c'],
        sourceEvidenceIds: ['e3'],
      },
      {
        id: 'ready',
        status: 'ACTIVE',
        evidenceStrength: 'STRONG',
        confidence: 0.8,
        sourceUrls: ['https://yale.edu/d'],
        sourceEvidenceIds: ['e4'],
      },
    ];
    const first = buildPathwaySourceQueue(candidates, { sampleLimit: 10, handleSalt: salt });
    const second = buildPathwaySourceQueue([...candidates].reverse(), {
      sampleLimit: 10,
      handleSalt: salt,
    });
    expect(first).toEqual(second);
    expect(first.buckets.status_recency_review.count).toBe(1);
    expect(first.buckets.source_repair.count).toBe(1);
    expect(first.buckets.new_source_acquisition.count).toBe(1);
  });

  it('emits no raw ids, URLs, evidence references, or contact data', () => {
    const report = buildPathwaySourceQueue(
      [
        {
          id: 'raw-db-id',
          status: 'ACTIVE',
          evidenceStrength: 'WEAK',
          confidence: 0.5,
          sourceUrls: ['https://example.edu/private?q=person@yale.edu'],
          sourceEvidenceIds: ['raw-evidence-id'],
        },
      ],
      { sampleLimit: 1, handleSalt: salt },
    );
    const output = JSON.stringify(report);
    expect(output).not.toContain('raw-db-id');
    expect(output).not.toContain('example.edu');
    expect(output).not.toContain('person@yale.edu');
    expect(output).not.toContain('raw-evidence-id');
    expect(output).toMatch(/pathway-[a-f0-9]{12}/);
  });

  it('defaults to aggregate-only and rejects excessive sample limits', () => {
    const report = buildPathwaySourceQueue(
      [
        {
          id: 'one',
          status: 'UNKNOWN',
          evidenceStrength: 'STRONG',
          confidence: 0.8,
          sourceUrls: ['https://yale.edu'],
          sourceEvidenceIds: ['e'],
        },
      ],
      { handleSalt: salt },
    );
    expect(report.buckets.status_recency_review.samples).toEqual([]);
    expect(() => buildPathwaySourceQueue([], { sampleLimit: 101, handleSalt: salt })).toThrow();
  });
});
