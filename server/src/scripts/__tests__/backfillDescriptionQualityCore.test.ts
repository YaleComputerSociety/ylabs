import { describe, expect, it } from 'vitest';

import {
  assessEntityDescription,
  classifyFullDescription,
  detectDuplicateFullGroups,
  isTemplatedKeywordStub,
  sanitizeDescriptionText,
  summarizeDescriptionBackfill,
  type DescriptionEntityInput,
} from '../backfillDescriptionQualityCore';

const LEAKED_CAVEAT =
  'This profile-derived summary should be checked against the linked official sources before outreach.';

const genuineFull =
  'Studies zebrafish neural circuits and how they guide behavior. The group uses live imaging and genetic tools to map circuit function.';

const numberedAreasFull =
  'Active areas of research 1- Bone marrow stem cell niches and their regulation. 2- Where and how B cell development occurs in vivo. 3- Chemoattractants, receptors, and B cell homeostasis.';

const stubFull =
  'Research fields include Quantum Optics, Atomic Interactions, and Molecular Spectroscopy.';

const azIndexFull = 'This A–Z index lists Yale School of Medicine lab websites in one place.';

describe('sanitizeDescriptionText', () => {
  it('strips the leaked internal caveat and reports it', () => {
    const result = sanitizeDescriptionText(`${genuineFull} ${LEAKED_CAVEAT}`);
    expect(result.removedCaveat).toBe(true);
    expect(result.text).toBe(genuineFull);
    expect(result.text.toLowerCase()).not.toContain('before outreach');
  });

  it('strips bare URLs and PubMed identifiers as scrape artifacts', () => {
    const withUrl = sanitizeDescriptionText(
      'Studies coastal erosion using sediment cores. See https://example.org/lab for details.',
    );
    expect(withUrl.removedArtifacts).toBe(true);
    expect(withUrl.text).not.toContain('http');

    const withPmc = sanitizeDescriptionText(
      'Studies tumor microenvironments PMC1234567 and immune evasion mechanisms.',
    );
    expect(withPmc.removedArtifacts).toBe(true);
    expect(withPmc.text).not.toContain('PMC1234567');
  });

  it('strips a dangling empty "research areas:" template clause', () => {
    const bare = sanitizeDescriptionText('Studies condensed matter physics, including research areas:.');
    expect(bare.removedArtifacts).toBe(true);
    expect(bare.text).toBe('Studies condensed matter physics.');

    const trailing = sanitizeDescriptionText(
      'Studies biophysics, including mechanics of motor proteins and the cytoskeleton, and research areas:.',
    );
    expect(trailing.removedArtifacts).toBe(true);
    expect(trailing.text).toBe(
      'Studies biophysics, including mechanics of motor proteins and the cytoskeleton.',
    );

    const withRealItems = sanitizeDescriptionText(
      'Studies condensed matter physics, including quantum physics, and research areas:.',
    );
    expect(withRealItems.text).toBe('Studies condensed matter physics, including quantum physics.');
  });

  it('keeps a populated "research areas:" list intact', () => {
    const populated = 'Studies X including research areas: cardiology, oncology, and immunology.';
    const result = sanitizeDescriptionText(populated);
    expect(result.removedArtifacts).toBe(false);
    expect(result.text).toBe(populated);
  });

  it('leaves clean text unchanged', () => {
    const result = sanitizeDescriptionText(genuineFull);
    expect(result.removedCaveat).toBe(false);
    expect(result.removedArtifacts).toBe(false);
    expect(result.text).toBe(genuineFull);
  });
});

describe('classifyFullDescription', () => {
  it('classifies keyword-list stubs as templated', () => {
    expect(isTemplatedKeywordStub(stubFull)).toBe(true);
    expect(classifyFullDescription(stubFull)).toBe('templated-stub');
  });

  it('classifies A-Z index boilerplate as off-topic', () => {
    expect(classifyFullDescription(azIndexFull)).toBe('off-topic');
  });

  it('classifies the synthetic "is connected to" keyword stub as templated', () => {
    const connectedStub =
      'Example Lab is connected to protein folding, ion channel regulation, and enzyme kinetics.';
    expect(isTemplatedKeywordStub(connectedStub)).toBe(true);
    expect(classifyFullDescription(connectedStub)).toBe('templated-stub');
  });

  it('does not treat genuine prose that mentions connections as a stub', () => {
    const prose =
      'The lab is connected to the Cancer Center and studies how tumor cells evade immune surveillance in vivo.';
    expect(isTemplatedKeywordStub(prose)).toBe(false);
  });

  it('classifies empty, thin, and genuine research prose', () => {
    expect(classifyFullDescription('')).toBe('empty');
    expect(classifyFullDescription('Studies bats.')).toBe('thin');
    expect(classifyFullDescription(genuineFull)).toBe('genuine');
  });
});

