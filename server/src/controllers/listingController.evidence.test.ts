import { describe, expect, it } from 'vitest';
import { sanitizePublicEvidence } from './listingController';

describe('sanitizePublicEvidence', () => {
  it('removes private fields and unsafe URL details from evidence metadata', () => {
    const evidence = sanitizePublicEvidence({
      status: 'available',
      summary: 'Source-backed listing.',
      confidence: 0.8,
      generatedAt: '2026-01-01T00:00:00.000Z',
      internalNotes: 'private review note',
      sources: [
        {
          label: 'Official profile',
          url: 'https://user:pass@example.edu/path?token=secret#hash',
          sourceType: 'official',
          description: 'Faculty profile',
          lastCheckedAt: '2026-01-02T00:00:00.000Z',
          internalNotes: 'do not expose',
        },
        {
          label: 'Bad source',
          url: 'javascript:alert(1)',
        },
      ],
    });

    expect(evidence).toEqual({
      status: 'available',
      summary: 'Source-backed listing.',
      confidence: 0.8,
      generatedAt: '2026-01-01T00:00:00.000Z',
      lastVerifiedAt: undefined,
      sources: [
        {
          label: 'Official profile',
          url: 'https://example.edu/path',
          sourceType: 'official',
          description: 'Faculty profile',
          lastCheckedAt: '2026-01-02T00:00:00.000Z',
        },
        {
          label: 'Bad source',
          url: undefined,
          sourceType: undefined,
          description: undefined,
          lastCheckedAt: undefined,
        },
      ],
    });
    expect(JSON.stringify(evidence)).not.toContain('private');
    expect(JSON.stringify(evidence)).not.toContain('secret');
  });

  it('returns an unavailable shell when evidence is absent', () => {
    expect(sanitizePublicEvidence(undefined)).toEqual({
      status: 'unavailable',
      sources: [],
    });
  });
});
