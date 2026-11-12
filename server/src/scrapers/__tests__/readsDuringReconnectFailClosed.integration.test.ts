import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  countAttestedEmptyLaneReads,
  loadStoredContentHash,
  loadStoredLaneDescription,
  loadStoredLaneDescriptionObservation,
} from '../contentHashGate';
import {
  loadDirectoryNetidsByAddress,
  profilePageOwnerNetids,
  resetDirectoryNetidsByAddressCache,
} from '../directoryContradictedProfileNetid';
import { emitLanePageHealthForCitedPages, loadLanePageHealthObservations } from '../lanePageHealth';
import { loadActiveProseValue, retireEmailsANewerReadReplaced } from '../observationStore';
import {
  loadDirectoryIdentityIndex,
  loadLanePersonObservations,
  loadStoredRuns,
  RekeyedPersonReads,
} from '../rekeyedPersonKeyRetirement';
import {
  liveResearchEntityIdForLaneKey,
  liveResearchEntityNamedByKeyObservations,
  reslugAdoptedKeyNamesOnlyArchivedRows,
  withRenamedResearchEntityIds,
} from '../renamedResearchEntityAdoption';
import { loadResearchTopicsDerivation } from '../researchPageTopicsDerivation';
import { defaultTrackEverListedPis, type BbsTrack } from '../sources/bbsResearchTrackScraper';
import { loadUserKeysWithALiveFacultyTitle } from '../sources/departmentRosterScraper';
import { defaultLiveEvidenceQuoteLoader } from '../sources/labMicrositeUndergradLLMExtractor';
import { defaultLoadLegacyGrantObservations } from '../sources/nihReporterScraper';
import {
  loadKnownPersonSurnameRosterWhenConnected,
  loadYaleDirectoryNetids,
  selectOrganizationDirectorProfileTargets,
} from '../sources/officialProfilePiBackfillScraper';
import { loadConnectedEvidenceUrlCiterCounts } from '../sources/researchPageTextScraper';
import { loadCorpusResearcherNetids } from '../sources/yaleDirectoryScraper';
import { loadLabUrlEvidenceBySlug } from '../utils/labUrlEvidence';
import { pageEmailHeldByAnotherResearcher } from '../verifiedResearcherEmail';
import { isMongoUnavailableError } from '../../db/connections';
import { Observation } from '../../models/observation';
import { rostersWithDepartedLeadsRetired } from '../../services/departedLeadServing';
import { officialProfileLinkHeldByConflictingIdentity } from '../../services/officialProfileLinkIdentity';
import type { ResearchEntityRosterEntry } from '../../services/researchEntityMembershipAccessor';

const LANE = 'reconnect-fixture-lane';
const ENTITY_KEY = 'reef-lab-reconnect-fixture';
const PROFILE_PAGE = 'https://medicine.yale.edu/profile/blair-synthetic/';
const ENTITY = { entityType: 'researchEntity' as const, entityKey: ENTITY_KEY };

function currentLead(personId: mongoose.Types.ObjectId): ResearchEntityRosterEntry {
  return {
    researchEntityId: new mongoose.Types.ObjectId(),
    personId,
    roleAssignmentId: new mongoose.Types.ObjectId(),
    name: 'Synthetic Lead',
    netid: '',
    email: '',
    role: 'pi',
    state: 'CURRENT',
  } as unknown as ResearchEntityRosterEntry;
}

function rekeyedReadsWithOnePage(): RekeyedPersonReads {
  const reads = new RekeyedPersonReads(LANE);
  reads.recordListingRead(PROFILE_PAGE, { complete: true });
  return reads;
}

const BBS_TRACK = {
  slug: 'reconnect-fixture-track',
  url: 'https://medicine.yale.edu/bbs/people/reconnect-fixture-track/',
  researchAreas: ['Synthetic Biology'],
} as unknown as BbsTrack;

