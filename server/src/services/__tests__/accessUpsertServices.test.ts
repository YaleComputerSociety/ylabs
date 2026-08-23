import { describe, expect, it } from 'vitest';
import { upsertSignal } from '../signalService';

describe('access upsert services', () => {
  it('drops a marker-only excerpt and unsafe URLs before persistence (#1112)', async () => {
    let capturedUpdate: any;
    const model = {
      findOneAndUpdate: (_filter: any, update: any) => {
        capturedUpdate = update;
        return {
          lean: async () => ({ _id: 'signal-1' }),
        };
      },
    } as any;

    await upsertSignal(
      {
        researchEntityId: 'research-1',
        type: 'REACH_OUT_PLAUSIBLE',
        confidence: 'HIGH',
        observedAt: new Date('2026-05-12T00:00:00.000Z'),
        excerpt: 'Questions: hidden@example.edu or 203-432-1234.',
        sourceUrl: 'mailto:hidden@example.edu',
      },
      { model },
    );

    expect(capturedUpdate.$set['source.excerpt']).toBeUndefined();
    expect(capturedUpdate.$set['source.url']).toBeUndefined();
    expect(JSON.stringify(capturedUpdate)).not.toContain('hidden@example.edu');
    expect(JSON.stringify(capturedUpdate)).not.toContain('203-432-1234');
    expect(JSON.stringify(capturedUpdate)).not.toContain('mailto:');
    expect(JSON.stringify(capturedUpdate)).not.toMatch(/redacted/i);
  });

  it('persists a substantive excerpt with only the marker sentence dropped (#1112)', async () => {
    let capturedUpdate: any;
    const model = {
      findOneAndUpdate: (_filter: any, update: any) => {
        capturedUpdate = update;
        return {
          lean: async () => ({ _id: 'signal-2' }),
        };
      },
    } as any;

    await upsertSignal(
      {
        researchEntityId: 'research-1',
        type: 'REACH_OUT_PLAUSIBLE',
        confidence: 'HIGH',
        observedAt: new Date('2026-05-12T00:00:00.000Z'),
        excerpt:
          'Undergraduates run independent projects each term. Email hidden@example.edu to inquire.',
      },
      { model },
    );

    expect(capturedUpdate.$set['source.excerpt']).toMatch(
      /Undergraduates run independent projects each term/i,
    );
    expect(JSON.stringify(capturedUpdate)).not.toContain('hidden@example.edu');
    expect(JSON.stringify(capturedUpdate)).not.toMatch(/redacted/i);
  });
});
