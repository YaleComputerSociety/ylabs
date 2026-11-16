import fs from 'fs';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildMeshNaturalOrderMap,
  MESH_SOURCE_NOTE,
  readMeshDescriptors,
  type MeshDescriptorStrings,
} from '../../scripts/generateMeshNaturalOrderMap';
import meshNaturalOrderHeadings from '../data/meshNaturalOrderHeadings.json';
import {
  naturalOrderMeshHeading,
  setMeshNaturalOrderHeadingsForTesting,
} from '../meshNaturalOrder';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
  partitionResearchAreas,
} from '../researchAreaCanonicalization';

const canonicalizer = createResearchAreaCanonicalizer(buildResearchAreaResolverIndex([]));
const admitted = (raw: string[]) => partitionResearchAreas(canonicalizer, raw).admitted;

afterEach(() => setMeshNaturalOrderHeadingsForTesting(null));

describe('MeSH natural-order headings (#6358)', () => {
  it('rewrites a mapped inverted heading, case-insensitively and trimmed, on every read', () => {
    expect(naturalOrderMeshHeading('Carcinoma, Hepatocellular')).toBe('Hepatocellular Carcinoma');
    expect(naturalOrderMeshHeading('  carcinoma, hepatocellular ')).toBe(
      'Hepatocellular Carcinoma',
    );
    expect(admitted(['Carcinoma, Hepatocellular'])).toEqual(['Hepatocellular Carcinoma']);
  });

  it('leaves a comma phrase MeSH does not list unchanged', () => {
    expect(naturalOrderMeshHeading('diversity, equity, and inclusion')).toBe(
      'diversity, equity, and inclusion',
    );
    expect(admitted(['diversity, equity, and inclusion'])).toEqual([
      'diversity, equity, and inclusion',
    ]);
  });

  it('leaves a two-comma list heading unchanged', () => {
    expect(admitted(['Health Care Quality, Access, and Evaluation'])).toEqual([
      'Health Care Quality, Access, and Evaluation',
    ]);
  });

  it('leaves an "as Topic" heading unchanged', () => {
    expect(admitted(['Clinical Trials, Phase I as Topic'])).toEqual([
      'Clinical Trials, Phase I as Topic',
    ]);
  });

  it('collapses the inverted and natural forms on one row to one topic', () => {
    expect(admitted(['Carcinoma, Hepatocellular', 'Hepatocellular Carcinoma'])).toEqual([
      'Hepatocellular Carcinoma',
    ]);
    expect(admitted(['Hepatocellular Carcinoma', 'carcinoma, hepatocellular'])).toEqual([
      'Hepatocellular Carcinoma',
    ]);
  });

  it('rewrites before the #6361 non-subject filter, so a heading that reads as one is dropped', () => {
    setMeshNaturalOrderHeadingsForTesting({
      'Analysis, Data': { natural: 'Data Analysis', descriptorUI: 'D999999' },
    });

    const partition = partitionResearchAreas(canonicalizer, ['Analysis, Data', 'Neuroscience']);

    expect(partition.admitted).toEqual(['Neuroscience']);
    expect(partition.dropped).toEqual(['Data Analysis']);
  });

  it('matches an inverted catalog label from either spelling and resolves it to the natural order', () => {
    const catalog = createResearchAreaCanonicalizer(
      buildResearchAreaResolverIndex([
        { name: 'Carcinoma, Hepatocellular', aliases: ['Liver Cell Carcinoma'] },
      ]),
    );

    expect(
      catalog.canonicalizeResearchAreas(['Carcinoma, Hepatocellular', 'Liver Cell Carcinoma']),
    ).toEqual({ values: ['Hepatocellular Carcinoma'], unmatched: [], dropped: [] });
    expect(catalog.matchCanonicalResearchAreas(['Hepatocellular Carcinoma'])).toEqual([
      'Hepatocellular Carcinoma',
    ]);
    expect(catalog.deriveResearchAreasFromText('Studies hepatocellular carcinoma.')).toEqual([
      'Hepatocellular Carcinoma',
    ]);
  });

  it('ships the 2026 map with NLM attribution and a descriptor UI per entry', () => {
    const data = meshNaturalOrderHeadings as {
      meshYear: number;
      source: string;
      headings: Record<string, { natural: string; descriptorUI: string }>;
    };
    expect(data.meshYear).toBe(2026);
    expect(data.source).toBe(MESH_SOURCE_NOTE);
    expect(data.source).toContain('U.S. National Library of Medicine');
    expect(Object.keys(data.headings)).toHaveLength(159);
    for (const entry of Object.values(data.headings)) {
      expect(entry.descriptorUI).toMatch(/^D\d+$/);
    }
  });
});

