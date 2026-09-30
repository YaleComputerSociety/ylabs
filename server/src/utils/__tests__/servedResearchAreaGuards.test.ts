import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { withholdUnservableResearchAreas } from '../servedResearchAreaGuards';

const coherenceContext = {
  name: 'Example Membrane Transport Laboratory',
  departments: ['Cellular and Molecular Physiology'],
  shortDescription: 'Studies membrane transport proteins and ion channel physiology.',
  fullDescription:
    'The laboratory studies membrane transport proteins, ion channel gating, epithelial physiology, and structural biology of transporters using electrophysiology and cryo-electron microscopy.',
};

const meshProfileProvenance = {
  researchAreas: { sourceUrl: 'https://medicine.yale.edu/profile/example-person/' },
};

describe('withholdUnservableResearchAreas', () => {
  it('withholds a MeSH geographic descriptor read from a MeSH-indexed profile', () => {
    expect(
      withholdUnservableResearchAreas(
        ['Ion Channels', 'China', 'Membrane Transport Proteins', 'Connecticut'],
        meshProfileProvenance,
        coherenceContext,
      ),
    ).toEqual(['Ion Channels', 'Membrane Transport Proteins']);
  });

  it('keeps a place name whose provenance is not a MeSH-indexed profile, since an area-studies page names its field', () => {
    const areas = ['China', 'Ion Channels'];
    expect(
      withholdUnservableResearchAreas(
        areas,
        { researchAreas: { sourceUrl: 'https://area-studies.example.edu/people/' } },
        coherenceContext,
      ),
    ).toBe(areas);
  });

  it('drops an unsourced chip that shares no vocabulary with the row', () => {
    expect(
      withholdUnservableResearchAreas(
        ['Membrane Transport', 'Medieval Troubadour Poetry'],
        undefined,
        coherenceContext,
      ),
    ).toEqual(['Membrane Transport']);
  });

  it('runs the MeSH withhold before the coherence guard, so both apply to one row', () => {
    expect(
      withholdUnservableResearchAreas(
        ['Membrane Transport', 'China'],
        meshProfileProvenance,
        coherenceContext,
      ),
    ).toEqual(['Membrane Transport']);
  });

  it('returns the input reference when nothing is withheld, which the serve path reads as unchanged', () => {
    const areas = ['Ion Channels', 'Membrane Transport'];
    expect(withholdUnservableResearchAreas(areas, meshProfileProvenance, coherenceContext)).toBe(
      areas,
    );
  });
});

describe('the served topic guard chain has one owner', () => {
  const serverSrc = path.resolve(__dirname, '..', '..');
  const owner = path.join('utils', 'servedResearchAreaGuards.ts');
  const composedGuardCall =
    /\b(?:dropDomainIncoherentUnsourcedResearchAreas|withoutMeshSourcedGeographicResearchAreas)\s*\(/;
  const guardDefinitions = new Set([
    path.join('utils', 'researchAreaDomainCoherence.ts'),
    path.join('scrapers', 'utils', 'meshGeographicDescriptors.ts'),
  ]);

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        return entry === '__tests__' || entry === 'node_modules' ? [] : sourceFiles(full);
      }
      return /\.ts$/.test(entry) ? [full] : [];
    });

  it('is the only caller of the guards it composes', () => {
    const callers = sourceFiles(serverSrc)
      .map((file) => path.relative(serverSrc, file))
      .filter((relative) => relative !== owner && !guardDefinitions.has(relative))
      .filter((relative) =>
        composedGuardCall.test(readFileSync(path.join(serverSrc, relative), 'utf8')),
      );
    expect(
      callers,
      'call withholdUnservableResearchAreas instead, so the served DTO, the index document, and journey:eval cannot disagree about which topics are served',
    ).toEqual([]);
  });
});