const READS_THAT_THROW_DURING_A_RECONNECT: Array<[string, () => Promise<unknown>]> = [
  ['contentHashGate loadStoredContentHash', () => loadStoredContentHash(LANE, ENTITY)],
  [
    'directoryContradictedProfileNetid loadDirectoryNetidsByAddress',
    () => {
      resetDirectoryNetidsByAddressCache();
      return loadDirectoryNetidsByAddress();
    },
  ],
  [
    'directoryContradictedProfileNetid profilePageOwnerNetids',
    () => profilePageOwnerNetids([PROFILE_PAGE], {}, new Map()),
  ],
  [
    'observationStore loadActiveProseValue',
    () => loadActiveProseValue({ ...ENTITY, sourceName: LANE, field: 'fullDescription' }),
  ],
  [
    'observationStore retireEmailsANewerReadReplaced',
    () =>
      retireEmailsANewerReadReplaced(
        [
          {
            _id: new mongoose.Types.ObjectId(),
            entityType: 'user',
            field: 'email',
            entityKey: 'zzk5877',
            sourceUrl: PROFILE_PAGE,
          },
        ],
        {
          scrapeRunId: 'run',
          sourceId: 'source',
          sourceName: LANE,
          sourceWeight: 1,
          dryRun: false,
        },
      ),
  ],
  [
    'researchPageTopicsDerivation loadResearchTopicsDerivation',
    () => loadResearchTopicsDerivation('topics-hash'),
  ],
  [
    'lanePageHealth loadLanePageHealthObservations',
    () => loadLanePageHealthObservations(LANE, ENTITY),
  ],
  [
    'lanePageHealth emitLanePageHealthForCitedPages',
    () =>
      emitLanePageHealthForCitedPages({
        sourceName: LANE,
        scrapeRunId: 'run',
        emit: () => undefined,
        log: () => undefined,
      } as unknown as Parameters<typeof emitLanePageHealthForCitedPages>[0]),
  ],
  [
    'renamedResearchEntityAdoption liveResearchEntityNamedByKeyObservations',
    () => liveResearchEntityNamedByKeyObservations(ENTITY_KEY),
  ],
  [
    'renamedResearchEntityAdoption withRenamedResearchEntityIds',
    () =>
      withRenamedResearchEntityIds([
        { ...ENTITY, field: 'name', value: 'Reef Lab', sourceUrl: '' },
      ]),
  ],
  [
    'renamedResearchEntityAdoption liveResearchEntityIdForLaneKey',
    () => liveResearchEntityIdForLaneKey(ENTITY_KEY),
  ],
  [
    'renamedResearchEntityAdoption reslugAdoptedKeyNamesOnlyArchivedRows',
    () => reslugAdoptedKeyNamesOnlyArchivedRows(ENTITY_KEY),
  ],
  [
    'labMicrositeUndergradLLMExtractor defaultLiveEvidenceQuoteLoader',
    () => defaultLiveEvidenceQuoteLoader(ENTITY_KEY),
  ],
  ['rekeyedPersonKeyRetirement loadLanePersonObservations', () => loadLanePersonObservations(LANE)],
  ['rekeyedPersonKeyRetirement loadDirectoryIdentityIndex', () => loadDirectoryIdentityIndex()],
  [
    'rekeyedPersonKeyRetirement loadStoredRuns',
    () => loadStoredRuns([new mongoose.Types.ObjectId().toString()]),
  ],
  [
    'rekeyedPersonKeyRetirement RekeyedPersonReads.finish',
    () => rekeyedReadsWithOnePage().finish({ scrapeRunId: 'run', dryRun: true }),
  ],
  [
    'departedLeadServing rostersWithDepartedLeadsRetired',
    () =>
      rostersWithDepartedLeadsRetired(
        new Map([
          [
            'row',
            [
              currentLead(new mongoose.Types.ObjectId()),
              currentLead(new mongoose.Types.ObjectId()),
            ],
          ],
        ]),
      ),
  ],
  [
    'verifiedResearcherEmail pageEmailHeldByAnotherResearcher',
    () => pageEmailHeldByAnotherResearcher('blair.synthetic5877@yale.edu', { netid: 'zzk5877' }),
  ],
  [
    'officialProfileLinkIdentity officialProfileLinkHeldByConflictingIdentity',
    () => officialProfileLinkHeldByConflictingIdentity(PROFILE_PAGE, { netid: 'zzk5877' }),
  ],
  [
    'nihReporterScraper defaultLoadLegacyGrantObservations',
    () => defaultLoadLegacyGrantObservations(),
  ],
  ['labUrlEvidence loadLabUrlEvidenceBySlug', () => loadLabUrlEvidenceBySlug([ENTITY_KEY])],
  ['officialProfilePiBackfillScraper loadYaleDirectoryNetids', () => loadYaleDirectoryNetids()],
  [
    'officialProfilePiBackfillScraper selectOrganizationDirectorProfileTargets',
    () => selectOrganizationDirectorProfileTargets(5),
  ],
  [
    'officialProfilePiBackfillScraper loadKnownPersonSurnameRosterWhenConnected',
    () => loadKnownPersonSurnameRosterWhenConnected(),
  ],
  [
    'bbsResearchTrackScraper defaultTrackEverListedPis',
    () => defaultTrackEverListedPis(BBS_TRACK, new mongoose.Types.ObjectId().toString()),
  ],
  [
    'researchPageTextScraper loadConnectedEvidenceUrlCiterCounts',
    () => loadConnectedEvidenceUrlCiterCounts(),
  ],
  ['yaleDirectoryScraper loadCorpusResearcherNetids', () => loadCorpusResearcherNetids()],
  [
    'departmentRosterScraper loadUserKeysWithALiveFacultyTitle',
    () => loadUserKeysWithALiveFacultyTitle(['zzk5877']),
  ],
];

