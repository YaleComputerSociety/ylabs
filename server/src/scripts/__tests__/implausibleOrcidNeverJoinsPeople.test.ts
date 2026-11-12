import { describe, expect, it, vi } from 'vitest';
import { Observation } from '../../models/observation';
import * as cheerio from 'cheerio';
import { syntheticPersonOrcid, withOrcidCheckDigit } from '../../test/syntheticOrcid';
import {
  buildCanonicalNameIndex,
  decideOfficialPageWitnessFold,
  decideOrcidOnlyHolderFold,
  decideShellMerge,
  orcidOnlyHoldersByOrcid,
  planAliasTwinFolds,
  type OfficialPageCandidate,
} from '../dedupeAccountlessResearcherShellsCore';
import {
  onePersonKeyByAssignment,
  type SurnameClashLeadRow,
} from '../retireSurnameClashLeadGraftsCore';
import { normalizePhase0IdentityValue } from '../phase0IdentityCollisionAuditCore';
import {
  leadMatchesDestinationThroughEvidence,
  pageOrcidByDestinationFromStatements,
} from '../../services/leadMatchEvidence';
import { resolveResearcherIdForOrcid } from '../../services/researcherPersonNameResolver';
import { researcherCarriesIdentityEvidence } from '../../utils/researcherIdentity';
import { orcidWitnessedByAnotherPage } from '../../scrapers/sources/officialProfilePiBackfillScraper';
import { subjectProfileOrcid } from '../../scrapers/utils/rosterMemberIdentityEvidence';

const YEAR_RUN = '2025-2024-2023-2022';
const OUT_OF_RANGE = withOrcidCheckDigit('104973150123456');
const NON_PERSON_VALUES = [YEAR_RUN, OUT_OF_RANGE];
const REAL_A = syntheticPersonOrcid(101);
const REAL_B = syntheticPersonOrcid(102);

