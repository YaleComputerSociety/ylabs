import { describe, expect, it } from 'vitest';

import { fullDescriptionQuality } from '../researchEntityDescriptionQuality';
import { sanitizeResearchEntityPublicDescriptionFields } from '../researchEntityDescriptionText';

describe('revoicing a lab body that already names the lab', () => {
  it('says "the lab" rather than repeating the formal name on every "our"', () => {
    const sanitized = sanitizeResearchEntityPublicDescriptionFields({
      entityType: 'LAB',
      kind: 'lab',
      name: 'Study of Tides and Estuaries (STE) Lab',
      fullDescription:
        'Housed within the Example Division, the Study of Tides and Estuaries (STE) Lab studies how tides shape estuary ecology. Our research focuses on salt marsh recovery after storms. Through this, our goal is to inform coastal restoration.',
    });
    expect(
      sanitized.fullDescription.match(/Study of Tides and Estuaries \(STE\) Lab/g),
    ).toHaveLength(1);
    expect(fullDescriptionQuality(sanitized.fullDescription).flags).not.toContain(
      'duplicated-fragment',
    );
  });
});

describe('a body that is a news column', () => {
  it('is a news fragment when it lists two or more talks or preprint notices', () => {
    const body =
      'The group develops methods for tidal modeling. Invited talk at an example university on tidal models. Our preprint is available on arXiv. Lightning talk at an example workshop.';
    expect(fullDescriptionQuality(body).flags).toContain('source-news-fragment');
  });

  it('is not a news fragment for one mention', () => {
    const body =
      'The group develops methods for tidal modeling and gave an invited talk on them at an example workshop.';
    expect(fullDescriptionQuality(body).flags).not.toContain('source-news-fragment');
  });
});
