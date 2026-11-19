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
        type: 'CURRENT_UNDERGRADS',
        confidence: 'HIGH',
        observedAt: new Date('2026-05-12T00:00:00.000Z'),
        excerpt: 'Questions: [email redacted] or [phone redacted].',
        sourceUrl: 'mailto:hidden@example.edu',
      },
      { model },
    );

    expect(capturedUpdate.$set['source.excerpt']).toBeUndefined();
    expect(capturedUpdate.$set['source.url']).toBeUndefined();
    expect(JSON.stringify(capturedUpdate)).not.toContain('mailto:');
    expect(JSON.stringify(capturedUpdate)).not.toMatch(/redacted/i);
  });

  it('persists a substantive excerpt with its published contact address (#5046)', async () => {
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
        type: 'CURRENT_UNDERGRADS',
        confidence: 'HIGH',
        observedAt: new Date('2026-05-12T00:00:00.000Z'),
        excerpt:
          'Undergraduates run independent projects each term. Email hidden@example.edu to inquire.',
      },
      { model },
    );

    expect(capturedUpdate.$set['source.excerpt']).toBe(
      'Undergraduates run independent projects each term. Email hidden@example.edu to inquire.',
    );
  });
});