describe('a value no person can hold is never a shared identity (#5991)', () => {
  describe.each(NON_PERSON_VALUES)('with the non-person value %s', (bogus) => {
    it('the exact-name arm raises no ORCID_CONFLICT when only one side holds it', () => {
      const index = buildCanonicalNameIndex([
        {
          id: 'survivor',
          displayName: 'Avery Synth',
          email: 'avery.synth@example.test',
          orcid: REAL_A,
        },
      ]);
      expect(decideShellMerge({ displayName: 'Avery Synth', orcid: bogus }, index)).toMatchObject({
        merge: true,
        canonicalId: 'survivor',
      });
      const bogusSurvivor = buildCanonicalNameIndex([
        {
          id: 'survivor',
          displayName: 'Avery Synth',
          email: 'avery.synth@example.test',
          orcid: bogus,
        },
      ]);
      expect(
        decideShellMerge({ displayName: 'Avery Synth', orcid: REAL_A }, bogusSurvivor),
      ).toMatchObject({ merge: true, canonicalId: 'survivor' });
    });

    it('the exact-name arm still refuses two different plausible ORCIDs', () => {
      const index = buildCanonicalNameIndex([
        {
          id: 'survivor',
          displayName: 'Avery Synth',
          email: 'avery.synth@example.test',
          orcid: REAL_A,
        },
      ]);
      expect(decideShellMerge({ displayName: 'Avery Synth', orcid: REAL_B }, index)).toEqual({
        merge: false,
        reason: 'ORCID_CONFLICT',
      });
    });

    it('the ORCID-only arm never folds two different people who both carry it', () => {
      const holders = orcidOnlyHoldersByOrcid([
        { id: 'holder', displayName: 'Blair Synth', orcid: bogus },
      ]);
      expect(holders.size).toBe(0);
      const shell = { id: 'shell', displayName: 'Blair Synth' };
      expect(
        decideOrcidOnlyHolderFold(
          shell,
          [bogus],
          [],
          new Map([[bogus, [{ id: 'holder', displayName: 'Blair Synth' }]]]),
        ),
      ).toBeUndefined();
    });

    it('the ORCID-only arm treats a shell holding it as holding no ORCID', () => {
      const holders = orcidOnlyHoldersByOrcid([
        { id: 'holder', displayName: 'Blair Synth', orcid: REAL_A },
      ]);
      expect(
        decideOrcidOnlyHolderFold(
          { id: 'shell', displayName: 'Blair Synth', orcid: bogus },
          [REAL_A],
          [],
          holders,
        ),
      ).toMatchObject({ merge: true, canonicalId: 'holder' });
    });

    it('the official-page arm takes no witness from a page stating it', () => {
      const holder: OfficialPageCandidate = {
        id: 'directory-holder',
        displayName: 'Casey Synth',
        email: 'casey.synth@yale.edu',
        tier: 'DIRECTORY',
        orcid: bogus,
      };
      expect(
        decideOfficialPageWitnessFold(
          { id: 'shell', displayName: 'Casey Synth' },
          [{ emails: [], orcids: [bogus] }],
          { byEmail: new Map(), byOrcid: new Map([[bogus, [holder]]]) },
        ),
      ).toBeUndefined();
    });

    it('the alias-twin arm raises no orcid conflict from it', () => {
      const plan = planAliasTwinFolds({
        twinResearchers: [{ id: 'twin', netid: 'dsynth', displayName: 'Drew Synth', orcid: bogus }],
        researcherByNetid: new Map([
          ['ds42', { id: 'real', displayName: 'Drew Synth', orcid: REAL_A }],
        ]),
        aliasNetidByTwinNetid: new Map([['dsynth', 'ds42']]),
        loginNetids: new Set(),
      });
      expect(plan.refusals['orcid-conflict']).toBe(0);
      expect(plan.targetByTwinResearcherId.get('twin')).toBe('real');
    });

    it('the surname-clash repair never reads two people as one through it', () => {
      const lead = (personId: string, displayName: string): SurnameClashLeadRow => ({
        assignmentId: `assignment-${personId}`,
        personId,
        displayName,
        identityAnchored: true,
        identity: { orcid: bogus },
        rosterVerified: false,
      });
      const keys = onePersonKeyByAssignment([lead('a', 'Emery Synth'), lead('b', 'Finley Synth')]);
      expect(keys.get('assignment-a')).not.toBe(keys.get('assignment-b'));
    });

    it('the lead-match path matches no lead through it', () => {
      const destination = 'medicine.yale.edu/profile/gray-synth';
      const pageOrcids = pageOrcidByDestinationFromStatements(
        [{ sourceUrl: `https://${destination}/`, value: bogus }],
        new Set([destination]),
      );
      expect(pageOrcids.size).toBe(0);
      expect(
        leadMatchesDestinationThroughEvidence(
          { user: { orcid: bogus }, row: { identityKey: '' } },
          new Set([destination]),
          {
            foldedProfileDestinationsByLeadId: new Map(),
            pageOrcidByDestination: new Map([[destination, bogus]]),
          },
        ),
      ).toBe(false);
    });

    it('the grant ORCID resolver resolves nobody and looks nobody up', async () => {
      let lookups = 0;
      const resolution = await resolveResearcherIdForOrcid(bogus, 'Harper Synth', {
        findResearcherByOrcid: async () => {
          lookups += 1;
          return { _id: '000000000000000000000001', displayName: 'Harper Synth' };
        },
      });
      expect(resolution.status).toBe('absent');
      expect(lookups).toBe(0);
    });

    it('a record holding only it carries no identity evidence', () => {
      expect(researcherCarriesIdentityEvidence({ identifiers: { orcid: bogus } })).toBe(false);
      expect(researcherCarriesIdentityEvidence({ identifiers: { orcid: REAL_A } })).toBe(true);
    });

    it('the identity collision audit reads it as no ORCID', () => {
      expect(normalizePhase0IdentityValue('orcid', bogus)).toBeUndefined();
      expect(normalizePhase0IdentityValue('orcid', `https://orcid.org/${REAL_A}`)).toBe(REAL_A);
    });

    it('the profile backfill never counts it as witnessed by another page', async () => {
      const otherPage = vi.spyOn(Observation, 'find').mockReturnValue({
        select: () => ({
          lean: async () => [
            { value: bogus, sourceUrl: 'https://medicine.yale.edu/profile/indy-synth-2/' },
          ],
        }),
      } as never);
      try {
        await expect(
          orcidWitnessedByAnotherPage(
            { orcid: bogus },
            { netid: 'is42', storedOrcid: bogus },
            'https://medicine.yale.edu/profile/indy-synth/',
          ),
        ).resolves.toBe(false);
      } finally {
        otherPage.mockRestore();
      }
    });

    it('two profile pages that both label it yield no ORCID for either person', () => {
      const pageFor = (name: string) =>
        cheerio.load(`<main><article><h1>${name}</h1><p>ORCID: ${bogus}</p></article></main>`);
      expect(subjectProfileOrcid(pageFor('Jordan Synth'), 'Jordan Synth')).toBeUndefined();
      expect(subjectProfileOrcid(pageFor('Kai Synth'), 'Kai Synth')).toBeUndefined();
    });
  });
});
