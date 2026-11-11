import { describe, expect, it } from 'vitest';
import { shouldIgnoreObservationForEntityMaterialization } from '../entityMaterializer';
import { computeResearchEntityStudentVisibility } from '../../services/studentVisibilityTier';

const SENTENCE_NAME = 'Thank you for your interest in the Orrery Institute (OI).';
const CLEAN_NAME = 'Orrery Institute for Fictional Microbes';
const LANES = [
  'lab-site-research-read',
  'official-profile-pi-backfill',
  'centers-institutes-index',
  'dept-faculty-roster',
  'ysm-faculty-directory',
];

const ignored = (sourceName: string, field: string, value: unknown) =>
  shouldIgnoreObservationForEntityMaterialization('researchEntity', { sourceName, field, value });

describe('a sentence-shaped research row name, from any lane (#5739)', () => {
  it('is ignored at materialize for name and displayName from every lane', () => {
    for (const lane of LANES) {
      expect(ignored(lane, 'name', SENTENCE_NAME)).toBe(true);
      expect(ignored(lane, 'displayName', SENTENCE_NAME)).toBe(true);
    }
  });

  it('leaves an ordinary name from every lane alone', () => {
    for (const lane of LANES) {
      expect(ignored(lane, 'name', CLEAN_NAME)).toBe(false);
      expect(ignored(lane, 'displayName', CLEAN_NAME)).toBe(false);
    }
  });

  it('leaves the same text alone in a field that is not a name', () => {
    expect(ignored('lab-site-research-read', 'shortDescription', SENTENCE_NAME)).toBe(false);
  });

  it('decides the same way on a second call', () => {
    expect([
      ignored('lab-site-research-read', 'name', SENTENCE_NAME),
      ignored('lab-site-research-read', 'name', SENTENCE_NAME),
    ]).toEqual([true, true]);
  });
});

describe('a row still headed by a sentence-shaped name', () => {
  const reasonsFor = (name: string, sourceName: string) =>
    computeResearchEntityStudentVisibility({
      leadMembers: [{ userId: 'user-fixture-lead', role: 'director' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      entity: {
        slug: 'fixture-orrery-institute',
        name,
        kind: 'institute',
        entityType: 'INSTITUTE',
        websiteUrl: 'https://orrery.example.yale.edu/',
        sourceUrls: ['https://orrery.example.yale.edu/'],
        fieldProvenance: { name: { sourceName, sourceUrl: 'https://orrery.example.yale.edu/' } },
        activeAtYaleCache: true,
      },
    }).reasons;

  it('is held as an unusable name whichever lane named it', () => {
    for (const lane of LANES) {
      expect(reasonsFor(SENTENCE_NAME, lane)).toContain('unusable_name');
    }
  });

  it('is not held on that ground under an ordinary name', () => {
    expect(reasonsFor(CLEAN_NAME, 'lab-site-research-read')).not.toContain('unusable_name');
  });
});