const descriptorRecord = (ui: string, name: string, terms: string[], extra = '') => `
  <DescriptorRecord DescriptorClass="1">
    <DescriptorUI>${ui}</DescriptorUI>
    <DescriptorName><String>${name}</String></DescriptorName>
    ${extra}
    <ConceptList>
      <Concept PreferredConceptYN="Y">
        <ConceptUI>M${ui}</ConceptUI>
        <ConceptName><String>${name}</String></ConceptName>
        <TermList>
          ${terms.map((term) => `<Term ConceptPreferredTermYN="N"><TermUI>T1</TermUI><String>${term}</String></Term>`).join('\n          ')}
        </TermList>
      </Concept>
    </ConceptList>
  </DescriptorRecord>`;

const FIXTURE_XML = `<?xml version="1.0"?>
<!DOCTYPE DescriptorRecordSet SYSTEM "desc2026.dtd">
<DescriptorRecordSet LanguageCode="eng">
${descriptorRecord('D000001', 'Carcinoma, Hepatocellular', ['Carcinoma, Hepatocellular', 'Hepatocellular Carcinoma', 'Liver Cell Carcinoma'])}
${descriptorRecord('D000002', 'Alpha, Beta, Gamma', ['Beta Gamma Alpha', 'Gamma Alpha Beta'])}
${descriptorRecord('D000003', 'Neoplasms, Fixture', ['Fixture Tumors', 'Tumors &amp; Fixtures'])}
${descriptorRecord(
  'D000004',
  'Antineoplastic Fixtures',
  ['Antineoplastic Fixtures'],
  '<PharmacologicalActionList><PharmacologicalAction><DescriptorReferredTo><DescriptorUI>D000001</DescriptorUI><DescriptorName><String>Carcinoma, Hepatocellular</String></DescriptorName></DescriptorReferredTo></PharmacologicalAction></PharmacologicalActionList>',
)}
</DescriptorRecordSet>
`;

describe('generateMeshNaturalOrderMap (#6358)', () => {
  const read = async (
    fileName: string,
    body: Buffer | string,
  ): Promise<MeshDescriptorStrings[]> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-mesh-fixture-'));
    try {
      const file = path.join(dir, fileName);
      fs.writeFileSync(file, body);
      const descriptors: MeshDescriptorStrings[] = [];
      for await (const descriptor of readMeshDescriptors(file)) descriptors.push(descriptor);
      return descriptors;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('emits an exact reordering, refuses an ambiguous case, and skips a non-reordering entry term', async () => {
    const descriptors = await read('desc2026.gz', gzipSync(FIXTURE_XML));
    expect(descriptors.map((descriptor) => descriptor.descriptorUI)).toEqual([
      'D000001',
      'D000002',
      'D000003',
      'D000004',
    ]);
    expect(descriptors[2].entryTerms).toContain('Tumors & Fixtures');

    const { map, ambiguous } = buildMeshNaturalOrderMap(
      descriptors,
      ['Carcinoma, Hepatocellular', 'Alpha, Beta, Gamma', 'Neoplasms, Fixture'],
      2026,
    );

    expect(map.meshYear).toBe(2026);
    expect(map.source).toBe(MESH_SOURCE_NOTE);
    expect(map.headings).toEqual({
      'Carcinoma, Hepatocellular': { natural: 'Hepatocellular Carcinoma', descriptorUI: 'D000001' },
    });
    expect(ambiguous).toEqual([
      {
        heading: 'Alpha, Beta, Gamma',
        candidates: ['Beta Gamma Alpha', 'Gamma Alpha Beta'],
        descriptorUIs: ['D000002'],
      },
    ]);
    expect(map.unmappedHeadings).toEqual(['Neoplasms, Fixture']);
  });

  it("reads only a record's own name, so a referenced descriptor's name does not make it ambiguous", async () => {
    const descriptors = await read('desc2026.xml', FIXTURE_XML);
    const referencing = descriptors.find((descriptor) => descriptor.descriptorUI === 'D000004');
    expect(referencing?.descriptorName).toBe('Antineoplastic Fixtures');
    expect(referencing?.entryTerms).toEqual(['Antineoplastic Fixtures']);
  });
});
