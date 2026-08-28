import { describe, expect, it } from 'vitest';
import {
  PRESERVED_OBSERVATION_ENTITY_TYPES,
  RETIRED_OBSERVATION_ENTITY_TYPES,
  assertRetirePublicationSurfacesInvariants,
  assertScholarlyLinksAreUnattachable,
} from '../retirePublicationSurfacesCore';

const preservedCounts = {
  researchEntity: 183029,
  researchEntityRelationship: 57065,
  fellowship: 31202,
  user: 420504,
  researchGroupMember: 50774,
};

describe('retirePublicationSurfacesCore', () => {
  it('retires only the publication observation lanes', () => {
    expect([...RETIRED_OBSERVATION_ENTITY_TYPES]).toEqual(['paper', 'scholarlyLink']);
  });

  it('preserves the live person and roster observation lanes', () => {
    expect([...PRESERVED_OBSERVATION_ENTITY_TYPES]).toContain('user');
    expect([...PRESERVED_OBSERVATION_ENTITY_TYPES]).toContain('researchGroupMember');
  });

  it('allows retirement when every scholarly link is unattachable', () => {
    expect(() =>
      assertScholarlyLinksAreUnattachable({
        totalLinks: 1116,
        linksWithResearchEntityId: 0,
        linksWithResolvableOwner: 0,
      }),
    ).not.toThrow();
  });

  it('refuses when any scholarly link is servable via researchEntityId', () => {
    expect(() =>
      assertScholarlyLinksAreUnattachable({
        totalLinks: 1116,
        linksWithResearchEntityId: 3,
        linksWithResolvableOwner: 0,
      }),
    ).toThrow(/3 of 1116 scholarly links carry a researchEntityId/);
  });

  it('refuses when any scholarly link resolves to a live owner', () => {
    expect(() =>
      assertScholarlyLinksAreUnattachable({
        totalLinks: 1116,
        linksWithResearchEntityId: 0,
        linksWithResolvableOwner: 7,
      }),
    ).toThrow(/7 of 1116 scholarly links resolve to a Researcher or Account owner/);
  });

  it('passes invariants when only retired lanes were removed', () => {
    expect(() =>
      assertRetirePublicationSurfacesInvariants({
        retiredObservationsAfter: 0,
        preservedObservationsBefore: preservedCounts,
        preservedObservationsAfter: preservedCounts,
        remainingScholarlyCollections: [],
      }),
    ).not.toThrow();
  });

  it('fails when retired observations survive apply', () => {
    expect(() =>
      assertRetirePublicationSurfacesInvariants({
        retiredObservationsAfter: 12,
        preservedObservationsBefore: preservedCounts,
        preservedObservationsAfter: preservedCounts,
        remainingScholarlyCollections: [],
      }),
    ).toThrow(/12 retired-type observations remain/);
  });

  it('fails when a scholarly collection survives apply', () => {
    expect(() =>
      assertRetirePublicationSurfacesInvariants({
        retiredObservationsAfter: 0,
        preservedObservationsBefore: preservedCounts,
        preservedObservationsAfter: preservedCounts,
        remainingScholarlyCollections: ['research_scholarly_links'],
      }),
    ).toThrow(/research_scholarly_links/);
  });

  it('fails when the live person lane loses rows', () => {
    expect(() =>
      assertRetirePublicationSurfacesInvariants({
        retiredObservationsAfter: 0,
        preservedObservationsBefore: preservedCounts,
        preservedObservationsAfter: { ...preservedCounts, user: 0 },
        remainingScholarlyCollections: [],
      }),
    ).toThrow(/user observations changed from 420504 to 0/);
  });

  it('fails when the live roster lane loses rows', () => {
    expect(() =>
      assertRetirePublicationSurfacesInvariants({
        retiredObservationsAfter: 0,
        preservedObservationsBefore: preservedCounts,
        preservedObservationsAfter: { ...preservedCounts, researchGroupMember: 40000 },
        remainingScholarlyCollections: [],
      }),
    ).toThrow(/researchGroupMember observations changed from 50774 to 40000/);
  });
});
