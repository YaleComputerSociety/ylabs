import { describe, expect, it, vi } from 'vitest';

const fellowshipModelMock = vi.hoisted(() => ({
  findByIdAndUpdate: vi.fn(),
  find: vi.fn(),
}));

vi.mock('../../models/fellowship', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/fellowship')>()),
  Fellowship: fellowshipModelMock,
}));

import {
  publicFellowshipForStudent,
  readFellowships,
  updateFellowship,
} from '../fellowshipService';

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

  it('clears isAcceptingApplications when the deadline has already passed', () => {
    const now = new Date('2026-08-22T00:00:00.000Z');
    const payload = publicFellowshipForStudent(
      {
        _id: '67d8928150621bcef434a1d5',
        title: 'Past-deadline program',
        isAcceptingApplications: true,
        deadline: new Date('2026-03-24T00:00:00.000Z'),
      },
      now,
    );
    expect(payload.isAcceptingApplications).toBe(false);
  });

  it('keeps isAcceptingApplications when the deadline is in the future or absent', () => {
    const now = new Date('2026-08-22T00:00:00.000Z');
    const futureDeadline = publicFellowshipForStudent(
      {
        _id: '67d8928150621bcef434a1d6',
        title: 'Future-deadline program',
        isAcceptingApplications: true,
        deadline: new Date('2026-12-20T00:00:00.000Z'),
      },
      now,
    );
    expect(futureDeadline.isAcceptingApplications).toBe(true);

    const noDeadline = publicFellowshipForStudent(
      {
        _id: '67d8928150621bcef434a1d7',
        title: 'Rolling program',
        isAcceptingApplications: true,
      },
      now,
    );
    expect(noDeadline.isAcceptingApplications).toBe(true);
  });

  it('projects a stale, source-backed recurring deadline forward to its next annual cycle', () => {
    const now = new Date('2026-08-22T00:00:00.000Z');
    const payload = publicFellowshipForStudent(
      {
        _id: '67d8928150621bcef434a1d8',
        title: 'Mellon Mays Undergraduate Fellowship',
        summary: 'An annual grant awarded each spring for undergraduate research.',
        isAcceptingApplications: true,
        deadline: new Date('2026-02-17T00:00:00.000Z'),
        applicationLink: 'https://fellowships.yale.edu/mellon-mays',
      },
      now,
    );
    expect(payload.deadlineProjectedNextCycle).toBe(true);
    expect(payload.deadline).toEqual(new Date('2027-02-17T00:00:00.000Z'));
    expect(payload.isAcceptingApplications).toBe(false);
  });

  it('does not project a stale deadline when the program is not source-backed', () => {
    const now = new Date('2026-08-22T00:00:00.000Z');
    const payload = publicFellowshipForStudent(
      {
        _id: '67d8928150621bcef434a1d9',
        title: 'Annual undergraduate research grant',
        summary: 'An annual grant for undergraduate research.',
        deadline: new Date('2026-02-17T00:00:00.000Z'),
      },
      now,
    );
    expect(payload.deadlineProjectedNextCycle).toBe(false);
    expect(payload.deadline).toEqual(new Date('2026-02-17T00:00:00.000Z'));
  });

  it('does not project a stale deadline when the program text has no recurrence signal', () => {
    const now = new Date('2026-08-22T00:00:00.000Z');
    const payload = publicFellowshipForStudent(
      {
        _id: '67d8928150621bcef434a1da',
        title: 'Book Purchase Reimbursement',
        summary: 'A single reimbursement for course materials with no repeat schedule.',
        deadline: new Date('2026-02-17T00:00:00.000Z'),
        applicationLink: 'https://fellowships.yale.edu/one-time',
      },
      now,
    );
    expect(payload.deadlineProjectedNextCycle).toBe(false);
    expect(payload.deadline).toEqual(new Date('2026-02-17T00:00:00.000Z'));
  });

  it('leaves a future deadline untouched', () => {
    const now = new Date('2026-08-22T00:00:00.000Z');
    const payload = publicFellowshipForStudent(
      {
        _id: '67d8928150621bcef434a1db',
        title: 'Annual fellowship',
        summary: 'An annual fellowship for undergraduates.',
        deadline: new Date('2026-12-20T00:00:00.000Z'),
        applicationLink: 'https://fellowships.yale.edu/annual',
      },
      now,
    );
    expect(payload.deadlineProjectedNextCycle).toBe(false);
    expect(payload.deadline).toEqual(new Date('2026-12-20T00:00:00.000Z'));
  });

  it('strips a stale present-by clause whose month precedes the record deadline', () => {
    const staleText =
      'To provide funding to off-set the costs associated with a senior research project or senior essay. For funding research which must take place during the academic year and awardees must present the result of their research either to the Senior Mellon Forum or another educational forum in the college by April, 2025.';
    const payload = publicFellowshipForStudent({
      _id: '67d8928150621bcef434a1e0',
      title: 'Davenport College Mellon Senior Research Grant',
      summary: staleText,
      description: staleText,
      deadline: new Date('2026-03-02T05:00:00.000Z'),
    });
    expect(payload.summary).toBe(
      'To provide funding to off-set the costs associated with a senior research project or senior essay. For funding research which must take place during the academic year and awardees must present the result of their research either to the Senior Mellon Forum or another educational forum in the college.',
    );
    expect(payload.description).toBe(payload.summary);
    expect(payload.summary).not.toContain('April, 2025');
  });

  it('keeps a present-by clause whose month is on or after the record deadline', () => {
    const consistentText =
      'For funding research and awardees must present the result of their research either to the Senior Mellon Forum or another educational forum in the college by April, 2026.';
    const payload = publicFellowshipForStudent({
      _id: '67d8928150621bcef434a1e1',
      title: 'Benjamin Franklin College Mellon Research Fellowship for Seniors',
      summary: consistentText,
      deadline: new Date('2025-12-07T04:59:00.000Z'),
    });
    expect(payload.summary).toBe(consistentText);
  });

  it('leaves present-by clauses untouched when the record has no deadline', () => {
    const text =
      'Awardees must present the result of their research to the college by April, 2025.';
    const payload = publicFellowshipForStudent({
      _id: '67d8928150621bcef434a1e2',
      title: 'Rolling grant',
      summary: text,
    });
    expect(payload.summary).toBe(text);
  });

  it('does not strip a stale-looking date clause unrelated to presenting results', () => {
    const text = 'Applications for the current cycle are due by April, 2025.';
    const payload = publicFellowshipForStudent({
      _id: '67d8928150621bcef434a1e3',
      title: 'Grant with an unrelated date',
      summary: text,
      deadline: new Date('2026-03-02T05:00:00.000Z'),
    });
    expect(payload.summary).toBe(text);
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

    const prepSteps = Array.from(
      { length: 50 },
      (_, index) => `Email prep${index}@yale.edu or call 203-555-7777.`,
    );
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
    expect(update.links).toEqual([
      { label: 'Email [email redacted]', url: 'https://example.yale.edu/program' },
    ]);
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

describe('readFellowships id-limit handling', () => {
  const makeIds = (count: number) =>
    Array.from({ length: count }, (_, index) => index.toString(16).padStart(24, '0'));

  const lastQueryIds = () => {
    const query = fellowshipModelMock.find.mock.lastCall![0] as { _id: { $in: string[] } };
    return query._id.$in;
  };

  it('caps the id query at 100 for untrusted callers', async () => {
    fellowshipModelMock.find.mockResolvedValueOnce([]);

    await readFellowships(makeIds(150));

    expect(lastQueryIds()).toHaveLength(100);
  });

  it('reads every id when a trusted caller skips the id limit', async () => {
    fellowshipModelMock.find.mockResolvedValueOnce([]);

    await readFellowships(makeIds(150), { skipIdLimit: true });

    expect(lastQueryIds()).toHaveLength(150);
  });
});
