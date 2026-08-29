import { describe, expect, it } from 'vitest';
import {
  isGenericResearchSubject,
  judgeResearchSubject,
  normalizeResearchSubjectScope,
  researchSubjectSpecificityScore,
  specificResearchSubjectTerms,
} from '../researchSubjectSpecificity';

describe('normalizeResearchSubjectScope', () => {
  it('accepts the three known scopes in any casing or separator form', () => {
    expect(normalizeResearchSubjectScope('this_entity')).toBe('this_entity');
    expect(normalizeResearchSubjectScope('This Entity')).toBe('this_entity');
    expect(normalizeResearchSubjectScope('parent-org')).toBe('parent_org');
  });

  it('treats anything unrecognized as unclear rather than trusting it', () => {
    expect(normalizeResearchSubjectScope('probably the lab')).toBe('unclear');
    expect(normalizeResearchSubjectScope(undefined)).toBe('unclear');
    expect(normalizeResearchSubjectScope(42)).toBe('unclear');
  });
});

describe('isGenericResearchSubject', () => {
  it('rejects posture vocabulary that names no subject', () => {
    // The aidc failure: "our mission stands at the nexus between hardware,
    // computing, and data science".
    expect(
      isGenericResearchSubject('the nexus between hardware, computing, and data science'),
    ).toBe(true);
    expect(isGenericResearchSubject('excellence and innovation in research')).toBe(true);
    expect(isGenericResearchSubject('a world leader in transforming education and care')).toBe(
      true,
    );
    expect(isGenericResearchSubject('interdisciplinary collaboration')).toBe(true);
    expect(isGenericResearchSubject('')).toBe(true);
    expect(isGenericResearchSubject(undefined)).toBe(true);
  });

  it('accepts subjects that name concrete matter', () => {
    expect(isGenericResearchSubject('keratinocyte and adipocyte interactions in skin tissue')).toBe(
      false,
    );
    expect(
      isGenericResearchSubject('immune dysregulation underlying early-life critical illness'),
    ).toBe(false);
    expect(isGenericResearchSubject('cannabis and cannabinoids')).toBe(false);
    expect(isGenericResearchSubject('Central Asia history, politics, culture, and economy')).toBe(
      false,
    );
  });

  it('treats a subject-bearing acronym as specific despite its length', () => {
    // "ECMO" and "VAD" are the whole subject for ysm-karam, and lowercasing
    // alone would drop them under the short-token floor.
    expect(isGenericResearchSubject('ECMO and VAD support')).toBe(false);
    expect(isGenericResearchSubject('AI for protein design')).toBe(false);
  });

  it('rejects an all-caps heading of ordinary words rather than reading it as acronyms', () => {
    expect(isGenericResearchSubject('OUR MISSION AND VISION')).toBe(true);
    expect(isGenericResearchSubject('WHO WE ARE')).toBe(true);
    expect(isGenericResearchSubject('IT IS ALL ABOUT EXCELLENCE')).toBe(true);
  });
});

describe('specificResearchSubjectTerms', () => {
  it('keeps only subject-bearing terms and deduplicates them', () => {
    expect(specificResearchSubjectTerms('research on neurons and glia and neurons')).toEqual([
      'neurons',
      'glia',
    ]);
  });
});

describe('researchSubjectSpecificityScore', () => {
  it('scores a named subject above a posture statement', () => {
    const named = researchSubjectSpecificityScore(
      'dynamic interactions between non-epithelial cells in barrier tissues',
    );
    const posture = researchSubjectSpecificityScore('high-quality and creative science');
    expect(named).toBeGreaterThan(posture);
    expect(posture).toBe(0);
  });

  it('saturates so it cannot swamp the off-topic demotions', () => {
    const verbose = researchSubjectSpecificityScore(
      'neurons glia astrocytes oligodendrocytes microglia synapses dendrites axons myelin cortex hippocampus',
    );
    expect(verbose).toBe(8);
  });

  it('counts a repeated acronym once, and never twice with its lowercased term', () => {
    expect(researchSubjectSpecificityScore('ECMO support, ECMO outcomes, ECMO cannulation')).toBe(
      researchSubjectSpecificityScore('ECMO cannulation'),
    );
    expect(researchSubjectSpecificityScore('ECMO')).toBe(1);
  });

  it('is zero for an absent subject, leaving a caller score unchanged', () => {
    expect(researchSubjectSpecificityScore(undefined)).toBe(0);
    expect(researchSubjectSpecificityScore('')).toBe(0);
  });
});

describe('judgeResearchSubject', () => {
  it('serves a specific subject attributed to this entity', () => {
    const judgement = judgeResearchSubject({
      subject: 'immune dysregulation underlying early-life critical illness',
      scope: 'this_entity',
    });
    expect(judgement.isServable).toBe(true);
    expect(judgement.rejectionReason).toBeUndefined();
  });

  it('serves a specific subject even when the source prose was a mission statement', () => {
    // Four of the served "Our Mission" descriptions name a real subject, so the
    // gate must key on the subject and never on the section it came from.
    const judgement = judgeResearchSubject({
      subject: 'extracorporeal membrane oxygenation in critically ill patients',
      scope: 'this_entity',
    });
    expect(judgement.isServable).toBe(true);
  });

  it('holds a subject that names nothing', () => {
    const judgement = judgeResearchSubject({
      subject: 'the nexus between hardware, computing, and data science',
      scope: 'this_entity',
    });
    expect(judgement.isServable).toBe(false);
    expect(judgement.rejectionReason).toBe('generic_subject');
  });

  it('holds a parent organization subject on an individual record', () => {
    const judgement = judgeResearchSubject({
      subject: 'pediatric education, research, and clinical care',
      scope: 'parent_org',
    });
    expect(judgement.isServable).toBe(false);
    expect(judgement.rejectionReason).toBe('parent_org_subject');
  });

  it('holds when attribution cannot be established', () => {
    const judgement = judgeResearchSubject({
      subject: 'cannabis and cannabinoids',
      scope: 'unclear',
    });
    expect(judgement.isServable).toBe(false);
    expect(judgement.rejectionReason).toBe('unclear_scope');
  });

  it('reports no_subject separately from a generic one so the A/B can tell them apart', () => {
    expect(judgeResearchSubject({ subject: '', scope: 'this_entity' }).rejectionReason).toBe(
      'no_subject',
    );
  });
});
