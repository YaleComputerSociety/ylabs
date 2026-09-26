import { describe, it, expect, vi, beforeEach } from 'vitest';

const { checkSourceLinkHealth } = vi.hoisted(() => ({ checkSourceLinkHealth: vi.fn() }));
vi.mock('../../../services/sourceLinkHealth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/sourceLinkHealth')>()),
  checkSourceLinkHealth,
}));

import {
  labUrlIsUnusableForResearchHome,
  labUrlUnusabilityFor,
  labUrlUnusabilityWithProbeFor,
  probeLabUrlIsPositivelyDead,
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

describe('labUrlUnusabilityWithProbeFor', () => {
  const SLUG = 'yse-faculty-someone';
  const evidenceFor = (evidence: LabUrlEvidence) => new Map([[SLUG, evidence]]);

  it('probes only where neither a refusal nor a verdict covers the URL', async () => {
    const probe = vi.fn(async () => true);
    const unusable = await labUrlUnusabilityWithProbeFor(new Map(), SLUG, LAB_URL, probe);
    expect(probe).toHaveBeenCalledWith(LAB_URL);
    expect(unusable(LAB_URL)).toBe(true);
  });

  it('keeps the lab when the probe is not a positive dead verdict', async () => {
    const unusable = await labUrlUnusabilityWithProbeFor(
      new Map(),
      SLUG,
      LAB_URL,
      async () => false,
    );
    expect(unusable(LAB_URL)).toBe(false);
  });

  it('scopes a probed verdict to the URL that was probed', async () => {
    const unusable = await labUrlUnusabilityWithProbeFor(
      new Map(),
      SLUG,
      LAB_URL,
      async () => true,
    );
    expect(unusable('https://www.othersite.example/')).toBe(false);
  });

  it.each([
    ['HEALTHY', false],
    ['UNKNOWN', false],
    ['UNAVAILABLE', true],
  ])('lets a stored %s verdict answer without probing', async (healthStatus, expected) => {
    const probe = vi.fn(async () => !expected);
    const unusable = await labUrlUnusabilityWithProbeFor(
      evidenceFor({ sourceLinkHealth: [{ url: LAB_URL, healthStatus }] }),
      SLUG,
      LAB_URL,
      probe,
    );
    expect(probe).not.toHaveBeenCalled();
    expect(unusable(LAB_URL)).toBe(expected);
  });

  it('lets a stored refusal answer without probing', async () => {
    const probe = vi.fn(async () => false);
    const unusable = await labUrlUnusabilityWithProbeFor(
      evidenceFor(refusing('wrong_owner')),
      SLUG,
      LAB_URL,
      probe,
    );
    expect(probe).not.toHaveBeenCalled();
    expect(unusable(LAB_URL)).toBe(true);
  });

  it('does not probe when there is no lab link to decide', async () => {
    const probe = vi.fn(async () => true);
    await labUrlUnusabilityWithProbeFor(new Map(), SLUG, undefined, probe);
    await labUrlUnusabilityWithProbeFor(new Map(), SLUG, '  ', probe);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('probeLabUrlIsPositivelyDead', () => {
  beforeEach(() => {
    checkSourceLinkHealth.mockReset();
  });

  it.each([
    [{ healthStatus: 'UNAVAILABLE' }, true],
    [{ healthStatus: 'UNAVAILABLE', httpStatusCode: 404 }, true],
    [{ healthStatus: 'HEALTHY', httpStatusCode: 200 }, false],
    [{ healthStatus: 'REDIRECTED', httpStatusCode: 301 }, false],
    [{ healthStatus: 'UNKNOWN', httpStatusCode: 403 }, false],
    [{ healthStatus: 'UNKNOWN', httpStatusCode: 429 }, false],
    [{ healthStatus: 'UNKNOWN', httpStatusCode: 503 }, false],
    [{ healthStatus: 'UNKNOWN' }, false],
  ])('reads %o as dead=%s', async (health, expected) => {
    checkSourceLinkHealth.mockResolvedValue(health);
    await expect(probeLabUrlIsPositivelyDead(LAB_URL)).resolves.toBe(expected);
  });

  it('fails open when the probe itself throws', async () => {
    checkSourceLinkHealth.mockImplementation(async () => {
      throw new Error('synthetic failure');
    });
    await expect(probeLabUrlIsPositivelyDead(LAB_URL)).resolves.toBe(false);
  });
});
