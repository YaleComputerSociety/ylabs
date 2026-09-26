import { describe, it, expect } from 'vitest';
import {
  labUrlIsUnusableForResearchHome,
  labUrlUnusabilityFor,
  type LabUrlEvidence,
} from '../labUrlEvidence';

const LAB_URL = 'https://medicine.yale.edu/lab/someone-else/';

const refusing = (rule: string): LabUrlEvidence => ({
  fieldValueRefusals: {
    websiteUrl: [
      {
        valueKey: 'medicine.yale.edu/lab/someone-else',
        rule,
        refusedBy: 'research-entity:refuse-field-value',
        refusedAt: new Date('2026-09-24T00:00:00Z'),
      },
    ],
  },
});

describe('labUrlIsUnusableForResearchHome', () => {
  it('reads a wrong_owner refusal, the verdict that covers most of the cohort', () => {
    expect(labUrlIsUnusableForResearchHome(refusing('wrong_owner'), LAB_URL)).toBe(true);
  });

  it('reads any other recorded rule, so a rule added later needs no change here', () => {
    expect(labUrlIsUnusableForResearchHome(refusing('confirmed_dead_page'), LAB_URL)).toBe(true);
    expect(labUrlIsUnusableForResearchHome(refusing('news-or-people-path'), LAB_URL)).toBe(true);
  });

  it('reads a dead link-health verdict, which exists where no refusal was recorded', () => {
    const evidence: LabUrlEvidence = {
      sourceLinkHealth: [{ url: LAB_URL, healthStatus: 'UNAVAILABLE' }],
    };
    expect(labUrlIsUnusableForResearchHome(evidence, LAB_URL)).toBe(true);
  });

  it('treats UNKNOWN as no verdict, so a transient probe never costs an identity', () => {
    const evidence: LabUrlEvidence = {
      sourceLinkHealth: [{ url: LAB_URL, healthStatus: 'UNKNOWN' }],
    };
    expect(labUrlIsUnusableForResearchHome(evidence, LAB_URL)).toBe(false);
  });

  it('is about one URL, so a verdict on a different URL does not withdraw this one', () => {
    expect(
      labUrlIsUnusableForResearchHome(refusing('wrong_owner'), 'https://www.othersite.example/'),
    ).toBe(false);
  });

  it('fails open on no evidence at all', () => {
    expect(labUrlIsUnusableForResearchHome(undefined, LAB_URL)).toBe(false);
    expect(labUrlIsUnusableForResearchHome({}, LAB_URL)).toBe(false);
    expect(labUrlIsUnusableForResearchHome(refusing('wrong_owner'), '')).toBe(false);
  });
});

describe('labUrlUnusabilityFor', () => {
  it('scopes the predicate to one row, so a verdict cannot leak across rows', () => {
    const map = new Map<string, LabUrlEvidence>([['dept-x-someone', refusing('wrong_owner')]]);
    expect(labUrlUnusabilityFor(map, 'dept-x-someone')(LAB_URL)).toBe(true);
    expect(labUrlUnusabilityFor(map, 'dept-x-another')(LAB_URL)).toBe(false);
  });
});
