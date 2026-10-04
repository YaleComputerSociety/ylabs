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

const regexFilteringDepsFor = (candidates: ResearcherNameCandidate[]) => ({
  findResearchersBySurname: async (surnameRegex: RegExp) =>
    candidates.filter((stored) => surnameRegex.test(stored.displayName || '')),
  resolveResearcherIdByNetid: async () => undefined,
});

describe('resolveResearcherIdForPersonName against the stored spelling', () => {
  it('finds a researcher whose stored surname carries an accent or apostrophe', async () => {
    for (const name of ['Lucía Varénkov', "Tomas D'Arvellin", 'Pelin Kıraçel']) {
      const stored = candidate(name);
      const result = await resolveResearcherIdForPersonName(name, {
        deps: regexFilteringDepsFor([stored, candidate('Jane Adams')]),
      });
      expect(result).toEqual({ status: 'matched', researcherId: stored._id });
    }
  });

  it('reports two stored copies of an accented name as ambiguous rather than absent', async () => {
    const result = await resolveResearcherIdForPersonName('Lucía Varénkov', {
      deps: regexFilteringDepsFor([candidate('Lucía Varénkov'), candidate('Lucía Varénkov')]),
    });
    expect(result.status).toBe('ambiguous');
  });

  it('sees a stored single-token researcher when looking up its own name', async () => {
    const result = await resolveResearcherIdForPersonName('Quorvel', {
      deps: regexFilteringDepsFor([candidate('Quorvel')]),
    });
    expect(result).toEqual({ status: 'ambiguous' });
  });

  it('does not let a bare-surname record make a full-name lookup ambiguous', async () => {
    const result = await resolveResearcherIdForPersonName('Ana Quorvel', {
      deps: regexFilteringDepsFor([candidate('Quorvel')]),
    });
    expect(result).toEqual({ status: 'absent' });
  });
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

  it('marks an ambiguous name whose every same-surname candidate is someone else (#4388)', async () => {
    const result = await resolveResearcherIdForPersonName('Mara Quillfeather', {
      deps: depsFor([candidate('Jonas Quillfeather'), candidate('Pell Quillfeather')]),
    });
    expect(result).toEqual({ status: 'ambiguous', everyCandidateNamesSomeoneElse: true });
  });

  it('does not mark a name when one candidate could be the same person (#4388)', async () => {
    for (const other of ['M. Quillfeather', 'M. J. Quillfeather']) {
      const result = await resolveResearcherIdForPersonName('Mara Quillfeather', {
        deps: depsFor([candidate('Jonas Quillfeather'), candidate(other)]),
      });
      expect(result).toEqual({ status: 'ambiguous' });
    }
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
});
