import { describe, expect, it } from 'vitest';
import { RESEARCH_AREA_ALIASES } from '../../scrapers/researchAreaCanonicalization';
import {
  buildResearchEntityMeiliSynonyms,
  DEPARTMENT_SHORTHAND_ALIASES,
  QUERY_TOPIC_ALIASES,
  RESEARCH_ENTITY_MEILI_DISABLE_ON_WORDS,
  RESEARCH_ENTITY_MEILI_SYNONYMS,
  RESEARCH_TOPIC_ALIAS_CLUSTERS,
  STUDENT_QUERY_ALIASES,
  STUDENT_TOPIC_TEXT_ALIASES,
  STUDENT_TOPIC_TEXT_ALIAS_FREE_TEXT_GUARDED,
} from '../searchTopicAliases';

describe('searchTopicAliases source of truth', () => {
  it('keeps the historical AI/CS/dept expansions so no legacy case regresses', () => {
    expect(STUDENT_QUERY_ALIASES.ai).toEqual([
      'artificial intelligence',
      'machine learning',
      'deep learning',
      'ai',
    ]);
    expect(DEPARTMENT_SHORTHAND_ALIASES.cs).toEqual(['computer science']);
    expect(DEPARTMENT_SHORTHAND_ALIASES.eeb).toEqual(['ecology and evolutionary biology']);
    expect(QUERY_TOPIC_ALIASES['comp sci']).toEqual(['computer science']);
  });

  it('expands biomedical, environmental, and social-science vernacular to on-corpus canonical terms', () => {
    expect(QUERY_TOPIC_ALIASES.cancer).toEqual(
      expect.arrayContaining(['oncology', 'tumor biology']),
    );
    expect(QUERY_TOPIC_ALIASES.heart).toEqual(expect.arrayContaining(['cardiology']));
    expect(QUERY_TOPIC_ALIASES.children).toEqual(expect.arrayContaining(['pediatrics']));
    expect(QUERY_TOPIC_ALIASES.genes).toEqual(expect.arrayContaining(['genetics', 'genomics']));
    expect(QUERY_TOPIC_ALIASES.immune).toEqual(expect.arrayContaining(['immunology']));
    expect(QUERY_TOPIC_ALIASES.climate).toEqual(
      expect.arrayContaining(['climate change', 'environmental science']),
    );
    expect(QUERY_TOPIC_ALIASES['infectious disease']).toEqual(
      expect.arrayContaining(['epidemiology', 'microbiology']),
    );
    expect(QUERY_TOPIC_ALIASES.aging).toEqual(
      expect.arrayContaining(['geriatrics', 'gerontology']),
    );
    expect(QUERY_TOPIC_ALIASES.drugs).toEqual(expect.arrayContaining(['pharmacology']));
    expect(QUERY_TOPIC_ALIASES['mental health']).toEqual(expect.arrayContaining(['psychiatry']));
    expect(QUERY_TOPIC_ALIASES.ir).toEqual(expect.arrayContaining(['international relations']));
  });

  it('never registers a canonical term as its own query-expansion trigger', () => {
    for (const term of ['immunology', 'oncology', 'cardiology', 'pediatrics', 'genetics']) {
      expect(STUDENT_QUERY_ALIASES[term]).toBeUndefined();
      expect(QUERY_TOPIC_ALIASES[term]).toBeUndefined();
    }
  });

  it('exposes topical aliases through Meili synonyms while keeping metaphor-prone vernacular query-only', () => {
    expect(RESEARCH_ENTITY_MEILI_SYNONYMS['computer vision']).toEqual(
      expect.arrayContaining(['computational vision']),
    );
    expect(RESEARCH_ENTITY_MEILI_SYNONYMS['computational vision']).toEqual(
      expect.arrayContaining(['computer vision']),
    );
    expect(RESEARCH_ENTITY_MEILI_SYNONYMS.cancer).toEqual(expect.arrayContaining(['oncology']));

    for (const queryOnly of ['heart', 'climate', 'aging', 'drugs', 'ir', 'mental health']) {
      expect(RESEARCH_ENTITY_MEILI_SYNONYMS[queryOnly]).toBeUndefined();
      expect(STUDENT_TOPIC_TEXT_ALIASES[queryOnly]).toBeUndefined();
    }
  });

  it('guards only the ambiguous short abbreviations against free-text false positives', () => {
    expect([...STUDENT_TOPIC_TEXT_ALIAS_FREE_TEXT_GUARDED]).toEqual(['cv']);
    expect(RESEARCH_ENTITY_MEILI_DISABLE_ON_WORDS).toEqual(
      expect.arrayContaining(['ai', 'ml', 'nlp', 'cv']),
    );
  });

  it('restricts free-text enrichment to the curated legacy triggers and never scans generic or new-domain terms', () => {
    expect(Object.keys(STUDENT_TOPIC_TEXT_ALIASES).sort()).toEqual(
      [
        'ai',
        'artificial intelligence',
        'computational vision',
        'computer vision',
        'cv',
        'machine learning',
        'ml',
        'natural language processing',
        'neuro',
        'neuroscience',
        'nlp',
        'psych',
        'psychology',
      ].sort(),
    );
    for (const generic of ['neural', 'brain', 'genetic', 'oncology', 'immunology', 'heart']) {
      expect(STUDENT_TOPIC_TEXT_ALIASES[generic]).toBeUndefined();
    }
    expect(STUDENT_TOPIC_TEXT_ALIASES.neuro).toEqual(
      expect.arrayContaining(['neuroscience', 'neurology']),
    );
  });
});

