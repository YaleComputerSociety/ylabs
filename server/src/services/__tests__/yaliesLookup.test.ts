import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupYalieByNetid } from '../yaliesService';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { default: { ...actual.default, post: vi.fn() } };
});

const post = vi.mocked(axios.post);
const ORIGINAL_KEY = process.env.YALIES_API_KEY;

const respond = (records: unknown[]) => post.mockResolvedValue({ data: records });

const person = {
  netid: 'fixturenetid',
  first_name: 'Fixture',
  last_name: 'Person',
  email: 'fixture.person@example.invalid',
};

describe('lookupYalieByNetid', () => {
  beforeEach(() => {
    process.env.YALIES_API_KEY = 'fixture-key';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.YALIES_API_KEY = ORIGINAL_KEY;
    post.mockReset();
    vi.restoreAllMocks();
  });

  it('reads a record with enrolment fields as a student', async () => {
    respond([{ ...person, year: 2028, school_code: 'YC', college: 'Fixture College' }]);

    const lookup = await lookupYalieByNetid('fixturenetid');

    expect(lookup).toMatchObject({
      kind: 'student',
      identity: { userType: 'undergraduate', userConfirmed: true },
    });
    expect(lookup.kind === 'student' && lookup.identity).not.toHaveProperty('year');
    expect(lookup.kind === 'student' && lookup.identity).not.toHaveProperty('college');
  });

  it('reads a graduate school code as a graduate student', async () => {
    respond([{ ...person, year: 2027, school_code: 'GS' }]);

    expect(await lookupYalieByNetid('fixturenetid')).toMatchObject({
      kind: 'student',
      identity: { userType: 'graduate' },
    });
  });

  it('reads a titled record without enrolment fields as an employee', async () => {
    respond([
      {
        ...person,
        title: 'Program Coordinator',
        unit_name: 'Fixture Office',
        organization_name: 'Fixture Organization',
      },
    ]);

    expect(await lookupYalieByNetid('fixturenetid')).toEqual({
      kind: 'employee',
      employee: {
        netid: 'fixturenetid',
        fname: 'Fixture',
        lname: 'Person',
        email: 'fixture.person@example.invalid',
        title: 'Program Coordinator',
        department: 'Fixture Office',
      },
    });
  });

  it('answers not found when Yalies returns no record, or one with neither enrolment nor title', async () => {
    respond([]);
    expect(await lookupYalieByNetid('fixturenetid')).toEqual({ kind: 'not_found' });

    respond([{ ...person }]);
    expect(await lookupYalieByNetid('fixturenetid')).toEqual({ kind: 'not_found' });
  });

  it('answers unavailable, not not-found, when the request fails', async () => {
    post.mockRejectedValue(new Error('timeout of 10000ms exceeded'));

    expect(await lookupYalieByNetid('fixturenetid')).toEqual({ kind: 'unavailable' });
  });

  it('answers unavailable without calling Yalies when no API key is configured', async () => {
    process.env.YALIES_API_KEY = '';

    expect(await lookupYalieByNetid('fixturenetid')).toEqual({ kind: 'unavailable' });
    expect(post).not.toHaveBeenCalled();
  });
});
