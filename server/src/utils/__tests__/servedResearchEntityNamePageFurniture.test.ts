import { describe, expect, it } from 'vitest';
import {
  classifyHarvestedResearchHomeName,
  servedResearchEntityNameWithoutPageFurniture,
} from '../researchHomeNameIdentityAuthority';
import { sanitizeServedResearchEntityCopyFields } from '../researchEntityDescriptionText';
import { buildResearchEntitySearchIndexDocument } from '../../services/researchEntitySearchIndexService';

const FACULTY = { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' } as const;
const LAB = { entityType: 'LAB', kind: 'lab' } as const;

const served = (candidateName: string, entity: { entityType: string; kind: string }) =>
  servedResearchEntityNameWithoutPageFurniture({ candidateName, ...entity });

describe('servedResearchEntityNameWithoutPageFurniture (#4372)', () => {
  it.each([
    ['Ada Quill - Research', FACULTY, 'Ada Quill Faculty Research'],
    ['Ada Quill – Research', FACULTY, 'Ada Quill Faculty Research'],
    ['Ada van Quill - Research', FACULTY, 'Ada van Quill Faculty Research'],
    ["Ada O'Quill - Research", FACULTY, "Ada O'Quill Faculty Research"],
    ['Quill Lab | Diagnostic Research', LAB, 'Quill Lab'],
    ['Ada Quill | Clarinetist', FACULTY, 'Ada Quill Faculty Research'],
    ['Quill Lab Git Hub', LAB, 'Quill Lab'],
    ['Quill Lab GitHub', LAB, 'Quill Lab'],
    ['Quill Laboratory ResearchGate', LAB, 'Quill Laboratory'],
  ])('rewrites %s', (name, entity, expected) => {
    expect(served(name, entity)).toBe(expected);
    expect(served(expected, entity)).toBe('');
  });

  it.each([
    ['QuLab', LAB],
    ['STEP', LAB],
    ['Quill Lab', LAB],
    ['Sensory Research Group', LAB],
    ['Ada Quill Faculty Research', FACULTY],
    ['Smith Lab - Research', LAB],
    ['Google Scholar', LAB],
    ['Quill GitHub', LAB],
    ['ABC | DEF', LAB],
  ])('leaves %s alone', (name, entity) => {
    expect(served(name, entity)).toBe('');
  });

  it('serves the rewritten name on every name field through the copy sanitizer', () => {
    const entity = sanitizeServedResearchEntityCopyFields({
      ...FACULTY,
      name: 'Ada Quill - Research',
      displayName: 'Ada Quill | Clarinetist',
    });
    expect(entity.name).toBe('Ada Quill Faculty Research');
    expect(entity.displayName).toBe('Ada Quill Faculty Research');
  });

  it('indexes the same name the copy sanitizer serves', () => {
    const lab = buildResearchEntitySearchIndexDocument({
      _id: 'entity-pipe',
      slug: 'quill-lab',
      ...LAB,
      name: 'Quill Lab | Diagnostic Research',
    });
    expect(lab?.name).toBe('Quill Lab');
    const faculty = buildResearchEntitySearchIndexDocument({
      _id: 'entity-hyphen',
      slug: 'ada-quill',
      ...FACULTY,
      name: 'Ada Quill - Research',
    });
    expect(faculty?.name).not.toMatch(/-\s*Research$/);
    expect(faculty?.name).toContain('Ada Quill');
  });
});

describe('classifyHarvestedResearchHomeName page furniture (#4372)', () => {
  const verdict = (harvestedName: string) =>
    classifyHarvestedResearchHomeName({
      harvestedName,
      personName: 'Ada Quill',
      websiteUrl: 'https://quilllab.example.org',
      knownPersonSurnames: new Set(),
    });

  it.each(['About Us', 'About Us Lab', 'Contact Us', 'quilllab', 'Quill'])(
    'refuses %s as an identity',
    (name) => {
      expect(verdict(name)).toBe('NON_IDENTIFYING_LABEL');
    },
  );

  it.each(['Quill Lab', 'QuillLab', 'STEP', 'Ada Quill Lab'])(
    'keeps %s as own identity',
    (name) => {
      expect(verdict(name)).toBe('OWN_IDENTITY');
    },
  );
});
