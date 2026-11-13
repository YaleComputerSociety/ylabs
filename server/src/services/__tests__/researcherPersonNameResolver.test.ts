import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  normalizeOrcid,
  resolveResearcherIdForOrcid,
  resolveResearcherIdForPersonName,
  type ResearcherNameCandidate,
} from '../researcherPersonNameResolver';
import { syntheticPersonOrcid } from '../../test/syntheticOrcid';

const SYNTHETIC_ORCID_1 = syntheticPersonOrcid(500);

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

  it('does not bind a given name to a longer one it merely prefixes (#5324)', async () => {
    for (const [observed, stored] of [
      ['Lo Quennard', 'Lorvan-Tei Quennard'],
      ['Ali Quennard', 'Alice Quennard'],
      ['Christo Quennard', 'Christopher Quennard'],
    ]) {
      const storedCandidate = candidate(stored);
      const result = await resolveResearcherIdForPersonName(observed, {
        deps: depsFor([storedCandidate]),
      });
      expect(result).toEqual({ status: 'ambiguous', ambiguousCandidates: [storedCandidate] });
    }
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
      const couldBeTheSamePerson = candidate(other);
      const result = await resolveResearcherIdForPersonName('Mara Quillfeather', {
        deps: depsFor([candidate('Jonas Quillfeather'), couldBeTheSamePerson]),
      });
      expect(result).toEqual({ status: 'ambiguous', ambiguousCandidates: [couldBeTheSamePerson] });
    }
  });

  it('is ambiguous when two candidates share surname and given name', async () => {
    const twins = [candidate('John Smith'), candidate('John Smith')];
    const result = await resolveResearcherIdForPersonName('John Smith', {
      deps: depsFor([...twins, candidate('Jane Smith')]),
    });
    expect(result).toEqual({ status: 'ambiguous', ambiguousCandidates: twins });
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
  const ORCID = SYNTHETIC_ORCID_1;

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

describe('resolveResearcherIdForPersonName breaks a name tie only on identity evidence (#5875)', () => {
  const YEAR_RUN_ORCID = '2025-2024-2023-2022';
  const withIdentity = (
    displayName: string,
    identifiers: ResearcherNameCandidate['identifiers'],
  ): ResearcherNameCandidate => ({ ...candidate(displayName), identifiers });

  it('joins the one tied candidate holding the observed email', async () => {
    const holder = withIdentity('Mara Quillfeather', { email: 'mara.quillfeather@example.edu' });
    const namesake = withIdentity('Mara Quillfeather', { email: 'm.q@example.org' });
    const result = await resolveResearcherIdForPersonName('Mara Quillfeather', {
      identity: { emails: [' Mara.Quillfeather@Example.edu '] },
      deps: depsFor([namesake, holder]),
    });
    expect(result).toEqual({ status: 'matched', researcherId: holder._id });
  });

  it('joins the one tied candidate holding the observed plausible ORCID', async () => {
    const holder = withIdentity('Mara Quillfeather', { orcid: SYNTHETIC_ORCID_1 });
    const namesake = withIdentity('Mara Quillfeather', {});
    const result = await resolveResearcherIdForPersonName('Mara Quillfeather', {
      identity: { orcid: `https://orcid.org/${SYNTHETIC_ORCID_1}` },
      deps: depsFor([holder, namesake]),
    });
    expect(result).toEqual({ status: 'matched', researcherId: holder._id });
  });

  it('keeps a tie refused when the key carries no identity evidence', async () => {
    const twins = [
      withIdentity('Mara Quillfeather', { email: 'one@example.edu', orcid: SYNTHETIC_ORCID_1 }),
      withIdentity('Mara Quillfeather', { netid: 'zz9' }),
    ];
    const result = await resolveResearcherIdForPersonName('Mara Quillfeather', {
      identity: { emails: [], orcid: undefined },
      deps: depsFor(twins),
    });
    expect(result).toEqual({ status: 'ambiguous', ambiguousCandidates: twins });
  });

  it('refuses the year-run ORCID as a witness even though its check digit computes', async () => {
    const holder = withIdentity('Mara Quillfeather', { orcid: YEAR_RUN_ORCID });
    const namesake = withIdentity('Mara Quillfeather', {});
    const result = await resolveResearcherIdForPersonName('Mara Quillfeather', {
      identity: { orcid: YEAR_RUN_ORCID },
      deps: depsFor([holder, namesake]),
    });
    expect(result).toEqual({ status: 'ambiguous', ambiguousCandidates: [holder, namesake] });
  });

  it('refuses a witnessed email when the same candidate holds another netid', async () => {
    const holder = withIdentity('Mara Quillfeather', { email: 'shared@example.edu', netid: 'zz9' });
    const namesake = withIdentity('Mara Quillfeather', {});
    const result = await resolveResearcherIdForPersonName('Mara Quillfeather', {
      netid: 'mq42',
      identity: { emails: ['shared@example.edu'] },
      deps: depsFor([holder, namesake]),
    });
    expect(result.status).toBe('ambiguous');
    expect(result.researcherId).toBeUndefined();
    expect(result.everyCandidateNamesSomeoneElse).toBeUndefined();
  });

  it('refuses when two tied candidates share the witnessed email', async () => {
    const twins = [
      withIdentity('Mara Quillfeather', { email: 'shared@example.edu' }),
      withIdentity('Mara Quillfeather', { email: 'shared@example.edu' }),
    ];
    const result = await resolveResearcherIdForPersonName('Mara Quillfeather', {
      identity: { emails: ['shared@example.edu'] },
      deps: depsFor(twins),
    });
    expect(result).toEqual({ status: 'ambiguous', ambiguousCandidates: twins });
  });

  it('keeps an exact tie refused while an initial-only namesake could still be this person', async () => {
    const tiedA = withIdentity('Michael Quillfeather', { netid: 'mq1' });
    const tiedB = withIdentity('Michael Quillfeather', { netid: 'mq2' });
    const initialOnly = withIdentity('M. Quillfeather', {});
    const result = await resolveResearcherIdForPersonName('Mike Quillfeather', {
      netid: 'mq42',
      deps: depsFor([tiedA, tiedB, initialOnly]),
    });
    expect(result).toEqual({ status: 'ambiguous', ambiguousCandidates: [tiedA, tiedB] });
  });

  it('keeps an exact tie refused when every namesake holds another netid and the key has only a netid', async () => {
    const tiedA = withIdentity('Michael Quillfeather', { netid: 'mq1' });
    const tiedB = withIdentity('Michael Quillfeather', { netid: 'mq2' });
    const initialOnly = withIdentity('M. Quillfeather', { netid: 'mq3' });
    const result = await resolveResearcherIdForPersonName('Mike Quillfeather', {
      netid: 'mq42',
      deps: depsFor([tiedA, tiedB, initialOnly]),
    });
    expect(result).toEqual({ status: 'ambiguous', ambiguousCandidates: [tiedA, tiedB] });
  });

  it('reads a prefix-sharing namesake holding another netid as someone else', async () => {
    const namesake = withIdentity('Jonas Mar Quillfeather', { netid: 'jq7' });
    const result = await resolveResearcherIdForPersonName('Mara Quillfeather', {
      netid: 'mq42',
      deps: depsFor([namesake]),
    });
    expect(result).toEqual({ status: 'ambiguous', everyCandidateNamesSomeoneElse: true });
  });

  it('still keeps the prefix-sharing namesake a possible match without a witness', async () => {
    const namesake = withIdentity('Jonas Mar Quillfeather', { netid: 'jq7' });
    const result = await resolveResearcherIdForPersonName('Mara Quillfeather', {
      deps: depsFor([namesake]),
    });
    expect(result).toEqual({ status: 'ambiguous', ambiguousCandidates: [namesake] });
  });

  it('converges on the minted record and stays there on every later pass', async () => {
    const namesake = withIdentity('Jonas Mar Quillfeather', { netid: 'jq7' });
    const opts = { netid: 'mq42', identity: { emails: ['mara.quillfeather@example.edu'] } };
    const first = await resolveResearcherIdForPersonName('Mara Quillfeather', {
      ...opts,
      deps: depsFor([namesake]),
    });
    expect(first).toEqual({ status: 'ambiguous', everyCandidateNamesSomeoneElse: true });

    const minted = withIdentity('Mara Quillfeather', {
      netid: 'mq42',
      email: 'mara.quillfeather@example.edu',
    });
    const afterMint = depsFor([namesake, minted], { mq42: minted._id as mongoose.Types.ObjectId });
    const second = await resolveResearcherIdForPersonName('Mara Quillfeather', {
      ...opts,
      deps: afterMint,
    });
    const third = await resolveResearcherIdForPersonName('Mara Quillfeather', {
      ...opts,
      deps: afterMint,
    });
    expect(second).toEqual({ status: 'matched', researcherId: minted._id });
    expect(third).toEqual(second);
  });
});
