import { describe, expect, it, vi } from 'vitest';

const fellowshipModelMock = vi.hoisted(() => ({
  findByIdAndUpdate: vi.fn(),
}));

vi.mock('../../models/fellowship', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/fellowship')>()),
  Fellowship: fellowshipModelMock,
}));

import { publicFellowshipForStudent, updateFellowship } from '../fellowshipService';

describe('fellowship public serializer', () => {
  it('sanitizes service-level public URL, contact, and prep-step fields', () => {
    const payload = publicFellowshipForStudent({
      _id: '67d8928150621bcef434a1d5',
      title: 'Visible program',
      summary: 'Email prose-contact@yale.edu or call 203-555-1212.',
      prepSteps: ['Email prep-contact@yale.edu or call 203-555-7777.'],
      links: [
        {
          label: 'Questions: hidden@example.edu or 203-555-0000.',
          url: 'https://example.yale.edu/program',
        },
        {
          label: 'Unsafe',
          url: 'javascript:alert(1)',
        },
      ],
      applicationLink: 'http://user:pass@example.test/apply',
      sourceName: 'Questions: source-contact@yale.edu or 203-555-2222.',
      sourceUrl: 'mailto:hidden@example.edu',
      contactEmail: 'program@yale.edu?bcc=attacker@example.test',
      contactPhone: '203-555-9999',
      createdAt: new Date('2026-01-06T00:00:00.000Z'),
      updatedAt: new Date('2026-01-07T00:00:00.000Z'),
      score: 12.5,
    });

    expect(payload).toMatchObject({
      summary: 'Email [email redacted] or call [phone redacted].',
      prepSteps: ['Email [email redacted] or call [phone redacted].'],
      links: [
        {
          label: 'Questions: [email redacted] or [phone redacted].',
          url: 'https://example.yale.edu/program',
        },
      ],
      sourceName: 'Questions: [email redacted] or [phone redacted].',
    });
    expect(payload.applicationLink).toBeUndefined();
    expect(payload.sourceUrl).toBeUndefined();
    expect(payload.contactEmail).toBeUndefined();
    expect(payload.contactPhone).toBeUndefined();
    expect(payload.createdAt).toBeUndefined();
    expect(payload.updatedAt).toBeUndefined();
    expect(payload.score).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('prose-contact@yale.edu');
    expect(JSON.stringify(payload)).not.toContain('prep-contact@yale.edu');
    expect(JSON.stringify(payload)).not.toContain('source-contact@yale.edu');
    expect(JSON.stringify(payload)).not.toContain('hidden@example.edu');
    expect(JSON.stringify(payload)).not.toContain('user:pass');
    expect(JSON.stringify(payload)).not.toContain('javascript:');
    expect(JSON.stringify(payload)).not.toContain('203-555');
  });

  it('bounds public fellowship serializer arrays and skips polluted values', () => {
    const links = Array.from({ length: 50 }, (_, index) => ({
      label: `Program ${index}`,
      url: `https://example.yale.edu/program/${index}`,
    }));
    Object.defineProperty(links, '50', {
      get: () => {
        throw new Error('fellowship serializer read past the links cap');
      },
      enumerable: true,
    });

    const prepSteps = Array.from({ length: 50 }, (_, index) => `Step ${index}`);
    Object.defineProperty(prepSteps, '50', {
      get: () => {
        throw new Error('fellowship serializer read past the prep-step cap');
      },
      enumerable: true,
    });

    const purpose = Array.from({ length: 50 }, (_, index) => `Purpose ${index}`);
    Object.defineProperty(purpose, '50', {
      get: () => {
        throw new Error('fellowship serializer read past the primitive array cap');
      },
      enumerable: true,
    });

    const payload = publicFellowshipForStudent({
      _id: '67d8928150621bcef434a1d5',
      title: 'x'.repeat(6000),
      summary: {
        toString: () => {
          throw new Error('fellowship serializer stringified polluted summary');
        },
      },
      links,
      prepSteps,
      purpose,
      awardAmount: {
        toString: () => {
          throw new Error('fellowship serializer stringified polluted award amount');
        },
      },
    });

    expect(payload.title).toHaveLength(5000);
    expect(payload.summary).toBeUndefined();
    expect(payload.links).toHaveLength(50);
    expect(payload.prepSteps).toHaveLength(50);
    expect(payload.purpose).toHaveLength(50);
    expect(payload.awardAmount).toBeUndefined();
  });

  it('does not invoke object-shaped fellowship id conversion hooks', () => {
    const unsafeId = {
      toString: () => {
        throw new Error('fellowship serializer stringified arbitrary id');
      },
      toHexString: () => {
        throw new Error('fellowship serializer called arbitrary id toHexString');
      },
    };

    const payload = publicFellowshipForStudent({
      _id: unsafeId,
      title: 'Visible program',
    });

    expect(payload._id).toBeUndefined();
  });

  it('skips object-shaped admin reviewer ids before persistence', async () => {
    fellowshipModelMock.findByIdAndUpdate.mockResolvedValue({
      toObject: () => ({ _id: '67d8928150621bcef434a1d5', title: 'Updated program' }),
    });
    const unsafeId = {
      toString: () => {
        throw new Error('fellowship update stringified arbitrary reviewer id');
      },
      toHexString: () => {
        throw new Error('fellowship update called arbitrary reviewer id toHexString');
      },
    };

    await updateFellowship('67d8928150621bcef434a1d5', {
      studentVisibilityReviewedByUserId: unsafeId,
    });

    const update = fellowshipModelMock.findByIdAndUpdate.mock.calls[0][1];
    expect(update).not.toHaveProperty('studentVisibilityReviewedByUserId');
  });

  it('bounds and allowlists admin fellowship update payloads before persistence', async () => {
    fellowshipModelMock.findByIdAndUpdate.mockResolvedValue({
      toObject: () => ({ _id: '67d8928150621bcef434a1d5', title: 'Updated program' }),
    });

    const prepSteps = Array.from({ length: 50 }, (_, index) => `Email prep${index}@yale.edu or call 203-555-7777.`);
    Object.defineProperty(prepSteps, '50', {
      get: () => {
        throw new Error('fellowship update sanitizer read past the prep-step cap');
      },
      enumerable: true,
    });

    await updateFellowship('67d8928150621bcef434a1d5', {
      title: `  ${'A'.repeat(6000)}  `,
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      programKind: 'NOT_A_KIND',
      entryMode: 'APPLY_TO_PROGRAM',
      summary: 'Email prose-contact@yale.edu or call 203-555-1212.',
      prepSteps,
      links: [
        { label: 'Email hidden@example.edu', url: 'https://example.yale.edu/program' },
        { label: 'Unsafe', url: 'javascript:alert(document.cookie)' },
      ],
      applicationLink: 'https://user:pass@example.yale.edu/apply',
      sourceUrl: 'https://example.yale.edu/source',
      hoursPerWeek: '12',
      applicationOpenDate: '2026-01-01T00:00:00.000Z',
      studentVisibilityTier: 'student_ready',
      studentVisibilityOverrideTier: 'not-a-tier',
      studentVisibilityReviewedByUserId: '67d8928150621bcef434a1d6',
      archived: true,
      audited: 'yes',
      raw: { private: true },
    });

    const update = fellowshipModelMock.findByIdAndUpdate.mock.lastCall![1];
    expect(update.title.length).toBeLessThanOrEqual(5000);
    expect(update.title).toMatch(/^A+$/);
    expect(update.programCategory).toBe('SUMMER_RESEARCH_PROGRAM');
    expect(update).not.toHaveProperty('programKind');
    expect(update.entryMode).toBe('APPLY_TO_PROGRAM');
    expect(update.summary).not.toContain('prose-contact@yale.edu');
    expect(update.summary).not.toContain('203-555-1212');
    expect(update.prepSteps).toHaveLength(50);
    expect(JSON.stringify(update.prepSteps)).not.toContain('@yale.edu');
    expect(update.links).toEqual([{ label: 'Email [email redacted]', url: 'https://example.yale.edu/program' }]);
    expect(update).not.toHaveProperty('applicationLink');
    expect(update.sourceUrl).toBe('https://example.yale.edu/source');
    expect(update.hoursPerWeek).toBe(12);
    expect(update.applicationOpenDate).toBeInstanceOf(Date);
    expect(update.studentVisibilityTier).toBe('student_ready');
    expect(update).not.toHaveProperty('studentVisibilityOverrideTier');
    expect(update.studentVisibilityReviewedByUserId).toBe('67d8928150621bcef434a1d6');
    expect(update.archived).toBe(true);
    expect(update).not.toHaveProperty('audited');
    expect(update).not.toHaveProperty('raw');
  });
});
