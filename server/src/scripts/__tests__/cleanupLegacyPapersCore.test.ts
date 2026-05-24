import { describe, expect, it } from 'vitest';
import {
  buildLegacyPaperCleanupReadiness,
  parseCleanupLegacyPapersArgs,
} from '../cleanupLegacyPapersCore';

describe('cleanupLegacyPapersCore', () => {
  it('defaults to dry-run and refuses destructive cleanup without explicit confirmation', () => {
    expect(parseCleanupLegacyPapersArgs([])).toEqual({
      apply: false,
      confirmDropLegacyPapers: false,
    });
  });

  it('parses the explicit apply confirmation flags', () => {
    expect(
      parseCleanupLegacyPapersArgs(['--apply', '--confirm-drop-legacy-papers']),
    ).toEqual({
      apply: true,
      confirmDropLegacyPapers: true,
    });
  });

  it('marks cleanup ready when legacy person and research anchors are covered by compact links', () => {
    const readiness = buildLegacyPaperCleanupReadiness({
      legacyCollections: {
        papers: { exists: true, count: 100 },
        paper_authors: { exists: true, count: 200 },
        paper_entity_links: { exists: true, count: 50 },
      },
      scholarlyLinks: {
        total: 42,
        userLinked: 20,
        entityLinked: 22,
      },
      legacyAnchors: {
        usersWithLegacyPaperEvidence: 20,
        ambiguousUsersSkipped: 0,
        usersMissingScholarlyLinks: 0,
        researchEntitiesWithLegacyPaperEvidence: 22,
        researchEntitiesMissingScholarlyLinks: 0,
      },
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it('blocks cleanup when compact links are missing for legacy anchors', () => {
    const readiness = buildLegacyPaperCleanupReadiness({
      legacyCollections: {
        papers: { exists: true, count: 100 },
        paper_authors: { exists: true, count: 200 },
        paper_entity_links: { exists: true, count: 50 },
      },
      scholarlyLinks: {
        total: 12,
        userLinked: 9,
        entityLinked: 3,
      },
      legacyAnchors: {
        usersWithLegacyPaperEvidence: 11,
        ambiguousUsersSkipped: 0,
        usersMissingScholarlyLinks: 2,
        researchEntitiesWithLegacyPaperEvidence: 7,
        researchEntitiesMissingScholarlyLinks: 4,
      },
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual([
      '2 legacy user paper anchor(s) do not have compact scholarly links.',
      '4 legacy research-entity paper anchor(s) do not have compact scholarly links.',
    ]);
  });

  it('treats already-absent legacy collections as cleaned up', () => {
    const readiness = buildLegacyPaperCleanupReadiness({
      legacyCollections: {
        papers: { exists: false, count: 0 },
        paper_authors: { exists: false, count: 0 },
        paper_entity_links: { exists: false, count: 0 },
      },
      scholarlyLinks: {
        total: 0,
        userLinked: 0,
        entityLinked: 0,
      },
      legacyAnchors: {
        usersWithLegacyPaperEvidence: 0,
        ambiguousUsersSkipped: 0,
        usersMissingScholarlyLinks: 0,
        researchEntitiesWithLegacyPaperEvidence: 0,
        researchEntitiesMissingScholarlyLinks: 0,
      },
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it('does not block cleanup for ambiguous external-identity users skipped by policy', () => {
    const readiness = buildLegacyPaperCleanupReadiness({
      legacyCollections: {
        papers: { exists: true, count: 100 },
        paper_authors: { exists: true, count: 200 },
        paper_entity_links: { exists: true, count: 0 },
      },
      scholarlyLinks: {
        total: 25,
        userLinked: 25,
        entityLinked: 0,
      },
      legacyAnchors: {
        usersWithLegacyPaperEvidence: 50,
        ambiguousUsersSkipped: 25,
        usersMissingScholarlyLinks: 0,
        researchEntitiesWithLegacyPaperEvidence: 0,
        researchEntitiesMissingScholarlyLinks: 0,
      },
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });
});
