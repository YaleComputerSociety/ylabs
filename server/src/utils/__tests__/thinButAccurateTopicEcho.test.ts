import { describe, expect, it } from 'vitest';
import { fullDescriptionQuality, isThinButAccurateBody } from '../researchEntityDescriptionQuality';
import { researchEntityServesPublicDetail } from '../../services/researchEntityPublicDescription';

const thinButAccurate = (body: string, areas: string[]) =>
  isThinButAccurateBody(fullDescriptionQuality(body, areas, 'FACULTY_RESEARCH_AREA'));

describe('a research sentence whose topics were read from it is thin but accurate', () => {
  it.each([
    [
      'Quilla Marrow does research in labor economics, public finance, and taxation.',
      ['labor economics', 'public finance', 'taxation'],
    ],
    [
      "Quilla Marrow's research has been in the field of Renal Physiology, Hypertension, Kidney Disease and Clinical Trials.",
      ['Renal Physiology', 'Hypertension', 'Kidney Disease', 'Clinical Trials'],
    ],
    [
      'Marrow’s current research includes forecasting crop yields using satellite imagery and rural household survey analysis.',
      ['forecasting crop yields', 'satellite imagery', 'rural household survey analysis'],
    ],
    [
      'The faculty member conducts research on refugee mental health, pediatric asthma, and patient advocacy.',
      ['refugee mental health', 'pediatric asthma', 'patient advocacy'],
    ],
    [
      "Dr. Marrows' primary research interests lie in language acquisition, bilingual development and outcome in deafness.",
      ['language acquisition', 'bilingual development', 'deafness'],
    ],
    [
      'Quilla Marrow works broadly on topics in computer architecture, including compilers, caches, and memory systems.',
      ['computer architecture', 'compilers', 'caches', 'memory systems'],
    ],
    [
      'Dr. Marrow works to improve outcomes of those with malaria and prioritizes community prevention strategies.',
      ['malaria', 'prevention'],
    ],
    [
      'European social and economic history of the 17th and 18th centuries, focusing on guilds, credit markets, and urban growth.',
      [
        'European social and economic history',
        '17th and 18th centuries',
        'guilds',
        'credit markets',
        'urban growth',
      ],
    ],
  ])('shows %s', (body, areas) => {
    expect(thinButAccurate(body, areas)).toBe(true);
  });

  it.each([
    [
      'Medical Research Interests Asthma; Bronchiolitis; Pulmonary Disease; Pediatrics',
      ['Asthma', 'Bronchiolitis', 'Pulmonary Disease', 'Pediatrics'],
    ],
    [
      'Interests Applied Cryptography Lattice Methods Complexity Theory Secure Computation',
      ['Applied Cryptography', 'Lattice Methods', 'Complexity Theory', 'Secure Computation'],
    ],
    [
      'Research in Clinical judgment in assessing infants with fever and respiratory disease',
      ['Clinical judgment', 'infants', 'fever', 'respiratory disease'],
    ],
    [
      'Deprescribing in older adults with chronic pain conditions,',
      ['Deprescribing', 'older adults', 'chronic pain'],
    ],
    [
      'Area of interest: Spanish and Catalan Literatures; Cervantes, Rodoreda; modernist and inter-arts literature.',
      ['Spanish and Catalan Literatures', 'Cervantes', 'Rodoreda', 'modernist literature'],
    ],
    ['Quilla Marrow is an Associate Professor of History at Yale.', ['History']],
  ])('keeps %s held', (body, areas) => {
    expect(fullDescriptionQuality(body, areas, 'FACULTY_RESEARCH_AREA').isUseful).toBe(false);
    expect(thinButAccurate(body, areas)).toBe(false);
  });
});

describe('the pipeline "Studies <topics>." sentence is thin but accurate', () => {
  it.each([
    ['Studies game theory.', ['Game Theory']],
    ['Studies macroeconomics.', ['Macroeconomics']],
    [
      'Studies contract theory, including economic theory, and information economics.',
      ['Contract Theory', 'Economic Theory', 'Information Economics'],
    ],
  ])('shows %s', (body, areas) => {
    expect(thinButAccurate(body, areas)).toBe(true);
  });

  it('keeps a malformed "Studies" sentence that ends on a label held', () => {
    expect(
      thinButAccurate('Studies particle physics, including research areas:.', ['Particle Physics']),
    ).toBe(false);
  });

  it('serves a faculty research row whose only body is the sentence', () => {
    expect(
      researchEntityServesPublicDetail({
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        researchAreas: ['Political Economy', 'Public Choice'],
        shortDescription: 'Studies political economy and public choice.',
        fullDescription: 'Studies political economy and public choice.',
        sourceUrls: ['https://example.yale.edu/faculty/economics'],
        fieldProvenance: { fullDescription: { sourceName: 'dept-faculty-roster' } },
      }),
    ).toBe(true);
  });

  it('serves an official research sentence whose topics were read from it', () => {
    expect(
      researchEntityServesPublicDetail({
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        researchAreas: ['refugee mental health', 'pediatric asthma', 'patient advocacy'],
        shortDescription: '',
        fullDescription:
          'The faculty member conducts research on refugee mental health, pediatric asthma, and patient advocacy.',
        sourceUrls: ['https://example.yale.edu/profile/faculty-member'],
        fieldProvenance: { fullDescription: { sourceName: 'ysm-faculty-directory' } },
      }),
    ).toBe(true);
  });
});
