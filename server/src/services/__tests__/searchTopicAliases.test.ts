import { describe, expect, it } from 'vitest';
import {
  DEPARTMENT_SHORTHAND_ALIASES,
  QUERY_TOPIC_ALIASES,
  RESEARCH_ENTITY_MEILI_DISABLE_ON_WORDS,
  RESEARCH_ENTITY_MEILI_SYNONYMS,
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
    expect(QUERY_TOPIC_ALIASES.genes).toEqual(
      expect.arrayContaining(['genetics', 'genomics']),
    );
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
