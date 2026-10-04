import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  normalizeOrcid,
  resolveResearcherIdForOrcid,
  resolveResearcherIdForPersonName,
  type ResearcherNameCandidate,
} from '../researcherPersonNameResolver';

const candidate = (displayName: string): ResearcherNameCandidate => ({
  _id: new mongoose.Types.ObjectId(),
  displayName,
});

const depsFor = (
  candidates: ResearcherNameCandidate[],
  netidResolution?: Record<string, mongoose.Types.ObjectId>,
) => ({
  findResearchersBySurname: async () => candidates,
  resolveResearcherIdByNetid: async (netid: string) => netidResolution?.[netid],
});

describe('resolveResearcherIdForPersonName', () => {
  it('resolves by netid before any name matching', async () => {
    const researcherId = new mongoose.Types.ObjectId();
    const result = await resolveResearcherIdForPersonName('Ignored Name', {
      netid: '  AB123 ',
      deps: depsFor([], { ab123: researcherId }),
    });
    expect(result).toEqual({ status: 'matched', researcherId });
  });

  it('falls through to name matching when the netid does not resolve', async () => {
    const smith = candidate('John Smith');
    const result = await resolveResearcherIdForPersonName('John Smith', {
      netid: 'unknown',
      deps: depsFor([smith]),
    });
    expect(result).toEqual({ status: 'matched', researcherId: smith._id });
  });

  it('matches an exact full name', async () => {
    const smith = candidate('John Smith');
    const result = await resolveResearcherIdForPersonName('John Smith', {
      deps: depsFor([smith, candidate('Jane Adams')]),
    });
    expect(result).toEqual({ status: 'matched', researcherId: smith._id });
  });

  it('matches a known nickname to its formal given name', async () => {
    const robert = candidate('Robert Smith');
    const result = await resolveResearcherIdForPersonName('Bob Smith', {
      deps: depsFor([robert]),
    });
    expect(result).toEqual({ status: 'matched', researcherId: robert._id });
  });

  it('matches a genuine given-name prefix that is not a nickname', async () => {
    const chris = candidate('Christopher Smith');
    const result = await resolveResearcherIdForPersonName('Christo Smith', {
      deps: depsFor([chris]),
    });
    expect(result).toEqual({ status: 'matched', researcherId: chris._id });
  });

  it('fails closed on a bare first-initial source name (never binds a namesake)', async () => {
    const result = await resolveResearcherIdForPersonName('J Smith', {
      deps: depsFor([candidate('John Smith')]),
    });
    expect(result.status).toBe('ambiguous');
    expect(result.researcherId).toBeUndefined();
  });

  it('is ambiguous when two candidates share surname and given name', async () => {
    const result = await resolveResearcherIdForPersonName('John Smith', {
      deps: depsFor([candidate('John Smith'), candidate('John Smith')]),
    });
    expect(result).toEqual({ status: 'ambiguous' });
  });

  it('fails closed on a surname-only source name with any candidate', async () => {
    const result = await resolveResearcherIdForPersonName('Smith', {
      deps: depsFor([candidate('John Smith')]),
    });
    expect(result).toEqual({ status: 'ambiguous' });
  });

  it('returns absent when no candidate carries the surname', async () => {
    const result = await resolveResearcherIdForPersonName('Xander Nonesuch', {
      deps: depsFor([]),
    });
    expect(result).toEqual({ status: 'absent' });
  });

  it('returns absent for an empty name with no netid', async () => {
    const result = await resolveResearcherIdForPersonName('', { deps: depsFor([]) });
    expect(result).toEqual({ status: 'absent' });
  });

  it('is ambiguous when the surname fetch hits the fetch ceiling', async () => {
    const flooded = Array.from({ length: 200 }, () => candidate('John Smith'));
    const result = await resolveResearcherIdForPersonName('John Smith', {
      deps: depsFor(flooded),
    });
    expect(result).toEqual({ status: 'ambiguous' });
  });
});

describe('resolveResearcherIdForOrcid', () => {
  const ORCID = '0000-0000-0000-0028';
  const orcidDeps = (holders: Record<string, ResearcherNameCandidate>) => ({
    findResearcherByOrcid: async (orcid: string) => holders[orcid],
    findResearchersBySurname: async () => {
      throw new Error('name matching must not run when the ORCID decides');
    },
  });

  it('normalizes a bare or URL ORCID and rejects a bad checksum', () => {
    expect(normalizeOrcid(`https://orcid.org/${ORCID}`)).toBe(ORCID);
    expect(normalizeOrcid(` ${ORCID} `)).toBe(ORCID);
    expect(normalizeOrcid('0000-0000-0000-0029')).toBeUndefined();
    expect(normalizeOrcid(undefined)).toBeUndefined();
  });

  it('matches the researcher holding the ORCID', async () => {
    const holder = candidate('Avery Placeholder');
    const result = await resolveResearcherIdForOrcid(
      `https://orcid.org/${ORCID}`,
      'A. Placeholder',
      {
        findResearcherByOrcid: async (orcid) => (orcid === ORCID ? holder : undefined),
      },
    );
    expect(result).toEqual({ status: 'matched', researcherId: holder._id });
  });

  it('refuses when the ORCID holder carries a different surname than the record names', async () => {
    const result = await resolveResearcherIdForOrcid(ORCID, 'Avery Otherfamily', {
      findResearcherByOrcid: async () => candidate('Avery Placeholder'),
    });
    expect(result).toEqual({ status: 'ambiguous' });
  });

  it('decides the person-name resolution before any name matching', async () => {
    const holder = candidate('Avery Placeholder');
    const result = await resolveResearcherIdForPersonName('Avery Placeholder', {
      orcid: ORCID,
      deps: orcidDeps({ [ORCID]: holder }),
    });
    expect(result).toEqual({ status: 'matched', researcherId: holder._id });
  });

  it('falls back to name matching when no researcher holds the ORCID', async () => {
    const holder = candidate('Avery Placeholder');
    const result = await resolveResearcherIdForPersonName('Avery Placeholder', {
      orcid: ORCID,
      deps: {
        findResearcherByOrcid: async () => undefined,
        findResearchersBySurname: async () => [holder],
      },
    });
    expect(result).toEqual({ status: 'matched', researcherId: holder._id });
  });
});
