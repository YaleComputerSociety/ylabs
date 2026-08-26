import { describe, expect, it, vi } from 'vitest';
import {
  buildFacultyMemberIdentity,
  emptyFacultyProjectionSummary,
  projectSingleFacultyIdentity,
  type FacultyProjectionDeps,
} from '../facultyResearcherProjection';

const makeDeps = (overrides: Partial<FacultyProjectionDeps> = {}): FacultyProjectionDeps => ({
  isOrganizationalMailbox: () => false,
  resolveExisting: async () => undefined,
  resolveOrCreate: async () => 'researcher-id',
  ...overrides,
});

describe('buildFacultyMemberIdentity', () => {
  it('joins first and last name into a display name', () => {
    const identity = buildFacultyMemberIdentity({
      netid: 'abc12',
      email: 'abc12@yale.edu',
      orcid: '0000-0001-2345-6789',
      fname: 'Ada',
      lname: 'Lovelace',
    });
    expect(identity).toEqual({
      netid: 'abc12',
      email: 'abc12@yale.edu',
      orcid: '0000-0001-2345-6789',
      displayName: 'Ada Lovelace',
    });
  });

  it('omits the display name when both name parts are missing', () => {
    const identity = buildFacultyMemberIdentity({ netid: 'xyz99', email: 'xyz99@yale.edu' });
    expect(identity.displayName).toBeUndefined();
  });
});

describe('projectSingleFacultyIdentity', () => {
  const identity = buildFacultyMemberIdentity({
    netid: 'abc12',
    email: 'abc12@yale.edu',
    fname: 'Ada',
    lname: 'Lovelace',
  });

  it('counts an organizational mailbox as skipped and never resolves', async () => {
    const resolveOrCreate = vi.fn(async () => 'researcher-id');
    const summary = emptyFacultyProjectionSummary(false);
    await projectSingleFacultyIdentity(
      identity,
      summary,
      makeDeps({ isOrganizationalMailbox: () => true, resolveOrCreate }),
    );
    expect(summary.skippedOrganizationalMailbox).toBe(1);
    expect(resolveOrCreate).not.toHaveBeenCalled();
  });

  it('counts a newly created researcher in apply mode', async () => {
    const summary = emptyFacultyProjectionSummary(false);
    await projectSingleFacultyIdentity(identity, summary, makeDeps());
    expect(summary.created).toBe(1);
    expect(summary.alreadyLinked).toBe(0);
  });

  it('counts an existing researcher as already linked in apply mode', async () => {
    const summary = emptyFacultyProjectionSummary(false);
    await projectSingleFacultyIdentity(
      identity,
      summary,
      makeDeps({ resolveExisting: async () => 'existing-id' }),
    );
    expect(summary.alreadyLinked).toBe(1);
    expect(summary.created).toBe(0);
  });

  it('counts an unresolvable identity as skipped in apply mode', async () => {
    const summary = emptyFacultyProjectionSummary(false);
    await projectSingleFacultyIdentity(
      identity,
      summary,
      makeDeps({ resolveOrCreate: async () => undefined }),
    );
    expect(summary.skippedUnresolvable).toBe(1);
    expect(summary.created).toBe(0);
  });

  it('never writes in dry-run mode but still projects the would-create count', async () => {
    const resolveOrCreate = vi.fn(async () => 'researcher-id');
    const summary = emptyFacultyProjectionSummary(true);
    await projectSingleFacultyIdentity(identity, summary, makeDeps({ resolveOrCreate }));
    expect(summary.created).toBe(1);
    expect(resolveOrCreate).not.toHaveBeenCalled();
  });

  it('counts an existing researcher as already linked in dry-run mode', async () => {
    const summary = emptyFacultyProjectionSummary(true);
    await projectSingleFacultyIdentity(
      identity,
      summary,
      makeDeps({ resolveExisting: async () => 'existing-id' }),
    );
    expect(summary.alreadyLinked).toBe(1);
    expect(summary.created).toBe(0);
  });
});