describe('Meili synonyms derived from the governed research-area alias map', () => {
  it('expands governed area variants bidirectionally to the canonical area the corpus carries', () => {
    const expansions: Array<[string, string]> = [
      ['history of art', 'art history'],
      ['population health', 'public health'],
      ['politics', 'political science'],
      ['hci', 'human-computer interaction'],
      ['human computer interaction', 'human-computer interaction'],
      ['llm', 'large language models'],
      ['llms', 'large language models'],
      ['materials sciences', 'materials science'],
      ['environmental sciences', 'environmental science'],
      ['cellular biology', 'cell biology'],
      ['reproductive sciences', 'reproductive medicine'],
    ];
    for (const [variant, canonical] of expansions) {
      expect(RESEARCH_ENTITY_MEILI_SYNONYMS[variant]).toEqual(expect.arrayContaining([canonical]));
      expect(RESEARCH_ENTITY_MEILI_SYNONYMS[canonical]).toEqual(expect.arrayContaining([variant]));
    }
  });

  it('keeps the previously hardcoded curated groups so no legacy recall regresses', () => {
    expect(RESEARCH_ENTITY_MEILI_SYNONYMS.ai).toEqual(
      expect.arrayContaining(['artificial intelligence', 'machine learning', 'deep learning']),
    );
    expect(RESEARCH_ENTITY_MEILI_SYNONYMS.ml).toEqual(
      expect.arrayContaining(['machine learning', 'artificial intelligence']),
    );
    expect(RESEARCH_ENTITY_MEILI_SYNONYMS.nlp).toEqual(
      expect.arrayContaining(['natural language processing', 'computational linguistics']),
    );
    expect(RESEARCH_ENTITY_MEILI_SYNONYMS.cv).toEqual(
      expect.arrayContaining(['computer vision', 'computational vision']),
    );
    expect(RESEARCH_ENTITY_MEILI_SYNONYMS.neuro).toEqual(
      expect.arrayContaining(['neuroscience', 'neurology']),
    );
    expect(RESEARCH_ENTITY_MEILI_SYNONYMS.psych).toEqual(
      expect.arrayContaining(['psychology', 'psychiatry']),
    );
  });

  it('leaves query-only vernacular out of the index synonyms', () => {
    for (const queryOnly of ['heart', 'climate', 'aging', 'drugs', 'ir', 'mental health']) {
      expect(RESEARCH_ENTITY_MEILI_SYNONYMS[queryOnly]).toBeUndefined();
    }
  });

  it('never emits or references a term outside the governed input vocabulary', () => {
    const governedTerms = new Set<string>();
    for (const cluster of RESEARCH_TOPIC_ALIAS_CLUSTERS) {
      if (cluster.kind !== 'topical' || cluster.queryOnly) continue;
      for (const term of [...cluster.canonical, ...cluster.aliases]) {
        governedTerms.add(term.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim());
      }
    }
    for (const [canonical, aliases] of Object.entries(RESEARCH_AREA_ALIASES)) {
      for (const term of [canonical, ...aliases]) {
        governedTerms.add(term.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim());
      }
    }
    for (const [key, values] of Object.entries(RESEARCH_ENTITY_MEILI_SYNONYMS)) {
      expect(governedTerms).toContain(key);
      for (const value of values) expect(governedTerms).toContain(value);
    }
  });

  it('never registers a term as its own synonym', () => {
    for (const [key, values] of Object.entries(RESEARCH_ENTITY_MEILI_SYNONYMS)) {
      expect(values).not.toContain(key);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('is a pure function of the governed map plus curated clusters', () => {
    expect(
      buildResearchEntityMeiliSynonyms(RESEARCH_TOPIC_ALIAS_CLUSTERS, RESEARCH_AREA_ALIASES),
    ).toEqual(RESEARCH_ENTITY_MEILI_SYNONYMS);
    expect(buildResearchEntityMeiliSynonyms([], {})).toEqual({});
  });
});