describe('assessEntityDescription', () => {
  it('strips a leaked caveat from a genuine full and still derives a short', () => {
    const assessment = assessEntityDescription({
      id: '1',
      slug: 'caveat-lab',
      shortDescription: '',
      fullDescription: `${numberedAreasFull} ${LEAKED_CAVEAT}`,
    });

    expect(assessment.removedCaveat).toBe(true);
    expect(assessment.proposedFull).toBe(numberedAreasFull);
    expect(assessment.fullClass).toBe('genuine');
    expect(assessment.defects).toContain('leaked-caveat');
    expect(assessment.shortAction).toBe('set-short-derived');
    expect(assessment.proposedShort && assessment.proposedShort.length).toBeGreaterThan(0);
  });

  it('never derives a short from a templated keyword stub', () => {
    const assessment = assessEntityDescription({
      id: '2',
      slug: 'stub-lab',
      shortDescription: stubFull,
      fullDescription: stubFull,
    });

    expect(assessment.shortAction).toBe('stub-no-derive');
    expect(assessment.proposedShort).toBeNull();
    expect(assessment.defects).toContain('templated-stub');
    expect(assessment.defects).toContain('short-equals-full');
  });

  it('derives a distinct short from a genuine full when the short is empty', () => {
    const assessment = assessEntityDescription({
      id: '3',
      slug: 'derive-lab',
      shortDescription: '',
      fullDescription: numberedAreasFull,
    });

    expect(assessment.shortAction).toBe('set-short-derived');
    expect(assessment.proposedShort?.startsWith('Studies ')).toBe(true);
    expect(assessment.proposedShort?.toLowerCase()).not.toBe(numberedAreasFull.toLowerCase());
  });

  it('leaves a present, distinct short unchanged', () => {
    const assessment = assessEntityDescription({
      id: '4',
      slug: 'ok-lab',
      shortDescription: 'Investigates how larval circuits steer navigation in open water.',
      fullDescription: genuineFull,
    });

    expect(assessment.shortAction).toBe('short-ok');
    expect(assessment.proposedShort).toBeNull();
    expect(assessment.proposedFull).toBeNull();
  });
});

describe('summarizeDescriptionBackfill', () => {
  it('reports before/after defect counts and backfill writes', () => {
    const entities: DescriptionEntityInput[] = [
      {
        id: '1',
        slug: 'caveat',
        shortDescription: '',
        fullDescription: `${numberedAreasFull} ${LEAKED_CAVEAT}`,
      },
      { id: '2', slug: 'stub', shortDescription: stubFull, fullDescription: stubFull },
      { id: '3', slug: 'derive', shortDescription: '', fullDescription: numberedAreasFull },
    ];
    const assessments = entities.map(assessEntityDescription);
    const summary = summarizeDescriptionBackfill(entities, assessments);

    expect(summary.before.leakedCaveat).toBe(1);
    expect(summary.after.leakedCaveat).toBe(0);
    expect(summary.before.templatedStub).toBe(1);
    expect(summary.after.templatedStub).toBe(1);
    expect(summary.writes.shortDerived).toBe(2);
    expect(summary.before.emptyShort).toBe(2);
    expect(summary.after.emptyShort).toBe(0);
    expect(summary.fullClass['templated-stub']).toBe(1);
    expect(summary.fixability.needsSourceOrLlm).toBe(1);
  });
});

describe('detectDuplicateFullGroups', () => {
  it('groups by sanitized full description and flags templated stubs', () => {
    const report = detectDuplicateFullGroups([
      { id: '1', slug: 'a', fullDescription: `${genuineFull} ${LEAKED_CAVEAT}` },
      { id: '2', slug: 'b', fullDescription: genuineFull },
      { id: '3', slug: 'c', fullDescription: stubFull },
      { id: '4', slug: 'd', fullDescription: stubFull },
    ]);

    expect(report.groupCount).toBe(2);
    const stubGroup = report.groups.find((group) => group.templatedStub);
    expect(stubGroup?.count).toBe(2);
    const proseGroup = report.groups.find((group) => !group.templatedStub);
    expect(proseGroup?.count).toBe(2);
    expect(proseGroup?.slugs).toEqual(['a', 'b']);
  });
});
