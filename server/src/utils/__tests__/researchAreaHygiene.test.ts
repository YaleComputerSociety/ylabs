import { describe, expect, it } from 'vitest';
import {
  normalizeResearchAreaList,
  splitDelimitedResearchArea,
} from '../researchAreaHygiene';

describe('splitDelimitedResearchArea', () => {
  it('splits a bare multi-topic comma list into separate tags', () => {
    expect(
      splitDelimitedResearchArea('Anxiety, Depression, Psychometrics, Treatment, Cognitive Processes'),
    ).toEqual(['Anxiety', 'Depression', 'Psychometrics', 'Treatment', 'Cognitive Processes']);
  });

  it('preserves an Oxford-comma enumeration title with a conjunction', () => {
    expect(splitDelimitedResearchArea('Water Supply, Quality, and Scarcity')).toEqual([
      'Water Supply, Quality, and Scarcity',
    ]);
    expect(
      splitDelimitedResearchArea(
        'Cultural and Political Aspects of Natural Hazards, Disasters, and Resource Degradation',
      ),
    ).toEqual([
      'Cultural and Political Aspects of Natural Hazards, Disasters, and Resource Degradation',
    ]);
  });

  it('preserves a title joined with an ampersand', () => {
    expect(splitDelimitedResearchArea('Water Supply, Quality, & Scarcity')).toEqual([
      'Water Supply, Quality, & Scarcity',
    ]);
  });

  it('leaves a single-comma value intact', () => {
    expect(splitDelimitedResearchArea('Machine Learning, Statistics')).toEqual([
      'Machine Learning, Statistics',
    ]);
  });

  it('leaves a conjunction-free single topic intact', () => {
    expect(splitDelimitedResearchArea('Stress Responses And Cortisol')).toEqual([
      'Stress Responses And Cortisol',
    ]);
  });

  it('returns nothing for blank input', () => {
    expect(splitDelimitedResearchArea('   ')).toEqual([]);
  });
});

describe('normalizeResearchAreaList', () => {
  it('splits blobs while preserving legitimate titles and deduping', () => {
    expect(
      normalizeResearchAreaList([
        'Anxiety, Depression, Psychometrics',
        'Water Supply, Quality, and Scarcity',
        'Anxiety',
      ]),
    ).toEqual(['Anxiety', 'Depression', 'Psychometrics', 'Water Supply, Quality, and Scarcity']);
  });

  it('drops non-string entries', () => {
    expect(
      normalizeResearchAreaList(['Neuroscience', undefined as unknown as string, '']),
    ).toEqual(['Neuroscience']);
  });
});
