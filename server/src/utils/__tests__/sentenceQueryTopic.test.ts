import { describe, expect, it } from 'vitest';
import { extractResearchTopicFromSentenceQuery } from '../sentenceQueryTopic';

const topicOf = (query: string) => extractResearchTopicFromSentenceQuery(query)?.topicQuery ?? null;

describe('extracting the research topic from a sentence-shaped query (#6223)', () => {
  it.each([
    ['design a better prosthetic hand', 'prosthetic hand'],
    ['build a particle detector', 'particle detector'],
    ['protect oysters from acidic oceans', 'oysters acidic oceans'],
    ['find a cure for dementia', 'cure dementia'],
    ['figure out why ACL tears happen more in women', 'why acl tears women'],
    ['I want to build a robot that can grab soft things', 'robot grab soft'],
    ['I want to protect oysters from acidic oceans', 'oysters acidic oceans'],
    ['want to work in venture capital', 'venture capital'],
    ['build a robot for freshmen with no experience', 'robot'],
    ['make lab-grown meat for people', 'lab-grown meat'],
    ['develop research-grade sensors for drones', 'research-grade sensors drones'],
  ])('reads %s as %s', (query, topic) => expect(topicOf(query)).toBe(topic));

  it.each([
    'machine learning',
    'climate change policy',
    'build a robot',
    'economics and climate change',
    'anxiety in college students',
    'why people believe conspiracy theories',
    'how do babies learn language',
    'who studies bird songs',
    'is there research for painters',
  ])('leaves %s as typed', (query) => expect(topicOf(query)).toBeNull());

  it.each([
    'stop motion animation for film',
    'make up artistry for the stage',
    'makeup and special effects design',
    'get out the vote campaign research',
    'stop-motion puppets and set building',
  ])('keeps %s as typed, because its opening verb belongs to a topic phrase', (query) =>
    expect(topicOf(query)).toBeNull(),
  );

  it.each([
    ["I'm interested in stop motion animation", null],
    ['I want to make stop motion films', 'stop motion films'],
    ['I want to help get out the vote in local elections', 'get out the vote local elections'],
    ['learn make up artistry for theater', 'make up artistry theater'],
  ])('keeps the topic phrase whole in %s', (query, topic) => expect(topicOf(query)).toBe(topic));

  it('never rewrites a query of fewer than four words', () => {
    for (const query of ['design', 'design housing', 'design housing better']) {
      expect(topicOf(query)).toBeNull();
    }
  });

  it.each([
    'measure theory in analysis',
    'design thinking for social impact',
    'research methods in public health',
    'model organisms for aging research',
    'help desk software for hospitals',
    'track and field injury prevention',
  ])('leaves the noun phrase %s as typed', (query) => expect(topicOf(query)).toBeNull());

  it('reads a noun-like goal verb as a goal after a request or a stated intent', () => {
    expect(topicOf('I want to design housing for homeless people')).toBe('housing homeless');
    expect(topicOf('want to measure microplastics in rivers')).toBe('microplastics rivers');
  });

  it('reads a noun-like goal verb as a goal before an object lead', () => {
    expect(topicOf('design a better prosthetic hand')).toBe('prosthetic hand');
    expect(topicOf('use the brain to control robots')).toBe('brain control robots');
  });

  it('reads every request opening it lists', () => {
    expect(topicOf("I'd like to build a robot arm")).toBe('robot arm');
    expect(topicOf('I wanna build a robot arm')).toBe('robot arm');
    expect(topicOf('wanna build a robot arm')).toBe('robot arm');
  });

  it('returns nothing when the framing leaves no topic word', () => {
    expect(topicOf('help me find something to do')).toBeNull();
  });
});