describe('a read during a database reconnect fails closed rather than answering nothing (#5877)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  describe('a read that swallows its own errors still runs while the connection reports down', () => {
    beforeAll(async () => {
      const observedAt = new Date('2026-11-11T00:00:00Z');
      await Observation.collection.insertMany([
        {
          ...ENTITY,
          sourceName: LANE,
          field: 'fullDescription',
          value: 'Studies reef recovery.',
          sourceUrl: PROFILE_PAGE,
          superseded: false,
          observedAt,
        },
        {
          ...ENTITY,
          sourceName: LANE,
          field: 'fullDescription',
          value: '',
          sourceUrl: PROFILE_PAGE,
          assertsNoValueFor: ['fullDescription'],
          superseded: true,
          observedAt,
        },
      ]);
    });

    const reportDisconnected = () =>
      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0 as never);

    it('contentHashGate loadStoredLaneDescription reads the stored description', async () => {
      reportDisconnected();
      expect(await loadStoredLaneDescription(LANE, ENTITY)).toBe('Studies reef recovery.');
    });

    it('contentHashGate loadStoredLaneDescriptionObservation reads the stored description', async () => {
      reportDisconnected();
      expect(await loadStoredLaneDescriptionObservation(LANE, ENTITY)).toEqual({
        value: 'Studies reef recovery.',
        sourceUrl: PROFILE_PAGE,
      });
    });

    it('contentHashGate countAttestedEmptyLaneReads counts the attested empty read', async () => {
      reportDisconnected();
      expect(
        await countAttestedEmptyLaneReads(LANE, ENTITY, PROFILE_PAGE, ['fullDescription']),
      ).toBe(1);
    });
  });

  describe('a read on a connection that was opened and then dropped throws', () => {
    beforeAll(async () => {
      await mongoose.disconnect();
    });

    it.each(READS_THAT_THROW_DURING_A_RECONNECT)('%s', async (_name, read) => {
      const failure = await read().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(isMongoUnavailableError(failure), String(failure)).toBe(true);
    });
  });
});
